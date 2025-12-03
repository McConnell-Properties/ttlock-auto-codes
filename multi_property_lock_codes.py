# multi_property_lock_codes.py - TTLock API helper module
import requests
import os
import time
import json
import hashlib

# -----------------------------
# CONSTANTS & CREDENTIALS
# -----------------------------
CLIENT_ID = None  # Set by initialize_ttlock()
CLIENT_SECRET = '19e2a1afb5bfada46f6559c346777017'

USERNAME = 'info@mcconnell-properties.com'
PASSWORD = 'Richard2025$'

OAUTH_HOST = 'https://api.sciener.com'
TTLOCK_API_BASE = 'https://euapi.ttlock.com'
TOKEN_FILE = 'ttlock_token.json'

# -----------------------------
# PROPERTY CONFIG
# -----------------------------
PROPERTIES = {
    "Tooting": {
        "FRONT_DOOR_LOCK_ID": 20641052,
        "ROOM_LOCK_IDS": {
            'Room 1': 21318606,
            'Room 2': 21321678,
            'Room 3': 21319208,
            'Room 4': 21321180,
            'Room 5': 21321314,
            'Room 6': 21973872,
        },
    },
    "Streatham": {
        "FRONT_DOOR_LOCK_ID": 16273050,
        "ROOM_LOCK_IDS": {
            'Room 1': 24719576,
            'Room 2': 24641840,
            'Room 3': 24719570,
            'Room 4': 24746950,
            'Room 5': 24717236,
            'Room 6': 24717242,
            'Room 7': 26157268,
            'Room 8': None,
            'Room 9': 24692300,
            'Room 10': 24717964,
            'Room 11': None,
        },
    },
    "Norwich": {
        "FRONT_DOOR_LOCK_ID": 17503964,
        "ROOM_LOCK_IDS": {
            'Room 1': None,
            'Room 2': None,
            'Room 3': None,
            'Room 4': None,
            'Room 5': None,
        },
    },
}

# -----------------------------
# TOKEN MANAGEMENT
# -----------------------------
def load_token():
    """Load token JSON if it exists."""
    if not os.path.exists(TOKEN_FILE):
        return None
    try:
        with open(TOKEN_FILE, "r") as f:
            return json.load(f)
    except:
        return None


def save_token(data):
    with open(TOKEN_FILE, "w") as f:
        json.dump(data, f, indent=2)


def request_new_token():
    """Request a brand-new TTLock access token."""
    print("🔄 Requesting new TTLock access token…")

    md5_pwd = hashlib.md5(PASSWORD.encode("utf-8")).hexdigest()

    resp = requests.post(
        f"{OAUTH_HOST}/oauth2/token",
        data={
            "client_id": CLIENT_ID,
            "client_secret": CLIENT_SECRET,
            "username": USERNAME,
            "password": md5_pwd,
            "grant_type": "password"
        },
        timeout=10
    )

    # Parse JSON safely
    try:
        data = resp.json()
    except:
        raise Exception(f"❌ Token endpoint returned non-JSON response: {resp.text}")

    print("🔎 Raw token response:", data)

    # TTLock returns error codes inside JSON
    if "access_token" not in data:
        err = data.get("errmsg") or data
        raise Exception(f"❌ Failed to obtain access token: {err}")

    # Add expiry timestamp
    data["expires_at"] = int(time.time()) + data.get("expires_in", 7200) - 60

    save_token(data)
    print("✅ Token refreshed and saved.")

    return data


def get_access_token():
    """Return a valid access token, refreshing if expired."""
    token = load_token()

    if not token or "expires_at" not in token or time.time() >= token["expires_at"]:
        token = request_new_token()

    return token["access_token"]

# -----------------------------
# LOCK CODE CREATION
# -----------------------------
def create_lock_code_simple(lock_id, code, name, start_ms, end_ms, description, booking_id):
    """Create a lock PIN code with automatic token management."""

    print(f"[DEBUG] create_lock_code_simple called with:")
    print(f"  lock_id={lock_id}, code={code}, name={name}")
    print(f"  start_ms={start_ms}, end_ms={end_ms}")
    print(f"  description={description}, booking_id={booking_id}")

    if not CLIENT_ID:
        return {"success": False, "error": "CLIENT_ID not set — call initialize_ttlock() first"}

    # Always get a fresh token
    access_token = get_access_token()

    payload = {
        "clientId": CLIENT_ID,
        "accessToken": access_token,
        "lockId": lock_id,
        "keyboardPwd": str(code),
        "keyboardPwdName": name,
        "keyboardPwdType": 3,
        "startDate": int(start_ms),
        "endDate": int(end_ms),
        "addType": 2,
        "date": int(time.time() * 1000),
    }

    endpoint = f"{TTLOCK_API_BASE}/v3/keyboardPwd/add"

    print(f"[DEBUG] Sending POST to {endpoint}")
    print(f"[DEBUG] Payload: {payload}")

    try:
        response = requests.post(
            endpoint,
            data=payload,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=12
        )

        print(f"[DEBUG] Response status: {response.status_code}")
        print(f"[DEBUG] Response body: {response.text}")

        result = response.json()

        # TTLock success is identified by errcode == 0
        if result.get("errcode") == 0:
            print(f"✅ TTLock code created successfully for booking {booking_id}")
            return {"success": True, "data": result}

        print(f"❌ TTLock error: {result}")
        return {"success": False, "error": result}

    except Exception as e:
        print(f"❌ Exception while creating lock code: {e}")
        return {"success": False, "error": str(e)}

# -----------------------------
# INITIALIZE CREDENTIALS
# -----------------------------
def initialize_ttlock(client_id):
    global CLIENT_ID
    CLIENT_ID = client_id
    print(f"[DEBUG] TTLock initialized with CLIENT_ID={client_id}")
