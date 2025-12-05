import imaplib
import email
import pandas as pd
from datetime import datetime
import os

GMAIL_USER = os.getenv("GMAIL_USER")
GMAIL_APP_PASSWORD = os.getenv("GMAIL_APP_PASSWORD")

CSV_PATH = "automation-data/payments_log.csv"


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

        subject = msg.get("Subject", "")
        date_received = msg.get("Date", "")

        if "Pre-authorisation confirmed" not in subject:
            continue

        # extract reservation ID (###-###-###)
        ref = ""
        for part in subject.split():
            if len(part) == 11 and part[3] == "-" and part[7] == "-":
                ref = part
                break

        if not ref:
            continue

        received_at = datetime.now().isoformat()
        rows.append({
            "timestamp": received_at,
            "reservation_code": ref,
            "received_at": received_at
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
