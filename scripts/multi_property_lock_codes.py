# multi_property_lock_codes.py - TTLock API helper module
import requests
import os
import time
import json
import hashlib

# -----------------------------
# CONSTANTS & CREDENTIALS
# -----------------------------
CLIENT_ID = None  # Set dynamically by initialize_ttlock()
CLIENT_SECRET = '19e2a1afb5bfada46f6559c346777017'  # ← correct secret

USERNAME = 'info@mcconnell-properties.com'
PASSWORD = 'Richard2026$'   # ← correct developer password

OAUTH_HOST = 'https://api.sciener.com'
TTLOCK_API_BASE = 'https://euapi.ttlock.com'
TOKEN_FILE = 'ttlock_token.json'

# -----------------------------
# PROPERTY CONFIG
# -----------------------------
PROPERTIES = {
    "Tooting Stays": {
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
    "Streatham Rooms": {
        "FRONT_DOOR_LOCK_ID": 16273050,
        "ROOM_LOCK_IDS": {
            'Room 1': 24719576,
            'Room 2': 24641840,
            'Room 3': 24719570,
            'Room 4': 24746950,
            'Room 5': 24717236,
            'Room 6': 24717242,
            'Room 7': 26157268,
            'Room 8': 30947344,
            'Room 9': 24692300,
            'Room 10': 24717964,
            'Room 11': None,
        },
    },
    "Gassiot House": {
        "FRONT_DOOR_LOCK_ID": 28606668,
        "ROOM_LOCK_IDS": {
            'Room 1': 31262246,
            'Room 2': 31261208,
            'Room 3': 31262700,
            'Room 4': 31424108,
            'Room 5': 31263276,
            'Room 6': 31423836,
            'Room 7': 31262938,
        },
    },
    "Valnay Stays": {
        "FRONT_DOOR_LOCK_ID": 27821908,
        "ROOM_LOCK_IDS": {
            'Room 1': 31453562,
            'Room 2': 31285682,
            'Room 3': 30948194,
            'Room 4': 28062262,
            'Room 5': 28065142,
            'Room 6': 31284258,
        },
    },
}

# -----------------------------
# TOKEN MANAGEMENT
# -----------------------------
def load_token():
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
    """Request a new TTLock OAuth token using developer credentials."""
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

    try:
        data = resp.json()
    except:
        raise Exception(f"❌ Token endpoint returned non-JSON response: {resp.text}")

    print("🔎 Raw token response:", data)

    if "access_token" not in data:
        raise Exception(f"❌ Failed to obtain access token: {data}")

    data["expires_at"] = int(time.time()) + data["expires_in"] - 60

    save_token(data)
    print("✅ Token refreshed and saved.")
    return data

def get_access_token():
    """Return a valid access token, refreshing automatically."""
    token = load_token()

    if not token or "expires_at" not in token or time.time() >= token["expires_at"]:
        token = request_new_token()

    return token["access_token"]

# -----------------------------
# CREATE LOCK CODE (WITH RETRIES)
# -----------------------------
def create_lock_code_simple(lock_id, code, name, start_ms, end_ms, description, booking_id, max_retries=3):
    """Create a TTLock code with accurate success detection + retry logic."""
    global CLIENT_ID

    print(f"[DEBUG] create_lock_code_simple called with:")
    print(f"  lock_id={lock_id}, code={code}, name={name}")
    print(f"  start_ms={start_ms}, end_ms={end_ms}")
    print(f"  description={description}, booking_id={booking_id}")

    if not CLIENT_ID:
        return False, "CLIENT_ID not set"

    for attempt in range(1, max_retries + 1):

        print(f"[DEBUG] Attempt {attempt}/{max_retries} for lock {lock_id}")

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

            try:
                result = response.json()
            except:
                print("[ERROR] JSON parse failed, retrying…")
                continue

            # TRUE SUCCESS
            if "keyboardPwdId" in result:
                print("✅ TTLock code created successfully!")
                return True, result

            # DUPLICATE CODE = REAL FAILURE, do NOT retry
            if result.get("errcode") == -3007:
                print("❌ Duplicate passcode. Will NOT retry.")
                return False, result

            # OTHER ERRORS → retry
            print(f"[ERROR] TTLock error: {result}, retrying…")
            continue

        except Exception as e:
            print(f"[ERROR] Exception: {e}, retrying…")
            continue

    print("❌ All retry attempts failed.")
    return False, f"Failed after {max_retries} retries"

# -----------------------------
# INITIALIZE CREDENTIALS
# -----------------------------
def initialize_ttlock(client_id):
    """Called by run_bookings.py to set client ID from environment."""
    global CLIENT_ID
    CLIENT_ID = client_id
    print(f"[DEBUG] TTLock initialized with CLIENT_ID={client_id}")
