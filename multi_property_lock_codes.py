# multi_property_lock_codes.py - TTLock API helper module
import requests
import os
import time
import json

# Credentials (set by calling script from environment)
CLIENT_ID = None
ACCESS_TOKEN = None
CLIENT_SECRET = '19e2a1afb5bfada46f6559c346777017'  # required for refresh flow

OAUTH_HOST = 'https://api.sciener.com'
TTLOCK_API_BASE = 'https://euapi.ttlock.com'
TOKEN_FILE = 'ttlock_token.json'

def _load_token():
    if os.path.exists(TOKEN_FILE):
        try:
            with open(TOKEN_FILE, 'r') as f:
                return json.load(f)
        except Exception:
            return {}
    return {}

def _save_token(d):
    with open(TOKEN_FILE, 'w') as f:
        json.dump(d, f, indent=2)

def _now():
    return time.time()

def _token_valid(tok):
    return tok and tok.get('access_token') and tok.get('expires_at', 0) > _now()

def _refresh_with_refresh_token(tok):
    client_id = CLIENT_ID or os.getenv('TTLOCK_CLIENT_ID')
    r = requests.post(f'{OAUTH_HOST}/oauth2/token', data={
        'client_id': client_id,
        'client_secret': CLIENT_SECRET,
        'grant_type': 'refresh_token',
        'refresh_token': tok['refresh_token'],
    }, timeout=30)
    r.raise_for_status()
    data = r.json()
    data['expires_at'] = _now() + data.get('expires_in', 7200) - 60
    _save_token(data)
    return data

def get_access_token():
    """Get valid access token, refreshing if needed"""
    tok = _load_token()
    if _token_valid(tok):
        return tok['access_token']
    if tok.get('refresh_token'):
        data = _refresh_with_refresh_token(tok)
        return data['access_token']
    raise RuntimeError("No valid TTLock token. Run your token helper to create ttlock_token.json first.")

def _ttlock_add_keyboard_pwd(payload):
    """Internal helper to make TTLock API request"""
    url = f"{TTLOCK_API_BASE}/v3/keyboardPwd/add"
    return requests.post(url, data=payload, timeout=30)

def create_lock_code_simple(lock_id, code, name, start, end, code_type="Room", booking_id=""):
    """
    Create a TTLock keyboard code with automatic token refresh on failure.
    
    Args:
        lock_id: TTLock lock ID (integer)
        code: 4-digit access code (string)
        name: Guest name
        start: Start datetime (datetime object or milliseconds)
        end: End datetime (datetime object or milliseconds)
        code_type: Description like 'Room' or 'Front Door'
        booking_id: Booking reference ID
    
    Returns:
        True if successful, False otherwise
    """
    # Convert datetime to milliseconds if needed
    if hasattr(start, 'timestamp'):
        start_ms = int(start.timestamp() * 1000)
    else:
        start_ms = int(start)
    
    if hasattr(end, 'timestamp'):
        end_ms = int(end.timestamp() * 1000)
    else:
        end_ms = int(end)
    
    client_id = CLIENT_ID or os.getenv('TTLOCK_CLIENT_ID')
    access_token = ACCESS_TOKEN or get_access_token()
    
    payload = {
        "clientId": client_id,
        "accessToken": access_token,
        "lockId": lock_id,
        "keyboardPwd": code,
        "keyboardPwdName": f"{name} - {code_type} - {booking_id}",
        "keyboardPwdType": 3,              # period
        "startDate": start_ms,
        "endDate": end_ms,
        "addType": 2,                      # cloud/app
        "date": int(time.time() * 1000),
    }

    print(f"📤 Creating {code_type} code '{code}' for {name} (Lock ID: {lock_id})")
    try:
        api_res = _ttlock_add_keyboard_pwd(payload)
        try:
            result = api_res.json()
        except json.JSONDecodeError:
            print("❌ Invalid JSON response from TTLock")
            return False

        # If token invalid, refresh and retry once
        if result.get("errcode") in (10003, 10004, -2010):  # invalid token / invalid grant
            print("🔁 Token invalid; refreshing and retrying…")
            tok = _load_token()
            if not tok.get("refresh_token"):
                print("❌ No refresh_token available. Run token helper first.")
                return False
            try:
                newtok = _refresh_with_refresh_token(tok)
                payload["accessToken"] = newtok["access_token"]
                api_res = _ttlock_add_keyboard_pwd(payload)
                result = api_res.json()
            except Exception as e:
                print(f"❌ Refresh failed: {e}")
                return False

        if result.get("errcode") == 0:
            print(f"✅ {code_type} code {code} created successfully")
            return True
        elif result.get("errcode") == -3007:
            print(f"⚠️ Code {code} already exists on {code_type} - might be OK if same booking")
            return True
        elif result.get("errcode"):
            print(f"❌ API error {result.get('errcode')} - {result.get('errmsg', 'Unknown error')}")
            return False
        else:
            print(f"✅ {code_type} code {code} created successfully")
            return True

    except requests.exceptions.Timeout:
        print("❌ TTLock API timeout")
        return False
    except Exception as e:
        print(f"❌ TTLock API error: {e}")
        return False
