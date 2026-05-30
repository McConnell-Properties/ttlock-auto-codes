import os
import csv
import json
import gspread
from oauth2client.service_account import ServiceAccountCredentials

SPREADSHEET_ID = os.getenv("SPREADSHEET_ID")

# Define the local CSVs and where they go in Google Sheets
DATA_MAPPING = {
    "automation-data/reservation_status.csv": "Raw_Reservations",
    "automation-data/stripe_deposit_log.csv": "Raw_Stripe_Deposits"
}

def push_csv_to_sheet(client, csv_path, worksheet_name):
    """Reads a local CSV file and completely overwrites a Google Worksheet with its contents."""
    if not os.path.exists(csv_path):
        print(f"ℹ️ {csv_path} does not exist yet. Skipping.")
        return

    print(f"📊 Reading {csv_path}...")
    
    # Read the CSV data into a list of lists (rows)
    with open(csv_path, mode="r", encoding="utf-8") as f:
        reader = csv.reader(f)
        rows = list(reader)

    if not rows:
        print(f"ℹ️ {csv_path} is empty. Skipping.")
        return

    try:
        # Open the specific tab
        sheet = client.open_by_key(SPREADSHEET_ID).worksheet(worksheet_name)
        
        # Clear any old data to prevent overlapping ghost rows
        sheet.clear()
        
        # Upload the entire dataset at once (avoids API rate limits)
        sheet.update(range_name="A1", values=rows)
        print(f"✅ Successfully pushed to Google Sheet tab: '{worksheet_name}' ({len(rows) - 1} rows)")
        
    except gspread.exceptions.WorksheetNotFound:
        print(f"❌ Error: Could not find a tab named '{worksheet_name}' in your Google Sheet. Please create it!")
    except Exception as e:
        print(f"❌ Error updating '{worksheet_name}': {e}")

def main():
    print("=== Google Sheets Export Start ===")
    
    # Validate environment variables
    json_creds = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON")
    if not json_creds or not SPREADSHEET_ID:
        print("❌ Missing GOOGLE_SERVICE_ACCOUNT_JSON or SPREADSHEET_ID environment variables.")
        return

    # Authenticate with Google
    try:
        scope = ["https://www.googleapis.com/auth/spreadsheets"]
        creds_dict = json.loads(json_creds)
        creds = ServiceAccountCredentials.from_json_keyfile_dict(creds_dict, scope)
        client = gspread.authorize(creds)
    except Exception as e:
        print(f"❌ Google Authentication Failed: {e}")
        return

    # 1. Sync the raw database files
    for csv_file, sheet_tab in DATA_MAPPING.items():
        push_csv_to_sheet(client, csv_file, sheet_tab)

    # 2. RUN THE CRM DASHBOARD SYNC ENGINE LIVE!
    sync_crm_dashboard_live(client)

    print("=== Google Sheets Export Complete ===")


# ==============================================================================
# AUTOMATIC CRM DASHBOARD SYNC SYSTEM (FORMULA-FREE FILTERING)
# ==============================================================================

def clean_crm_date(date_str):
    if not date_str: return ""
    date_str = str(date_str).strip()
    return date_str[:10] if len(date_str) >= 10 else date_str

def clean_crm_int(val):
    try: return int(float(str(val).strip()))
    except: return 0

def sync_crm_dashboard_live(client):
    print("Starting CRM Dashboard live processing...")
    
    try:
        # Open using the shared ID to guarantee a match
        spreadsheet = client.open_by_key(SPREADSHEET_ID)
        crm_sheet = spreadsheet.worksheet("CRM Dashboard")
        raw_res_sheet = spreadsheet.worksheet("Raw_Reservations")
        raw_stripe_sheet = spreadsheet.worksheet("Raw_Stripe_Deposits")
    except Exception as e:
        print(f"❌ Sheet selection error: {e}. Ensure tab names match exactly.")
        return

    # Fetch records safely
    crm_records = crm_sheet.get_all_records()
    raw_res_records = raw_res_sheet.get_all_records()
    raw_stripe_records = raw_stripe_sheet.get_all_records()

    # Track what's already on the dashboard to prevent duplicates
    existing_codes = set(str(row.get("reservation_code", "")).strip() for row in crm_records if row.get("reservation_code"))

    # Map Stripe updates
    stripe_map = {}
    for row in raw_stripe_records:
        res_code = str(row.get("reservation_code", "")).strip()
        if res_code:
            stripe_map[res_code] = {
                "url": row.get("payment_url", "No Link"),
                "status": row.get("status", "No Status")
            }

    new_crm_rows = []

    # Map rows matching your exact CRM schema structure
    for row in raw_res_records:
        res_code = str(row.get("reservation_code", "")).strip()
        if not res_code or res_code in existing_codes:
            continue

        stripe_data = stripe_map.get(res_code, {"url": "No Link", "status": "No Status"})

        crm_row = [
            res_code,                                          # Column A: reservation_code
            row.get("Booking reference", ""),                  # Column B
            row.get("booked", ""),                             # Column C
            row.get("property_name", ""),                      # Column D
            row.get("channel_name", ""),                       # Column E
            row.get("promotion_code", ""),                     # Column F
            row.get("guest_first_name", ""),                   # Column G
            row.get("guest_last_name", ""),                    # Column H
            row.get("guest_email", ""),                        # Column I
            row.get("guest_phone_number", ""),                 # Column J
            row.get("guest_organisation", ""),                 # Column K
            row.get("guest_address", ""),                      # Column L
            row.get("guest_address2", ""),                     # Column M
            row.get("guest_city", ""),                         # Column N
            row.get("guest_state", ""),                        # Column O
            row.get("guest_country", ""),                      # Column P
            row.get("guest_post_code", ""),                    # Column Q
            clean_crm_date(row.get("Check in date", "")),      # Column R: Processed Date
            clean_crm_date(row.get("Check out date", "")),     # Column S: Processed Date
            clean_crm_int(row.get("length_of_stay_(nights)", 0)), # Column T: True Integer
            row.get("arrival_time", ""),                       # Column U
            row.get("guest_comments", ""),                     # Column V
            row.get("notes", ""),                              # Column W
            row.get("requested_newsletter", ""),               # Column X
            row.get("status", ""),                             # Column Y
            row.get("cancelled_at", ""),                       # Column Z
            row.get("room_types", ""),                         # Column AA
            clean_crm_int(row.get("number_of_adults", 0)),     # Column AB: True Integer
            clean_crm_int(row.get("number_of_children", 0)),   # Column AC: True Integer
            clean_crm_int(row.get("number_of_infants", 0)),    # Column AD: True Integer
            row.get("front_door_lock_set", ""),                # Column AE
            row.get("room_lock_set", ""),                      # Column AF
            stripe_data["url"],                                # Column AG: stripe_payment_url
            stripe_data["status"]                              # Column AH: stripe_status
        ]
        new_crm_rows.append(crm_row)

    if new_crm_rows:
        print(f"🚀 Sync Engine: Appending {len(new_crm_rows)} new historical records directly as values...")
        crm_sheet.append_rows(new_crm_rows, value_input_option="USER_ENTERED")
        print("✅ CRM Synchronization successfully closed.")
    else:
        print("ℹ️ Sync Engine: Dashboard is already fully up to date.")

if __name__ == "__main__":
    main()
