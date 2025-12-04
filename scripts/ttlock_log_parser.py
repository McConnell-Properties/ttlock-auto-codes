import csv
import os
import gspread
from oauth2client.service_account import ServiceAccountCredentials

CSV = "automation-data/ttlock_log.csv"
SPREADSHEET_ID = os.getenv("SPREADSHEET_ID")

def sync_log():
    scope = ["https://www.googleapis.com/auth/spreadsheets"]
    creds = ServiceAccountCredentials.from_json_keyfile_dict(
        eval(os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON")),
        scope)
    client = gspread.authorize(creds)
    sheet = client.open_by_key(SPREADSHEET_ID).worksheet("Deposit Payments")

    success = {}

    with open(CSV) as f:
        rows = list(csv.DictReader(f))

    for r in rows:
        ref = r["reservation_code"]
        if ref not in success:
            success[ref] = {"front": False, "room": False}

        if r["code_created"] == "yes" and r["ttlock_response"] == "success":
            if r["lock_type"] == "front_door":
                success[ref]["front"] = True
            elif r["lock_type"] == "room":
                success[ref]["room"] = True

    for ref, info in success.items():
        matches = sheet.findall(ref)
        if not matches:
            continue

        row = matches[0].row
        if info["front"]:
            sheet.update_cell(row, 13, "Yes")
        if info["room"]:
            sheet.update_cell(row, 14, "Yes")

if __name__ == "__main__":
    sync_log()
