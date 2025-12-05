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

    # THE REQUIRED FIX:
    mail.select("inbox")   # ← This must be done BEFORE search()

    # Search for all messages
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

        # Only process the actual deposit confirmation emails
        if "Pre-authorisation confirmed" not in subject:
            continue

        # Extract reference number from subject
        # Assumes ref appears like 123-456-789
        import re
        match = re.search(r"(\d{3}-\d{3}-\d{3})", subject)
        if not match:
            continue

        ref = match.group(1)

        # Convert Gmail datetime into ISO format
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

    # Load existing CSV (if exists)
    csv_path = "../automation-data/payments_log.csv"
    if os.path.exists(csv_path):
        existing = pd.read_csv(csv_path)
    else:
        existing = pd.DataFrame(columns=["timestamp", "reservation_code", "received_at"])

    # Append new rows
    if rows:
        new_df = pd.DataFrame(rows)
        combined = pd.concat([existing, new_df], ignore_index=True)
        combined.to_csv(csv_path, index=False)
        print(f"✔ Logged {len(rows)} new payment confirmations.")
    else:
        print("No new matching emails found.")

    mail.logout()
