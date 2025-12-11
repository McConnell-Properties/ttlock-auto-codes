# scripts/read_preauth_gmail.py

import imaplib
import email
import pandas as pd
from datetime import datetime
import os
import traceback

GMAIL_USER = os.getenv("GMAIL_USER")
GMAIL_APP_PASSWORD = os.getenv("GMAIL_APP_PASSWORD")

CSV_PATH = "automation-data/payments_log.csv"


def read_and_append():
    print("=== Step 1: Syncing Gmail → payments_log.csv ===")

    try:
        print(f"Connecting to Gmail as: {GMAIL_USER}")
        mail = imaplib.IMAP4_SSL("imap.gmail.com")
        mail.login(GMAIL_USER, GMAIL_APP_PASSWORD)
    except Exception as e:
        print("❌ IMAP login failed:", e)
        return

    # Select inbox
    status, _ = mail.select("inbox")
    print(f"IMAP select() status: {status}")

    if status != "OK":
        print("❌ Could not open inbox.")
        return

    # Get all emails
    status, data = mail.search(None, "ALL")
    print(f"IMAP search() status: {status}")

    if status != "OK":
        print("❌ IMAP search failed.")
        return

    ids = data[0].split()
    print(f"📩 Found {len(ids)} email(s) total in inbox.")

    rows = []
    scanned = 0
    matched = 0

    for num in ids[-200:]:  
        # limit to last 200 emails to speed things up
        scanned += 1

        try:
            status, msg_data = mail.fetch(num, "(RFC822)")
            if status != "OK":
                print(f"⚠️ Failed to fetch email ID {num}")
                continue

            msg = email.message_from_bytes(msg_data[0][1])

            subject = msg.get("Subject", "")
            date_received = msg.get("Date", "")
            print(f"\n--- EMAIL #{scanned} ---")
            print("Subject:", subject)
            print("Date:", date_received)

            # Match different possible subject formats
            if "Pre-authorisation confirmed" not in subject:
                print("❌ Not a pre-auth email. Skipping.")
                continue

            # Extract reservation code ###-###-###
            ref = ""
            words = subject.replace("–", "-").replace("—", "-").split()
            for part in words:
                if len(part) == 11 and part[3] == "-" and part[7] == "-":
                    ref = part
                    break

            if not ref:
                print("❌ No reservation code found in subject.")
                continue

            matched += 1
            print(f"✅ FOUND Pre-auth for reservation: {ref}")

            timestamp = datetime.utcnow().isoformat()

            rows.append({
                "timestamp": timestamp,
                "reservation_code": ref,
                "received_at": timestamp,
                "raw_subject": subject
            })

        except Exception as e:
            print("❌ Error while processing email:", e)
            traceback.print_exc()
            continue

    mail.logout()

    print(f"\n📊 Summary:")
    print(f"   Emails scanned: {scanned}")
    print(f"   Pre-auth matches: {matched}")

    if matched == 0:
        print("⚠️ No pre-authorisation confirmations found.")
        return

    # Load old CSV
    try:
        df_old = pd.read_csv(CSV_PATH)
    except:
        df_old = pd.DataFrame()

    df_new = pd.DataFrame(rows)
    df_all = pd.concat([df_old, df_new], ignore_index=True).drop_duplicates()

    df_all.to_csv(CSV_PATH, index=False)
    print(f"✔ Logged {matched} new payment confirmations.")


if __name__ == "__main__":
    read_and_append()
