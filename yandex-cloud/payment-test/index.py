"""Isolated YooKassa test payments only: never grants access or accepts live keys."""
import base64
import calendar
import datetime
from decimal import Decimal, InvalidOperation
import ydb
import ydb.iam
import hashlib
import hmac
import json
import os
import re
import time
import urllib.error
import urllib.request
import uuid
from urllib.parse import parse_qsl, urlparse

PLANS = {'month': ('249.00', '1 месяц'), 'quarter': ('599.00', '3 месяца'), 'year': ('1799.00', '1 год')}
ORIGIN = 'https://quzak12.github.io'
RETURN_URL = 'https://quzak12.github.io/kurs-vpn/'
API = 'https://api.yookassa.ru/v3/payments'
MONTHS = {'month': 1, 'quarter': 3, 'year': 12}
_pool = None
_driver = None


def response(status, payload, cors=False):
    headers = {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Vary': 'Origin', 'X-Content-Type-Options': 'nosniff'}
    if cors:
        headers.update({'Access-Control-Allow-Origin': ORIGIN, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type'})
    return {'statusCode': status, 'headers': headers, 'body': '' if status == 204 else json.dumps(payload, ensure_ascii=False), 'isBase64Encoded': False}


def telegram_user(init_data, token):
    if not isinstance(init_data, str) or not 0 < len(init_data) <= 12000:
        return None
    try:
        pairs = parse_qsl(init_data, keep_blank_values=True, strict_parsing=True, max_num_fields=100)
        data = dict(pairs)
        if len(data) != len(pairs):
            return None
        supplied = data.pop('hash', '')
        if not re.fullmatch(r'[a-fA-F0-9]{64}', supplied):
            return None
        check = '\n'.join(f'{k}={v}' for k, v in sorted(data.items()))
        secret = hmac.new(b'WebAppData', token.encode(), hashlib.sha256).digest()
        digest = hmac.new(secret, check.encode(), hashlib.sha256).hexdigest()
        timestamp = int(data.get('auth_date', ''))
        now = int(time.time())
        if not hmac.compare_digest(digest, supplied.lower()) or timestamp > now + 60 or now - timestamp > 86400:
            return None
        user = json.loads(data.get('user', 'null'))
        if not isinstance(user, dict) or type(user.get('id')) is not int or not 0 < user['id'] <= 9007199254740991 or user.get('is_bot'):
            return None
        return user['id']
    except (ValueError, TypeError, json.JSONDecodeError):
        return None


def yookassa_request(shop, key, body=None, payment_id=None, idem=None):
    url = API + ('/' + payment_id if payment_id else '')
    auth = base64.b64encode(f'{shop}:{key}'.encode()).decode('ascii')
    headers = {'Authorization': 'Basic ' + auth, 'Accept': 'application/json'}
    data = None
    if body is not None:
        headers.update({'Content-Type': 'application/json', 'Idempotence-Key': idem})
        data = json.dumps(body, ensure_ascii=False).encode('utf-8')
    request = urllib.request.Request(url, data=data, headers=headers, method='POST' if data else 'GET')
    with urllib.request.urlopen(request, timeout=8) as r:
        return json.loads(r.read(65536))



def pool():
    global _pool, _driver
    if _pool is None:
        driver = ydb.Driver(endpoint=os.environ['YDB_ENDPOINT'], database=os.environ['YDB_DATABASE'], credentials=ydb.iam.MetadataUrlCredentials())
        driver.wait(fail_fast=True, timeout=5)
        _driver = driver
        _pool = ydb.QuerySessionPool(driver)
    return _pool


def parse_payment(payment, pid):
    """Validate live provider response, not client or webhook claims."""
    metadata = payment.get('metadata') or {}
    plan = metadata.get('plan')
    uid_str = str(metadata.get('telegram_id', ''))
    amount = payment.get('amount') or {}
    if (payment.get('id') != pid or payment.get('test') is not True or
        payment.get('status') != 'succeeded' or payment.get('paid') is not True or
        plan not in PLANS or not re.fullmatch(r'[1-9][0-9]{0,15}', uid_str) or
        int(uid_str) > 9007199254740991 or amount.get('currency') != 'RUB'):
        raise ValueError('Invalid test payment')
    try:
        if Decimal(str(amount.get('value'))) != Decimal(PLANS[plan][0]):
            raise ValueError('Invalid amount')
    except InvalidOperation:
        raise ValueError('Invalid amount')
    captured = payment.get('captured_at')
    if not isinstance(captured, str):
        raise ValueError('Missing capture time')
    started = datetime.datetime.fromisoformat(captured.replace('Z', '+00:00'))
    if started.tzinfo is None:
        raise ValueError('Missing timezone')
    started = started.astimezone(datetime.timezone.utc)
    if started > datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(minutes=5):
        raise ValueError('Invalid capture time')
    zero = started.month - 1 + MONTHS[plan]
    year, month = started.year + zero // 12, zero % 12 + 1
    ended = started.replace(year=year, month=month, day=min(started.day, calendar.monthrange(year, month)[1]))
    return {'pid': pid, 'uid': int(uid_str), 'plan': plan,
            'started': started.isoformat(timespec='seconds').replace('+00:00', 'Z'),
            'expires': ended.isoformat(timespec='seconds').replace('+00:00', 'Z')}


def activate_test(payment, pid):
    record = parse_payment(payment, pid)
    pool().execute_with_retries(
        'DECLARE $payment_id AS Utf8; DECLARE $telegram_id AS Int64; DECLARE $plan AS Utf8; '
        'DECLARE $activated_at AS Utf8; DECLARE $expires_at AS Utf8; '
        'UPSERT INTO test_payment_activations (payment_id, telegram_id, plan, activated_at, expires_at) '
        'VALUES ($payment_id, $telegram_id, $plan, $activated_at, $expires_at);',
        {'$payment_id': record['pid'], '$telegram_id': record['uid'], '$plan': record['plan'],
         '$activated_at': record['started'], '$expires_at': record['expires']})
    return record


def current_test_subscription(uid):
    results = pool().execute_with_retries(
        'DECLARE $telegram_id AS Int64; SELECT plan, expires_at FROM test_payment_activations WHERE telegram_id = $telegram_id;',
        {'$telegram_id': uid})
    rows = results[0].rows if results else []
    rows = [r for r in rows if isinstance(r.expires_at, str)]
    if not rows:
        return {'active': False, 'expiresAt': None, 'plan': None}
    row = max(rows, key=lambda r: r.expires_at)
    expires = datetime.datetime.fromisoformat(row.expires_at.replace('Z', '+00:00'))
    return {'active': bool(expires.tzinfo) and expires > datetime.datetime.now(datetime.timezone.utc),
            'expiresAt': row.expires_at, 'plan': row.plan}


def handler(event, context):
    headers = {str(k).lower(): str(v) for k, v in (event.get('headers') or {}).items()}
    origin = headers.get('origin')
    if origin and origin != ORIGIN:
        return response(403, {'error': 'Origin not allowed'})
    cors = origin == ORIGIN
    method = event.get('httpMethod', '')
    if method == 'OPTIONS':
        return response(204, {}, cors)
    if method != 'POST':
        return response(405, {'error': 'Method not allowed'}, cors)
    shop = os.environ.get('YOOKASSA_TEST_SHOP_ID', '')
    key = os.environ.get('YOOKASSA_TEST_SECRET_KEY', '')
    bot_token = os.environ.get('BOT_TOKEN', '')
    if not re.fullmatch(r'\d{1,20}', shop) or not key.startswith('test_') or not bot_token or not os.environ.get('YDB_ENDPOINT') or not os.environ.get('YDB_DATABASE'):
        return response(503, {'error': 'Test service not configured'}, cors)
    try:
        raw = event.get('body') or ''
        if not isinstance(raw, str) or len(raw) > 24000:
            return response(413, {'error': 'Request too large'}, cors)
        raw = base64.b64decode(raw, validate=True) if event.get('isBase64Encoded') else raw.encode('utf-8')
        if len(raw) > 16384:
            return response(413, {'error': 'Request too large'}, cors)
        body = json.loads(raw)
        if not isinstance(body, dict):
            return response(400, {'error': 'Invalid request'}, cors)
        # A webhook contains no credentials: independently fetch the payment from YooKassa.
        if body.get('event') == 'payment.succeeded' and not origin:
            pid = (body.get('object') or {}).get('id', '')
            if not isinstance(pid, str) or not re.fullmatch(r'[0-9a-fA-F-]{36}', pid):
                return response(400, {'error': 'Invalid payment ID'}, cors)
            payment = yookassa_request(shop, key, payment_id=pid)
            activate_test(payment, pid)
            return response(200, {'ok': True}, cors)
        uid = telegram_user(body.get('initData'), bot_token)
        if not uid:
            return response(401, {'error': 'Invalid Telegram authorization'}, cors)
        action = body.get('action')
        if action == 'subscription':
            return response(200, {'test': True, 'testSubscription': current_test_subscription(uid)}, cors)
        if action == 'create':
            plan = body.get('plan')
            request_id = str(uuid.UUID(body.get('requestId', '')))
            if plan not in PLANS:
                return response(400, {'error': 'Unknown plan'}, cors)
            amount, label = PLANS[plan]
            payment = yookassa_request(shop, key, {
                'amount': {'value': amount, 'currency': 'RUB'}, 'capture': True,
                'confirmation': {'type': 'redirect', 'return_url': RETURN_URL},
                'description': 'Тест KURS VPN — ' + label,
                'metadata': {'telegram_id': str(uid), 'plan': plan},
            }, idem=hashlib.sha256(f'{uid}:{request_id}'.encode()).hexdigest())
            if payment.get('test') is not True:
                return response(502, {'error': 'Not a test payment'}, cors)
            url = (payment.get('confirmation') or {}).get('confirmation_url', '')
            parsed = urlparse(url)
            if parsed.scheme != 'https' or parsed.hostname not in ('yoomoney.ru', 'yookassa.ru'):
                return response(502, {'error': 'Invalid confirmation URL'}, cors)
            return response(200, {'test': True, 'paymentId': payment.get('id'), 'confirmationUrl': url}, cors)
        if action == 'status':
            pid = body.get('paymentId', '')
            if not isinstance(pid, str) or not re.fullmatch(r'[0-9a-fA-F-]{36}', pid):
                return response(400, {'error': 'Invalid payment ID'}, cors)
            payment = yookassa_request(shop, key, payment_id=pid)
            if payment.get('test') is not True or str((payment.get('metadata') or {}).get('telegram_id')) != str(uid):
                return response(404, {'error': 'Payment not found'}, cors)
            status = payment.get('status')
            if status not in ('pending', 'waiting_for_capture', 'succeeded', 'canceled'):
                return response(502, {'error': 'Unexpected payment status'}, cors)
            if status == 'succeeded':
                activate_test(payment, pid)
            return response(200, {'test': True, 'status': status, 'subscriptionActivated': False,
                                  'testSubscription': current_test_subscription(uid)}, cors)
        return response(400, {'error': 'Unknown action'}, cors)
    except (ValueError, TypeError, UnicodeError, json.JSONDecodeError):
        return response(400, {'error': 'Invalid request'}, cors)
    except (urllib.error.URLError, TimeoutError, OSError):
        return response(502, {'error': 'Test payment provider unavailable'}, cors)
    except Exception:
        return response(500, {'error': 'Test payment failed'}, cors)
