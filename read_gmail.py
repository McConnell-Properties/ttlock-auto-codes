import os
from imapclient import IMAPClient
import pyzmail
import requests
import datetime
import re

IMAP_HOST = "imap.gmail.com"
USER = os.environ["GMAIL_USER"]
PASSWORD = os.environ["GMAIL_APP_PASSWORD"]
WEBHOOK = os.environ["APPS_SCRIPT_WEBHOOK"]

TARGET_SUBJECT = "Pre-authorisation confirmed"
REF_REGEX = r"(\d{3}-\d{3}-\d{3})"

def send_to_webhook(ref, received):
    requests.post(WEBHOOK, json={
        "reference": ref,
        "receivedAt": received.isoformat()
    })

def main():
    with IMAPClient(IMAP_HOST) as server:
        server.login(USER, PASSWORD)
        server.select_folder("INBOX")

        messages = server.search(["UNSEEN"])
        if not messages:
            print("No new messages")
            return

        for msgid in messages:
            raw = server.fetch([msgid], ["RFC822"])
            message = pyzmail.PyzMessage.factory(raw[msgid][b"RFC822"])

            subject = message.get_subject() or ""
            if TARGET_SUBJECT not in subject:
                continue

            match = re.search(REF_REGEX, subject)
            if not match:
                print(f"No reference found in: {subject}")
                continue

            ref = match.group(1)
            received_at = message.get_decoded_header("date")
            received_at = datetime.datetime.fromtimestamp(
                message.get_email_object().get("date").timestamp()
            )

            print(f"Detected payment reference: {ref}")
            send_to_webhook(ref, received_at)

            # mark email as SEEN so we never process again
            server.add_flags([msgid], [b'\\Seen'])

if __name__ == "__main__":
    main()
