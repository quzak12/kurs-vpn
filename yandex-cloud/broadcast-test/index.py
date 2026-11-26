"""Administrator-only self-test. This version never sends to other users."""
import base64
import hashlib
import hmac
import json
import os
import re
import socket
import ssl
import time
import urllib.error
import urllib.request
from urllib.parse import parse_qsl

ORIGIN = 'https://quzak12.github.io'
RELAY_URL = 'https://kurs-vpn-relay-selftest.kursvpn-quzak12.workers.dev/send-test'

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

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


def handler(event, context):
    headers = {str(k).lower(): str(v) for k, v in (event.get('headers') or {}).items()}
    origin = headers.get('origin')
    if origin and origin != ORIGIN:
        return response(403, {'error': 'Forbidden'})
    cors = origin == ORIGIN
    method = event.get('httpMethod', '')
    if method == 'OPTIONS':
        return response(204, {}, cors)
    if method != 'POST':
        return response(405, {'error': 'Method not allowed'}, cors)
    token = os.environ.get('BOT_TOKEN', '')
    admin_id = os.environ.get('ADMIN_TELEGRAM_ID', '')
    admin_secret = os.environ.get('ADMIN_SECRET', '')
    if not token or not re.fullmatch(r'[1-9][0-9]{0,15}', admin_id) or len(admin_secret) < 32 or not admin_secret.isascii():
        return response(503, {'error': 'Test service is not configured'}, cors)
    try:
        raw = event.get('body') or ''
        if not isinstance(raw, str) or len(raw) > 32000:
            return response(413, {'error': 'Request too large'}, cors)
        raw = base64.b64decode(raw, validate=True) if event.get('isBase64Encoded') else raw.encode('utf-8')
        if len(raw) > 24000:
            return response(413, {'error': 'Request too large'}, cors)
        body = json.loads(raw)
        if not isinstance(body, dict):
            return response(400, {'error': 'Invalid request'}, cors)
        uid = telegram_user(body.get('initData'), token)
        if not uid or str(uid) != admin_id:
            return response(403, {'error': 'Forbidden'}, cors)
        if body.get('action') == 'check':
            return response(200, {'admin': True, 'testOnly': True}, cors)
        if body.get('action') != 'self_test':
            return response(400, {'error': 'Unknown action'}, cors)
        secret = body.get('secret')
        if not isinstance(secret, str) or not secret.isascii() or len(secret) > 256 or not hmac.compare_digest(secret, admin_secret):
            return response(403, {'error': 'Forbidden'}, cors)
        text = body.get('text')
        if not isinstance(text, str) or not 1 <= len(text.strip()) <= 4000:
            return response(400, {'error': 'Invalid text'}, cors)
        # The relay has its own fixed recipient and requires a signed request.
        raw = json.dumps({'token': token, 'text': text.strip()}, ensure_ascii=True, separators=(',', ':')).encode('utf-8')
        timestamp = str(int(time.time()))
        signature = hmac.new(admin_secret.encode('ascii'), timestamp.encode('ascii') + b'.' + raw, hashlib.sha256).hexdigest()
        req = urllib.request.Request(RELAY_URL, data=raw, headers={'Content-Type':'application/json', 'X-Relay-Time':timestamp, 'X-Relay-Signature':signature}, method='POST')
        with urllib.request.build_opener(NoRedirect()).open(req, timeout=16) as r:
            result = json.loads(r.read(65536))
        if result.get('sentToAdmin') is not True or result.get('testOnly') is not True:
            return response(502, {'error': 'Relay did not confirm delivery', 'relayStatus': 'invalid'}, cors)
        return response(200, {'sentToAdmin': True, 'testOnly': True}, cors)
    except (ValueError, TypeError, UnicodeError, json.JSONDecodeError):
        return response(400, {'error': 'Invalid request'}, cors)
    except urllib.error.HTTPError as exc:
        # Never log request URLs, headers, bodies, or secrets.
        try:
            detail = json.loads(exc.read(4096))
        except Exception:
            detail = {}
        if exc.code == 502 and detail.get('error') == 'telegram' and isinstance(detail.get('status'), int):
            return response(502, {'error': 'Telegram rejected message', 'telegramStatus': detail['status']}, cors)
        if exc.code == 502 and detail.get('error') == 'telegram_network':
            return response(502, {'error': 'Relay could not reach Telegram', 'relayStatus': 'telegram_network'}, cors)
        return response(502, {'error': 'Relay error', 'relayStatus': 'rejected', 'relayHttp': exc.code}, cors)
    except (urllib.error.URLError, TimeoutError, OSError):
        return response(502, {'error': 'Could not reach relay', 'relayStatus': 'network'}, cors)
    except Exception:
        return response(500, {'error': 'Test message failed'}, cors)
