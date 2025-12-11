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

RES_CODE_REGEX = r"\b\d{3}-\d{3}-\d{3}\b"


def decode_subject(raw_subject):
    """
    Safely decode UTF-8 / encoded IMAP subject lines.
    """
    decoded = decode_header(raw_subject)
    subject = ""

    for part, enc in decoded:
        if isinstance(part, bytes):
            subject += part.decode(enc or "utf-8", errors="ignore")
        else:
            subject += part

    return subject


def read_and_append():
    print("Step 1: Syncing Gmail → payments_log.csv …")

    mail = imaplib.IMAP4_SSL("imap.gmail.com")
    mail.login(GMAIL_USER, GMAIL_APP_PASSWORD)
    mail.select("inbox")

    status, data = mail.search(None, "ALL")
    if status != "OK":
        print("IMAP search failed.")
        return

    ids = data[0].split()
    print(f"📬 Scanning {len(ids)} emails…")

    rows = []
    matched_subjects = 0
    extracted_codes = 0

    for num in ids:
        status, msg_data = mail.fetch(num, "(RFC822)")
        if status != "OK":
            continue

        msg = email.message_from_bytes(msg_data[0][1])

        raw_subject = msg.get("Subject", "")
        subject = decode_subject(raw_subject)

        print(f"🔎 Email subject: {subject}")

        # 1. Check if it is a PAC email
        if "Pre-authorisation confirmed" not in subject:
            continue

        matched_subjects += 1
        print("   ✔ Matched PAC email")

        # 2. Extract reservation code
        match = re.search(RES_CODE_REGEX, subject)
        if not match:
            print("   ❌ NO reservation code found in subject!")
            continue

        ref = match.group(0)
        extracted_codes += 1
        print(f"   ✔ Extracted reservation code: {ref}")

        received_at = datetime.utcnow().isoformat()
        rows.append({
            "timestamp": received_at,
            "reservation_code": ref,
            "received_at": received_at
        })

    mail.logout()

    print(f"\n📊 SUMMARY:")
    print(f"   PAC emails detected: {matched_subjects}")
    print(f"   Reservation codes extracted: {extracted_codes}")

    if not rows:
        print("❌ No new payment confirmations to log.")
        return

    df_new = pd.DataFrame(rows)

    # Load existing logs
    try:
        df_old = pd.read_csv(CSV_PATH)
    except:
        df_old = pd.DataFrame(columns=df_new.columns)

    df_all = pd.concat([df_old, df_new], ignore_index=True).drop_duplicates()

    df_all.to_csv(CSV_PATH, index=False)

    print(f"✔ Logged {len(rows)} new payment confirmations.")
