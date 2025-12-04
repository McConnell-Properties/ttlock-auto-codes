import csv
import gspread
from oauth2client.service_account import ServiceAccountCredentials
import os

CSV_PATH = "automation-data/payments_log.csv"
SPREADSHEET_ID = os.getenv("SPREADSHEET_ID")
SHEET_NAME = "Deposit Payments"

def update_sheet():
    scope = ["https://www.googleapis.com/auth/spreadsheets"]
    creds = ServiceAccountCredentials.from_json_keyfile_dict(
        eval(os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON")),
        scope)
    client = gspread.authorize(creds)
    sheet = client.open_by_key(SPREADSHEET_ID).worksheet(SHEET_NAME)

    with open(CSV_PATH) as f:
        reader = csv.DictReader(f)
        for row in reader:
            ref = row["reservation_code"]
            ts = row["received_at"]

            cells = sheet.findall(ref)
            if not cells:
                continue

            r = cells[0].row
            sheet.update_cell(r, 2, "Paid")
            sheet.update_cell(r, 8, ts)

if __name__ == "__main__":
    update_sheet()
