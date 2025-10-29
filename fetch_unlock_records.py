import requests
import csv
import time
import os
import json
import sys

CLIENT_ID = "3a5eb18b49bc4df0b85703071f9e96a5"
CLIENT_SECRET = "d01e2f2a7d5f451eacc3f5f8c7a9e1b4"  # Provided for token refresh
REFRESH_TOKEN = "refresh_token_placeholder"  # Will be loaded from file if available
ACCESS_TOKEN = "f198b2b3203b3d526bf86dddfc65473d"

LOCK_IDS = {
    "Streatham": 16273050,
    "Tooting": 20641052,
    "Norwich": 17503964,
}

API_BASE = "https://euapi.ttlock.com/v3/lockRecord/list"
TOKEN_API = "https://euapi.ttlock.com/v3/oauth2/token"
GAS_WEB_APP_URL = "YOUR_GAS_WEB_APP_URL"  # Provide your Apps Script URL here!

# Store current token in a global variable
current_access_token = ACCESS_TOKEN

def load_token_from_file():
    """Load access token from ttlock_token.json if it exists"""
    global current_access_token
    try:
        if os.path.exists('ttlock_token.json'):
            with open('ttlock_token.json', 'r') as f:
                token_data = json.load(f)
                if 'access_token' in token_data:
                    current_access_token = token_data['access_token']
                    print(f"[DEBUG] Loaded access token from ttlock_token.json")
                    return True
    except Exception as e:
        print(f"[DEBUG] Failed to load token from file: {e}")
    return False

def refresh_access_token():
    """Attempt to refresh the access token using the refresh token and client secret"""
    global current_access_token
    print("[DEBUG] Attempting to refresh access token...")
    
    try:
        payload = {
            'clientId': CLIENT_ID,
            'clientSecret': CLIENT_SECRET,
            'grantType': 'refresh_token',
            'refreshToken': REFRESH_TOKEN,
        }
        
        response = requests.post(TOKEN_API, data=payload, timeout=15)
        print(f"[DEBUG] Token refresh response status: {response.status_code}")
        print(f"[DEBUG] Token refresh response body: {response.text}")
        
        if response.status_code == 200:
            data = response.json()
            if 'access_token' in data:
                current_access_token = data['access_token']
                print(f"[DEBUG] Successfully refreshed access token: {current_access_token[:20]}...")
                
                # Save the new token
                try:
                    with open('ttlock_token.json', 'w') as f:
                        json.dump(data, f, indent=2)
                    print(f"[DEBUG] Saved new access token to ttlock_token.json")
                except Exception as e:
                    print(f"[DEBUG] Failed to save token file: {e}")
                
                return True
        else:
            print(f"[ERROR] Failed to refresh token: {response.status_code}")
    except Exception as e:
        print(f"[ERROR] Exception during token refresh: {e}")
    
    return False

def fetch_unlock_records(location, lock_id, attempt=1):
    """Fetch unlock records for a specific lock"""
    global current_access_token
    
    print(f"\n[DEBUG] ===== FETCH ATTEMPT {attempt} for {location} (Lock ID {lock_id}) =====")
    
    try:
        # TTLock API expects timestamp in MILLISECONDS, not seconds
        timestamp = int(time.time() * 1000)
        payload = {
            'clientId': CLIENT_ID,
            'accessToken': current_access_token,
            'lockId': lock_id,
            'date': timestamp,
            'pageNo': 1,
            'pageSize': 100,
        }
        
        print(f"[DEBUG] Request payload: clientId={CLIENT_ID}, accessToken={current_access_token[:20]}..., lockId={lock_id}, date={timestamp}")
        print(f"[DEBUG] Sending POST request to: {API_BASE}")
        
        response = requests.post(API_BASE, data=payload, timeout=15)
        
        print(f"[DEBUG] Response status code: {response.status_code}")
        print(f"[DEBUG] Response headers: {dict(response.headers)}")
        print(f"[DEBUG] Full response text: {response.text}")
        
        response.raise_for_status()
        
        data = response.json()
        print(f"[DEBUG] Parsed JSON response: {json.dumps(data, indent=2)}")
        
        # Check for error codes in the response
        if 'errcode' in data:
            errcode = data.get('errcode')
            errmsg = data.get('errmsg', 'Unknown error')
            print(f"[ERROR] API returned error code {errcode}: {errmsg}")
            
            # If token is invalid (code 10001 or similar), try to refresh
            if errcode in [10001, 401, 403]:
                print(f"[DEBUG] Token may be invalid (error code {errcode}). Attempting refresh...")
                if refresh_access_token():
                    print(f"[DEBUG] Token refreshed. Retrying fetch...")
                    if attempt < 3:
                        return fetch_unlock_records(location, lock_id, attempt + 1)
            
            return None
        
        if "list" in data:
            for record in data["list"]:
                record["location"] = location
            print(f"[DEBUG] Successfully fetched {len(data['list'])} records for {location}")
            return data.get("list", [])
        else:
            print(f"[DEBUG] No 'list' key in response for {location}. Available keys: {list(data.keys())}")
            return data.get("list", [])
    
    except requests.exceptions.HTTPError as e:
        print(f"[ERROR] HTTP Error: {e}")
        print(f"[ERROR] Response status: {response.status_code if 'response' in locals() else 'N/A'}")
        print(f"[ERROR] Response body: {response.text if 'response' in locals() else 'N/A'}")
        return None
    
    except requests.exceptions.RequestException as e:
        print(f"[ERROR] Request Exception: {e}")
        return None
    
    except json.JSONDecodeError as e:
        print(f"[ERROR] JSON Decode Error: {e}")
        print(f"[ERROR] Raw response: {response.text if 'response' in locals() else 'N/A'}")
        return None
    
    except Exception as e:
        print(f"[ERROR] Unexpected exception: {type(e).__name__}: {e}")
        import traceback
        print(traceback.format_exc())
        return None

def main():
    """Main function to fetch records from all locks"""
    print("[Agent] ===== STARTING UNLOCK RECORDS FETCH =====")
    print(f"[Agent] Timestamp: {time.strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"[Agent] Client ID: {CLIENT_ID}")
    print(f"[Agent] Initial Access Token: {current_access_token[:20]}...")
    
    # Try to load token from file
    load_token_from_file()
    
    all_records = []
    successful_locations = 0
    failed_locations = 0
    
    for location, lock_id in LOCK_IDS.items():
        print(f"\n[Agent] Processing location: {location}")
        records = fetch_unlock_records(location, lock_id)
        
        if records is None:
            failed_locations += 1
            print(f"[Agent] FAILED to fetch records for {location}")
        elif len(records) == 0:
            print(f"[Agent] No records returned for {location} (may be empty)")
        else:
            successful_locations += 1
            all_records.extend(records)
            print(f"[Agent] Successfully fetched {len(records)} records for {location}")
    
    print(f"\n[Agent] ===== SUMMARY =====")
    print(f"[Agent] Successful locations: {successful_locations}")
    print(f"[Agent] Failed locations: {failed_locations}")
    print(f"[Agent] Total records fetched: {len(all_records)}")
    
    if not all_records:
        print(f"[Agent] ERROR: No records fetched from any location!")
        print(f"[Agent] Script will exit with failure status.")
        sys.exit(1)
    
    csv_filename = "unlock_records.csv"
    try:
        with open(csv_filename, "w", newline="", encoding='utf-8') as csvfile:
            fieldnames = list(all_records[0].keys())
            writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(all_records)
        print(f"[Agent] CSV created: {csv_filename}")
    except Exception as e:
        print(f"[Agent] ERROR: Failed to create CSV: {e}")
        sys.exit(1)
    
    print(f"[Agent] ===== PROCESS COMPLETED SUCCESSFULLY =====")
    sys.exit(0)

if __name__ == "__main__":
    main()
