import imaplib
import email
from email.header import decode_header
import pandas as pd
from datetime import datetime
import os

GMAIL_USER = os.getenv("GMAIL_USER")
GMAIL_APP_PASSWORD = os.getenv("GMAIL_APP_PASSWORD")

CSV_PATH = "automation-data/payments_log.csv"


def decode_subject(raw_subj):
    """Decode MIME-encoded subjects safely."""
    parts = decode_header(raw_subj)
    decoded = ""

    for txt, enc in parts:
        if isinstance(txt, bytes):
            try:
                decoded += txt.decode(enc or "utf-8", errors="ignore")
            except:
                decoded += txt.decode("utf-8", errors="ignore")
        else:
            decoded += txt

    return decoded


def extract_ref(subject):
    """Extract reservation code ###-###-### from subject."""
    for part in subject.split():
        if len(part) == 11 and part[3] == "-" and part[7] == "-":
            return part
    return ""


def read_and_append():
    print("🟦 Step 1: Syncing Gmail → payments_log.csv …")

    mail = imaplib.IMAP4_SSL("imap.gmail.com")
    mail.login(GMAIL_USER, GMAIL_APP_PASSWORD)
    mail.select("inbox")

    status, data = mail.search(None, 'ALL')
    if status != "OK":
        print("❌ IMAP search failed.")
        return

    ids = data[0].split()
    print(f"📨 Found {len(ids)} email(s) to scan.\n")

    rows = []

    for num in ids:
        status, msg_data = mail.fetch(num, "(RFC822)")
        if status != "OK":
            continue

        msg = email.message_from_bytes(msg_data[0][1])

        raw_subject = msg.get("Subject", "")
        decoded_subject = decode_subject(raw_subject)
        date_received = msg.get("Date", "")

        print(f"➡️ Email Subject: {decoded_subject}")

        # check for ANY "pre-authorisation confirmed" pattern
        if "pre-authorisation confirmed" not in decoded_subject.lower():
            print("   ⏭️ Not a pre-auth email.\n")
            continue

        # extract ref
        ref = extract_ref(decoded_subject)
        if ref:
            print(f"   ✅ Extracted reservation code: {ref}")
        else:
            print("   ❌ No reservation code found.\n")
            continue

        received_at = datetime.now().isoformat()

        rows.append({
            "timestamp": received_at,
            "reservation_code": ref,
            "received_at": received_at
        })

        print("   ✔ Logged pre-auth confirmation.\n")

    mail.logout()

    if not rows:
        print("⚠️ No new payment confirmations found.")
        return

    df_new = pd.DataFrame(rows)

    try:
        df_old = pd.read_csv(CSV_PATH)
    except:
        df_old = pd.DataFrame(columns=df_new.columns)

    df_all = pd.concat([df_old, df_new], ignore_index=True).drop_duplicates()

    df_all.to_csv(CSV_PATH, index=False)
    print(f"✔ Logged {len(rows)} new payment confirmations.")
