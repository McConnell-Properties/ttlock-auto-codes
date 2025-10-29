# multi_property_lock_codes.py - TTLock API helper module
import requests
import os
import time
import json
# Credentials (set by calling script from environment)
CLIENT_ID = None
ACCESS_TOKEN = None
CLIENT_SECRET = '19e2a1afb5bfada46f6559c346777017'
  
# required for refresh flow
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
        lock_id (int): TTLock lock ID
        code (str): PIN code to create
        name (str): Name for the PIN code
        start_ms (int): Start time in milliseconds
        end_ms (int): End time in milliseconds
        description (str): Description for the code
        booking_id (str): Reference booking ID for tracking
    
    Returns:
        dict: API response or error dict
    """
    
    global ACCESS_TOKEN, CLIENT_ID
    
    
    # Debug: Print input parameters
    
    print(f"[DEBUG] create_lock_code_simple called with:")
    
    print(f"  lock_id={lock_id}, code={code}, name={name}")
    
    print(f"  start_ms={start_ms}, end_ms={end_ms}")
    
    print(f"  description={description}, booking_id={booking_id}")
    
    
    # Ensure we have valid credentials
    
    if not CLIENT_ID or not ACCESS_TOKEN:
        print("[ERROR] CLIENT_ID or ACCESS_TOKEN not set. Call initialize_ttlock() first.")
        return {"success": False, "error": "Credentials not initialized"}
    
    
    # Construct API request
    endpoint = f"{TTLOCK_API_BASE}/v3/keyboardPwd/add"
    
    # Get current time in milliseconds for the 'date' field
    current_time_ms = int(time.time() * 1000)
    
    # TTLock /v3/keyboardPwd/add API requires these exact field names
    payload = {
        "clientId": CLIENT_ID,
        "accessToken": ACCESS_TOKEN,
        "lockId": lock_id,
        "keyboardPwd": str(code),
        "keyboardPwdName": name,
        "keyboardPwdType": 3,
        "startDate": int(start_ms),
        "endDate": int(end_ms),
        "addType": 2,
        "date": current_time_ms,
    }
    
    
    try:
        print(f"[DEBUG] Sending POST request to {endpoint}")
        print(f"[DEBUG] Payload: {payload}")
        response = requests.post(
            endpoint,
            data=payload,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=10
        )
        print(f"[DEBUG] API Response Status: {response.status_code}")
        print(f"[DEBUG] API Response Body: {response.text}")
        
        
        if response.status_code == 200:
            result = response.json()
            if result.get("success"):
                print(f"[DEBUG] Successfully created lock code. booking_id={booking_id}")
                return result
            else:
                print(f"[ERROR] API returned success=false: {result}")
                return result
        else:
            print(f"[ERROR] API returned status {response.status_code}")
            return {"success": False, "error": f"Status {response.status_code}"}
    except Exception as e:
        print(f"[ERROR] Exception in create_lock_code_simple: {e}")
        return {"success": False, "error": str(e)}
def initialize_ttlock(client_id, access_token):
    """Initialize TTLock credentials."""
    global CLIENT_ID, ACCESS_TOKEN
    CLIENT_ID = client_id
    ACCESS_TOKEN = access_token
    print(f"[DEBUG] TTLock initialized with CLIENT_ID={client_id}")
