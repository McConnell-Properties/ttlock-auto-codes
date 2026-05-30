import os
import json
import gspread
from oauth2client.service_account import ServiceAccountCredentials

def clean_date(date_str):
    """Trims timestamps like '2026-06-02 00:00:00+00:00' down to standard '2026-06-02'"""
    if not date_str:
        return ""
    date_str = str(date_str).strip()
    if len(date_str) >= 10:
        return date_str[:10]
    return date_str

def clean_int(val):
    """Converts number strings safely to actual integers so Google Sheets treats them as numeric values"""
    try:
        return int(float(str(val).strip()))
    except (ValueError, TypeError):
        return 0

def sync_crm_pipeline():
    # 1. Authenticate with Google Sheets
    scope = ["https://spreadsheets.google.com/feeds", "https://www.googleapis.com/auth/drive"]
    secret_json = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON")
    
    if not secret_json:
        print("Error: GOOGLE_SERVICE_ACCOUNT_JSON secret is not configured.")
        return

    creds_dict = json.loads(secret_json)
    creds = ServiceAccountCredentials.from_json_keyfile_dict(creds_dict, scope)
    client = gspread.authorize(creds)

    # 2. Open your master workbook
    spreadsheet = client.open("Operations")
    
    crm_sheet = spreadsheet.sheet_by_name("CRM Dashboard")
    raw_res_sheet = spreadsheet.sheet_by_name("Raw_Reservations")
    raw_stripe_sheet = spreadsheet.sheet_by_name("Raw_Stripe_Deposits")

    # 3. Pull all records from the sheets as lists of dictionaries
    crm_records = csl_sheet = crm_sheet.get_all_records()
    raw_res_records = raw_res_sheet.get_all_records()
    raw_stripe_records = raw_stripe_sheet.get_all_records()

    # 4. Gather existing reservation codes already present on your CRM Dashboard to prevent duplicates
    existing_codes = set(str(row.get("reservation_code", "")).strip() for row in crm_records if row.get("reservation_code"))

    # 5. Index Stripe data by reservation code for instant lookup
    stripe_map = {}
    for row in raw_stripe_records:
        res_code = str(row.get("reservation_code", "")).strip()
        if res_code:
            stripe_map[res_code] = {
                "url": row.get("payment_url", ""),
                "status": row.get("status", "")
            }

    new_crm_rows = []

    # 6. Process raw reservations and map them directly into your exact CRM schema layout
    for row in raw_res_records:
        res_code = str(row.get("reservation_code", "")).strip()
        
        # Skip if this booking code is already written to the dashboard
        if not res_code or res_code in existing_codes:
            continue

        # Look up matching stripe details if they exist
        stripe_data = stripe_map.get(res_code, {"url": "No Link", "status": "No Status"})

        # Build the exact row array based on your CRM headers
        crm_row = [
            res_code,                                      # Column A: reservation_code
            row.get("Booking reference", ""),              # Column B
            row.get("booked", ""),                         # Column C
            row.get("property_name", ""),                  # Column D
            row.get("channel_name", ""),                   # Column E
            row.get("promotion_code", ""),                 # Column F
            row.get("guest_first_name", ""),               # Column G
            row.get("guest_last_name", ""),                # Column H
            row.get("guest_email", ""),                    # Column I
            row.get("guest_phone_number", ""),             # Column J
            row.get("guest_organisation", ""),             # Column K
            row.get("guest_address", ""),                  # Column L
            row.get("guest_address2", ""),                 # Column M
            row.get("guest_city", ""),                     # Column N
            row.get("guest_state", ""),                    # Column O
            row.get("guest_country", ""),                  # Column P
            row.get("guest_post_code", ""),                # Column Q
            clean_date(row.get("Check in date", "")),      # Column R: Parsed True Date Value
            clean_date(row.get("Check out date", "")),     # Column S: Parsed True Date Value
            clean_int(row.get("length_of_stay_(nights)", 0)),# Column T: True Integer Value
            row.get("arrival_time", ""),                   # Column U
            row.get("guest_comments", ""),                 # Column V
            row.get("notes", ""),                          # Column W
            row.get("requested_newsletter", ""),           # Column X
            row.get("status", ""),                         # Column Y
            row.get("cancelled_at", ""),                   # Column Z
            row.get("room_types", ""),                     # Column AA
            clean_int(row.get("number_of_adults", 0)),     # Column AB: True Integer Value
            clean_int(row.get("number_of_children", 0)),   # Column AC: True Integer Value
            clean_int(row.get("number_of_infants", 0)),    # Column AD: True Integer Value
            row.get("front_door_lock_set", ""),            # Column AE
            row.get("room_lock_set", ""),                  # Column AF
            stripe_data["url"],                            # Column AG: stripe_payment_url
            stripe_data["status"]                          # Column AH: stripe_status
        ]
        
        new_crm_rows.append(crm_row)

    # 7. Safe Append to the bottom using USER_ENTERED mode to preserve data formatting
    if new_crm_rows:
        print(f"Found {len(new_crm_rows)} new bookings. Writing to CRM Dashboard...")
        crm_sheet.append_rows(new_crm_rows, value_input_option="USER_ENTERED")
        print("Sync complete.")
    else:
        print("No new bookings found to sync.")

if __name__ == "__main__":
    sync_crm_pipeline()
