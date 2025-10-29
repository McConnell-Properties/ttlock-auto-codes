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

# Property configuration: maps property_location to lock IDs
# Structure: {property_name: {"FRONT_DOOR_LOCK_ID": lock_id, "ROOM_LOCK_IDS": {"Room 1": lock_id, ...}}}
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
            'Room 7': None,
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


def create_lock_code_simple(lock_id, code, name, start_ms, end_ms, description, booking_id):
    """
    Create a simple lock code for TTLock with full API logic including token refresh.
    
    Args:
        lock_id: The TTLock lock ID
        code: The numeric code to create
        name: Name associated with the code
        start_ms: Start time in milliseconds (Unix epoch)
        end_ms: End time in milliseconds (Unix epoch)
        description: Description of the code
        booking_id: Booking reference ID for tracking
    
    Returns:
        bool: True if successful, False otherwise
    """
    global ACCESS_TOKEN
    
    # Debug print at the start of the function
    print(f"🔧 DEBUG: Creating lock code - lock_id={lock_id}, code={code}, name={name}, booking_id={booking_id}")
    
    try:
        # Ensure we have valid token
        if not ACCESS_TOKEN:
            if not load_token_from_file():
                print(f"❌ No valid access token available for lock_id {lock_id}")
                return False
        
        # Prepare the request
        url = f"{TTLOCK_API_BASE}/v3/lock/createEKeyByPassword"
        headers = {'Content-Type': 'application/x-www-form-urlencoded'}
        payload = {
            'accessToken': ACCESS_TOKEN,
            'lockId': lock_id,
            'keyData': code,
            'startDate': start_ms,
            'endDate': end_ms,
            'name': name,
        }
        
        response = requests.post(url, data=payload, headers=headers)
        
        if response.status_code == 200:
            data = response.json()
            if data.get('ok'):
                print(f"✅ Successfully created code '{code}' for lock {lock_id} (booking: {booking_id})")
                return True
            else:
                error_msg = data.get('msg', 'Unknown error')
                print(f"❌ API Error for lock {lock_id}: {error_msg}")
                
                # If token expired, try refreshing and retrying
                if 'token' in error_msg.lower() or 'unauthorized' in error_msg.lower():
                    print(f"🔄 Token may have expired, attempting refresh...")
                    if refresh_access_token():
                        # Retry with new token
                        payload['accessToken'] = ACCESS_TOKEN
                        response = requests.post(url, data=payload, headers=headers)
                        data = response.json()
                        if data.get('ok'):
                            print(f"✅ Successfully created code '{code}' for lock {lock_id} after token refresh (booking: {booking_id})")
                            return True
                
                return False
        else:
            print(f"❌ HTTP Error {response.status_code} for lock {lock_id}: {response.text}")
            return False
    
    except Exception as e:
        print(f"❌ Exception creating code for lock {lock_id}: {str(e)}")
        return False


def load_token_from_file():
    """
    Load access token from file if it exists and is valid.
    """
    global ACCESS_TOKEN
    
    try:
        if os.path.exists(TOKEN_FILE):
            with open(TOKEN_FILE, 'r') as f:
                token_data = json.load(f)
                ACCESS_TOKEN = token_data.get('access_token')
                if ACCESS_TOKEN:
                    print(f"✅ Loaded access token from file")
                    return True
    except Exception as e:
        print(f"❌ Error loading token from file: {str(e)}")
    
    return False


def refresh_access_token():
    """
    Refresh the access token using the OAuth2 refresh flow.
    """
    global ACCESS_TOKEN
    
    try:
        # Try to load the token from environment or file
        token_from_env = os.environ.get('TTLOCK_TOKEN')
        if token_from_env:
            ACCESS_TOKEN = token_from_env
            save_token_to_file(ACCESS_TOKEN)
            return True
        
        # If no environment variable, try to load from file
        if load_token_from_file():
            return True
        
        print(f"❌ Unable to refresh token - no source available")
        return False
    
    except Exception as e:
        print(f"❌ Error refreshing token: {str(e)}")
        return False


def save_token_to_file(token):
    """
    Save access token to file.
    """
    try:
        token_data = {'access_token': token, 'timestamp': int(time.time())}
        with open(TOKEN_FILE, 'w') as f:
            json.dump(token_data, f)
    except Exception as e:
        print(f"❌ Error saving token to file: {str(e)}")
