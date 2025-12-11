import imaplib
import email
from email.header import decode_header
import pandas as pd
from datetime import datetime
import os
import re

GMAIL_USER = os.getenv("GMAIL_USER")
GMAIL_APP_PASSWORD = os.getenv("GMAIL_APP_PASSWORD")

CSV_PATH = "automation-data/payments_log.csv"


def decode_subject(raw_subject):
    """Decode Gmail subject reliably."""
    decoded = decode_header(raw_subject)
    subject_str = ""

    for part, encoding in decoded:
        if isinstance(part, bytes):
            subject_str += part.decode(encoding or "utf-8", errors="ignore")
        else:
            subject_str += part

    return subject_str


def read_and_append():
    print("Step 1: Syncing Gmail → payments_log.csv …")

    mail = imaplib.IMAP4_SSL("imap.gmail.com")
    mail.login(GMAIL_USER, GMAIL_APP_PASSWORD)
    mail.select("inbox")

    status, data = mail.search(None, 'ALL')
    if status != "OK":
        print("IMAP search failed.")
        return

    ids = data[0].split()
    print(f"Found {len(ids)} email(s) to scan.")

    rows = []

    for num in ids:
        status, msg_data = mail.fetch(num, "(RFC822)")
        if status != "OK":
            continue

        msg = email.message_from_bytes(msg_data[0][1])

        raw_subject = msg.get("Subject", "")
        subject = decode_subject(raw_subject)
        subject_lower = subject.lower()

        date_received = msg.get("Date", "")

        # Match pre-authorisation confirmed (case-insensitive)
        if "pre-authorisation confirmed" not in subject_lower:
            continue

        # extract reservation ID using regex
        ref_match = re.search(r"\d{3}-\d{3}-\d{3}", subject)
        if not ref_match:
            print(f"⚠️ No reservation code found in subject: {subject}")
            continue

        ref = ref_match.group(0)

        received_at = datetime.now().isoformat()

        rows.append({
            "timestamp": received_at,
            "reservation_code": ref,
            "received_at": received_at,
            "subject": subject
        })

    mail.logout()

    if not rows:
        print("No new payment confirmations found.")
        return

    df_new = pd.DataFrame(rows)

    # Load old CSV (if exists)
    try:
        df_old = pd.read_csv(CSV_PATH)
    except:
        df_old = pd.DataFrame(columns=df_new.columns)

    df_all = pd.concat([df_old, df_new], ignore_index=True).drop_duplicates()

    df_all.to_csv(CSV_PATH, index=False)
    print(f"✔ Logged {len(rows)} new payment confirmations.")
