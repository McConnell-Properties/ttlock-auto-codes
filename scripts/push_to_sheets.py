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
        # Handle cases where the secret string might need clean loading
        creds_dict = json.loads(json_creds)
        creds = ServiceAccountCredentials.from_json_keyfile_dict(creds_dict, scope)
        client = gspread.authorize(creds)
    except Exception as e:
        print(f"❌ Google Authentication Failed: {e}")
        return

    # Sync both files
    for csv_file, sheet_tab in DATA_MAPPING.items():
        push_csv_to_sheet(client, csv_file, sheet_tab)

    print("=== Google Sheets Export Complete ===")

if __name__ == "__main__":
    main()
