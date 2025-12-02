#!/usr/bin/env python3
"""
Audit all TTLock codes across all properties and devices.
Fetches current lock codes and exports to CSV for analysis.
"""
import os
import csv
import requests
from datetime import datetime
from multi_property_lock_codes import PROPERTIES

# Credentials
CLIENT_ID = os.getenv('TTLOCK_CLIENT_ID')
ACCESS_TOKEN = os.getenv('TTLOCK_ACCESS_TOKEN')
CLIENT_SECRET = os.getenv('TTLOCK_CLIENT_SECRET')

TTLOCK_API_BASE = 'https://euapi.ttlock.com'

def fetch_lock_codes(lock_id):
    """
    Fetch all keyboard passwords for a specific lock.
    GET /v3/keyboardPwd/query
    Implements pagination to fetch ALL codes across all pages.
    """
    all_codes = []
    page_no = 1
    page_size = 100
    
    try:
        while True:
            url = f"{TTLOCK_API_BASE}/v3/keyboardPwd/query"
            params = {
                'clientId': CLIENT_ID,
                'accessToken': ACCESS_TOKEN,
                'lockId': lock_id,
                'pageNo': page_no,
                'pageSize': page_size
            }
            
            response = requests.get(url, params=params)
            
            if response.status_code == 200:
                data = response.json()
                if data.get('success'):
                    codes = data.get('list', [])
                    
                    if not codes:
                        # No more codes to fetch
                        break
                    
                    all_codes.extend(codes)
                    
                    # If we got fewer codes than pageSize, this is the last page
                    if len(codes) < page_size:
                        break
                    
                    # Move to next page
                    page_no += 1
                else:
                    print(f"❌ API error for lock {lock_id}: {data.get('msg', 'Unknown error')}")
                    break
            else:
                print(f"❌ HTTP {response.status_code} for lock {lock_id}")
                print(f"   Response: {response.text}")
                break
    
    except Exception as e:
        print(f"❌ Exception fetching lock {lock_id}: {e}")
    
    return all_codes

def audit_all_locks():
    """
    Audit all locks across all properties.
    """
    results = []
    
    print("🔐 Starting TTLock Code Audit")
    print("="*60)
    
    # Iterate through all properties
    for property_name, property_config in PROPERTIES.items():
        print(f"\n🏢 Property: {property_name}")
        print("-"*60)
        
        locks_to_check = []
        
        # Add front door lock
        front_door_id = property_config.get('FRONT_DOOR_LOCK_ID')
        if front_door_id:
            locks_to_check.append(('Front Door', front_door_id))
        
        # Add room locks
        room_locks = property_config.get('ROOM_LOCK_IDS', {})
        for room_name, lock_id in room_locks.items():
            if lock_id:  # Only if configured (not None)
                locks_to_check.append((f'Room {room_name}', lock_id))
        
        if not locks_to_check:
            print(f" ⚠️ No locks configured for {property_name}")
            continue
        
        # Audit each lock
        for lock_name, lock_id in locks_to_check:
            print(f"\n 🔍 Auditing {lock_name} (Lock ID: {lock_id})...")
            
            codes = fetch_lock_codes(lock_id)
            
            if not codes:
                print(f" ℹ️ No codes found on this lock")
                results.append({
                    'timestamp': datetime.now().isoformat(),
                    'property': property_name,
                    'lock_name': lock_name,
                    'lock_id': lock_id,
                    'total_codes': 0,
                    'code': 'N/A',
                    'code_name': 'N/A',
                    'guest_name': 'N/A',
                    'start_time': 'N/A',
                    'end_time': 'N/A',
                    'code_id': 'N/A',
                    'status': 'No codes'
                })
            else:
                print(f" ✅ Found {len(codes)} code(s)")
                
                for code_entry in codes:
                    code_name = code_entry.get('keyboardPwdName', 'Unknown')
                    code_value = code_entry.get('keyboardPwd', 'N/A')
                    start_time = code_entry.get('startDate', 'N/A')
                    end_time = code_entry.get('endDate', 'N/A')
                    code_id = code_entry.get('id', 'N/A')
                    
                    # Convert timestamps to readable format
                    if start_time != 'N/A' and isinstance(start_time, (int, float)):
                        start_time = datetime.fromtimestamp(start_time/1000).isoformat()
                    if end_time != 'N/A' and isinstance(end_time, (int, float)):
                        end_time = datetime.fromtimestamp(end_time/1000).isoformat()
                    
                    print(f" • Code: {code_value}")
                    print(f"   Name: {code_name}")
                    print(f"   ID: {code_id}")
                    print(f"   Start: {start_time}")
                    print(f"   End: {end_time}")
                    
                    results.append({
                        'timestamp': datetime.now().isoformat(),
                        'property': property_name,
                        'lock_name': lock_name,
                        'lock_id': lock_id,
                        'total_codes': len(codes),
                        'code': code_value,
                        'code_name': code_name,
                        'code_id': code_id,
                        'start_time': start_time,
                        'end_time': end_time,
                        'guest_name': 'N/A',  # This might be in code_name
                        'status': 'Active'
                    })
    
    # Export to CSV
    print(f"\n\n" + "="*60)
    print("📊 Generating Report...")
    
    if results:
        filename = f"ttlock_log.csv"
        with open(filename, 'w', newline='', encoding='utf-8') as f:
            fieldnames = [
                'timestamp', 'property', 'lock_name', 'lock_id', 'total_codes',
                'code', 'code_name', 'code_id', 'start_time', 'end_time', 'guest_name', 'status'
            ]
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(results)
        
        print(f"✅ Audit report saved to: {filename}")
        print(f"📈 Total entries: {len(results)}")
    else:
        print("❌ No results to export")
    
    # Summary
    print("\n" + "="*60)
    print("✅ Audit complete")
    print("="*60)

if __name__ == '__main__':
    try:
        if not CLIENT_ID or not ACCESS_TOKEN:
            raise ValueError("❌ TTLOCK_CLIENT_ID or TTLOCK_ACCESS_TOKEN not set")
        
        audit_all_locks()
    except Exception as e:
        print(f"\n❌ Fatal error: {e}")
        exit(1)
