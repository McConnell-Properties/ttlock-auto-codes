import requests
import csv
import time
import os

CLIENT_ID = "3a5eb18b49bc4df0b85703071f9e96a5"
ACCESS_TOKEN = "f198b2b3203b3d526bf86dddfc65473d"
LOCK_IDS = {
    "Streatham": 16273050,
    "Tooting": 20641052,
    "Norwich": 17503964,
}
API_BASE = "https://euapi.ttlock.com/v3/lockRecord/list"
GAS_WEB_APP_URL = "YOUR_GAS_WEB_APP_URL"  # Provide your Apps Script URL here!

def fetch_unlock_records(location, lock_id):
    timestamp = int(time.time())
    payload = {
        'clientId': CLIENT_ID,
        'accessToken': ACCESS_TOKEN,
        'lockId': lock_id,
        'date': timestamp,
        'pageNo': 1,
        'pageSize': 100,
    }
    response = requests.post(API_BASE, data=payload, timeout=15)
    response.raise_for_status()
    data = response.json()
    if "list" in data:
        for record in data["list"]:
            record["location"] = location
    return data.get("list", [])

def main():
    all_records = []
    for location, lock_id in LOCK_IDS.items():
        print(f"[Agent] Fetching unlock records for {location} (Lock ID {lock_id})...")
        records = fetch_unlock_records(location, lock_id)
        all_records.extend(records)

    if not all_records:
        print("[Agent] No records fetched!")
        return
    csv_filename = "unlock_records.csv"
    with open(csv_filename, "w", newline="", encoding='utf-8') as csvfile:
        fieldnames = list(all_records[0].keys())
        writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(all_records)
    print(f"[Agent] CSV created: {csv_filename}")

    print("[Agent] Uploading CSV to Google Apps Script endpoint...")
    with open(csv_filename, "rb") as f:
        response = requests.post(GAS_WEB_APP_URL, files={'file': f})
        print(f"[Agent] Upload status: {response.status_code} | {response.text}")

if __name__ == "__main__":
    main()
