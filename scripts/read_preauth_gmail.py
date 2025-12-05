import imaplib
import email
import pandas as pd
import os
from datetime import datetime

GMAIL_USER = os.environ.get("GMAIL_USER")
GMAIL_APP_PASSWORD = os.environ.get("GMAIL_APP_PASSWORD")

def read_and_append():
    print("Step 1: Syncing Gmail → payments_log.csv …")

    mail = imaplib.IMAP4_SSL("imap.gmail.com")
    mail.login(GMAIL_USER, GMAIL_APP_PASSWORD)

    mail.select("inbox")   # REQUIRED for search()

    status, data = mail.search(None, "ALL")
    if status != "OK":
        print("❌ Could not search inbox")
        mail.logout()
        return

    email_ids = data[0].split()
    print(f"Found {len(email_ids)} email(s) to scan.")

    rows = []

    for eid in email_ids:
        status, msg_data = mail.fetch(eid, "(RFC822)")
        if status != "OK":
            continue

        msg = email.message_from_bytes(msg_data[0][1])

        subject = msg.get("Subject", "")
        date_received = msg.get("Date", "")

        if "Pre-authorisation confirmed" not in subject:
            continue

        import re
        match = re.search(r"(\d{3}-\d{3}-\d{3})", subject)
        if not match:
            continue

        ref = match.group(1)

        try:
            dt = email.utils.parsedate_to_datetime(date_received)
            received_iso = dt.isoformat()
        except:
            received_iso = datetime.utcnow().isoformat()

        rows.append({
            "timestamp": datetime.utcnow().isoformat(),
            "reservation_code": ref,
            "received_at": received_iso
        })

    csv_path = "../automation-data/payments_log.csv"

    # SAFE LOADING (FIX)
    if os.path.exists(csv_path) and os.path.getsize(csv_path) > 0:
        try:
            existing = pd.read_csv(csv_path)
        except Exception:
            existing = pd.DataFrame(columns=["timestamp", "reservation_code", "received_at"])
    else:
        existing = pd.DataFrame(columns=["timestamp", "reservation_code", "received_at"])

    if rows:
        new_df = pd.DataFrame(rows)
        combined = pd.concat([existing, new_df], ignore_index=True)
        combined.to_csv(csv_path, index=False)
        print(f"✔ Logged {len(rows)} new payment confirmations.")
    else:
        print("No new matching emails found.")

    mail.logout()
