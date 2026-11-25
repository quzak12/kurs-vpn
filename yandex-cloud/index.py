import base64
import datetime
import hashlib
import hmac
import json
import os
import re
import time
from urllib.parse import parse_qsl

import ydb
import ydb.iam

_pool = None
_driver = None


def response(status, payload, origin=None):
    headers = {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Vary': 'Origin', 'X-Content-Type-Options': 'nosniff'}
    if origin:
        headers.update({'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type'})
    return {'statusCode': status, 'headers': headers, 'body': '' if status == 204 else json.dumps(payload, ensure_ascii=False), 'isBase64Encoded': False}


def validate_init_data(value, token):
    if not isinstance(value, str) or not 0 < len(value) <= 12000:
        return None
    try:
        pairs = parse_qsl(value, keep_blank_values=True, strict_parsing=True, max_num_fields=100)
        data = dict(pairs)
        if len(data) != len(pairs):
            return None
        supplied = data.pop('hash', '')
        if not re.fullmatch(r'[a-fA-F0-9]{64}', supplied):
            return None
        check = '\n'.join(f'{k}={v}' for k, v in sorted(data.items()))
        key = hmac.new(b'WebAppData', token.encode(), hashlib.sha256).digest()
        expected = hmac.new(key, check.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, supplied.lower()):
            return None
        timestamp = int(data.get('auth_date', ''))
        now = int(time.time())
        if timestamp > now + 60 or now - timestamp > 86400:
            return None
        user = json.loads(data.get('user', 'null'))
        if not isinstance(user, dict) or type(user.get('id')) is not int or not 0 < user['id'] <= 9007199254740991 or user.get('is_bot'):
            return None
        return user
    except (ValueError, TypeError, json.JSONDecodeError):
        return None


def get_pool():
    global _pool, _driver
    if _pool is None:
        driver = ydb.Driver(endpoint=os.environ['YDB_ENDPOINT'], database=os.environ['YDB_DATABASE'], credentials=ydb.iam.MetadataUrlCredentials())
        driver.wait(fail_fast=True, timeout=5)
        _driver = driver
        _pool = ydb.QuerySessionPool(driver)
    return _pool


def get_account(user):
    pool = get_pool()
    first_name = user.get('first_name')
    first_name = first_name[:100] if isinstance(first_name, str) else ''
    params = {'$id': user['id'], '$name': first_name}
    pool.execute_with_retries('DECLARE $id AS Int64; DECLARE $name AS Utf8; UPSERT INTO users (telegram_id, first_name) VALUES ($id, $name);', params)
    result = pool.execute_with_retries('DECLARE $id AS Int64; SELECT telegram_id, first_name, subscription_until FROM users WHERE telegram_id = $id;', {'$id': user['id']})
    if not result or not result[0].rows:
        raise RuntimeError('Account row missing')
    row = result[0].rows[0]
    expiry = row.subscription_until
    active = False
    if expiry:
        try:
            dt = datetime.datetime.fromisoformat(expiry.replace('Z', '+00:00'))
            active = bool(dt.tzinfo) and dt > datetime.datetime.now(datetime.timezone.utc)
        except (ValueError, AttributeError):
            pass
    return {'telegramId': int(row.telegram_id), 'firstName': row.first_name or '', 'subscription': {'active': active, 'expiresAt': expiry or None}}


def handler(event, context):
    token = os.environ.get('BOT_TOKEN')
    allowed_origin = os.environ.get('FRONTEND_ORIGIN')
    headers = {str(k).lower(): str(v) for k, v in (event.get('headers') or {}).items()}
    origin = headers.get('origin')
    if origin and origin != allowed_origin:
        return response(403, {'error': 'Origin not allowed'})
    cors = origin if origin else None
    if not token or not allowed_origin or not os.environ.get('YDB_ENDPOINT') or not os.environ.get('YDB_DATABASE'):
        return response(503, {'error': 'Service is not configured'}, cors)
    method = event.get('httpMethod', '')
    if method == 'OPTIONS':
        return response(204, None, cors)
    if method == 'GET':
        return response(200, {'ok': True}, cors)
    if method != 'POST':
        return response(405, {'error': 'Method not allowed'}, cors)
    try:
        raw = event.get('body') or ''
        if not isinstance(raw, str) or len(raw) > 24000:
            return response(413, {'error': 'Request too large'}, cors)
        raw = base64.b64decode(raw, validate=True) if event.get('isBase64Encoded') else raw.encode('utf-8')
        if len(raw) > 16384:
            return response(413, {'error': 'Request too large'}, cors)
        body = json.loads(raw)
        user = validate_init_data(body.get('initData') if isinstance(body, dict) else None, token)
        if not user:
            return response(401, {'error': 'Invalid Telegram authorization'}, cors)
        return response(200, get_account(user), cors)
    except (ValueError, UnicodeError):
        return response(400, {'error': 'Invalid request'}, cors)
    except Exception:
        print('Account request failed')
        return response(500, {'error': 'Server error'}, cors)
