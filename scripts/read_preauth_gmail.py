import imaplib, email, csv, os
from datetime import datetime

GMAIL_USER = os.getenv("GMAIL_USER")
APP_PASS = os.getenv("GMAIL_APP_PASSWORD")
OUTPUT = "automation-data/payments_log.csv"

def read_and_append():
    mail = imaplib.IMAP4_SSL("imap.gmail.com")
    mail.login(GMAIL_USER, APP_PASS)
    mail.select('"Automation"')

    status, data = mail.search(None, 'ALL')
    ids = data[0].split()

    if not os.path.exists(OUTPUT):
        with open(OUTPUT, "w", newline="") as f:
            writer = csv.writer(f)
            writer.writerow(["timestamp", "reservation_code", "received_at"])

    for msg_id in ids:
        status, msg_data = mail.fetch(msg_id, "(RFC822)")
        msg = email.message_from_bytes(msg_data[0][1])

        subject = msg["Subject"] or ""
        import re
        match = re.search(r"\d{3}-\d{3}-\d{3}", subject)
        if not match:
            continue

        ref = match.group(0)
        received = datetime.utcnow().isoformat()

        with open(OUTPUT, "a", newline="") as f:
            writer = csv.writer(f)
            writer.writerow([datetime.utcnow().isoformat(), ref, received])

    mail.close()
    mail.logout()

if __name__ == "__main__":
    read_and_append()
