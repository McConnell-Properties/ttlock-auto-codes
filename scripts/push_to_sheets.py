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

    # 1. Sync both raw database files
    for csv_file, sheet_tab in DATA_MAPPING.items():
        push_csv_to_sheet(client, csv_file, sheet_tab)

    # 2. TRIGGER THE AUTOMATIC DASHBOARD PROCESSOR
    sync_crm_dashboard_live(client)

    print("=== Google Sheets Export Complete ===")


# ==============================================================================
# AUTOMATIC CRM DASHBOARD SYNC SYSTEM (SMART UPDATE ENGINE)
# ==============================================================================

def clean_crm_date(date_str):
    if not date_str: return ""
    date_str = str(date_str).strip()
    return date_str[:10] if len(date_str) >= 10 else date_str

def clean_crm_int(val):
    try: return int(float(str(val).strip()))
    except: return 0

def sync_crm_dashboard_live(client):
    print("🚀 Starting CRM Dashboard Smart Update processing...")
    
    try:
        spreadsheet = client.open_by_key(SPREADSHEET_ID)
        crm_sheet = spreadsheet.worksheet("CRM Dashboard")
        raw_res_sheet = spreadsheet.worksheet("Raw_Reservations")
        raw_stripe_sheet = spreadsheet.worksheet("Raw_Stripe_Deposits")
    except Exception as e:
        print(f"❌ Sheet selection error: {e}. Ensure tab names match exactly.")
        return

    # Fetch raw data records
    raw_res_records = raw_res_sheet.get_all_records()
    raw_stripe_records = raw_stripe_sheet.get_all_records()

    # Fetch the CRM as a 2D grid of strings to easily pinpoint row numbers
    crm_grid = crm_sheet.get_all_values()

    # Map existing CRM rows by reservation_code (Column A)
    # This tracks the physical row number on the spreadsheet
    crm_row_map = {}
    for idx, row in enumerate(crm_grid):
        if idx == 0: continue  # Skip the header row
        if row:  # Ensure the row isn't completely blank
            res_code = str(row[0]).strip()
            if res_code:
                crm_row_map[res_code] = {
                    "sheet_row": idx + 1,        # 1-based index for Google Sheets
                    "current_data": row[:34]     # Columns A through AH
                }

    # Map Stripe updates for quick lookup
    stripe_map = {}
    for row in raw_stripe_records:
        res_code = str(row.get("reservation_code", "")).strip()
        if res_code:
            stripe_map[res_code] = {
                "url": row.get("payment_url", "No Link"),
                "status": row.get("status", "No Status")
            }

    new_crm_rows = []
    updates_batch = []

    # Map rows matching your exact CRM schema structure
    for row in raw_res_records:
        res_code = str(row.get("reservation_code", "")).strip()
        if not res_code:
            continue

        stripe_data = stripe_map.get(res_code, {"url": "No Link", "status": "No Status"})

        # Build the fresh 34-column array
        crm_row = [
            res_code,                                          # A: reservation_code
            row.get("Booking reference", ""),                  # B
            row.get("booked", ""),                             # C
            row.get("property_name", ""),                      # D
            row.get("channel_name", ""),                       # E
            row.get("promotion_code", ""),                     # F
            row.get("guest_first_name", ""),                   # G
            row.get("guest_last_name", ""),                    # H
            row.get("guest_email", ""),                        # I
            row.get("guest_phone_number", ""),                 # J
            row.get("guest_organisation", ""),                 # K
            row.get("guest_address", ""),                      # L
            row.get("guest_address2", ""),                     # M
            row.get("guest_city", ""),                         # N
            row.get("guest_state", ""),                        # O
            row.get("guest_country", ""),                      # P
            row.get("guest_post_code", ""),                    # Q
            clean_crm_date(row.get("Check in date", "")),      # R
            clean_crm_date(row.get("Check out date", "")),     # S
            clean_crm_int(row.get("length_of_stay_(nights)", 0)), # T
            row.get("arrival_time", ""),                       # U
            row.get("guest_comments", ""),                     # V
            row.get("notes", ""),                              # W
            row.get("requested_newsletter", ""),               # X
            row.get("status", ""),                             # Y
            row.get("cancelled_at", ""),                       # Z
            row.get("room_types", ""),                         # AA
            clean_crm_int(row.get("number_of_adults", 0)),     # AB
            clean_crm_int(row.get("number_of_children", 0)),   # AC
            clean_crm_int(row.get("number_of_infants", 0)),    # AD
            row.get("front_door_lock_set", ""),                # AE
            row.get("room_lock_set", ""),                      # AF
            stripe_data["url"],                                # AG
            stripe_data["status"]                              # AH
        ]

        if res_code in crm_row_map:
            # The booking exists! Let's check if any data has changed.
            sheet_row_num = crm_row_map[res_code]["sheet_row"]
            current_values = crm_row_map[res_code]["current_data"]

            # Ensure the current_values array is exactly 34 columns long
            current_values += [""] * (34 - len(current_values))

            # Convert our fresh data to strings to safely compare against the sheet's raw text
            crm_row_str = [str(x) for x in crm_row]

            # If the data has been modified, queue a targeted overwrite for Columns A -> AH only
            if current_values != crm_row_str:
                updates_batch.append({
                    'range': f'A{sheet_row_num}:AH{sheet_row_num}',
                    'values': [crm_row]
                })
        else:
            # The booking is brand new! Add it to the append list.
            new_crm_rows.append(crm_row)

    # Execute targeted overwrites for modified existing rows
    if updates_batch:
        print(f"🔄 Sync Engine: Updating {len(updates_batch)} modified existing records...")
        crm_sheet.batch_update(updates_batch, value_input_option="USER_ENTERED")
    else:
        print("ℹ️ Sync Engine: No existing records required updating.")

    # Execute appends for brand-new rows
    if new_crm_rows:
        print(f"🚀 Sync Engine: Appending {len(new_crm_rows)} brand new records...")
        crm_sheet.append_rows(new_crm_rows, value_input_option="USER_ENTERED")
    else:
        print("ℹ️ Sync Engine: No new records to append.")

    print("✅ CRM Synchronization successfully closed.")

if __name__ == "__main__":
    main()
