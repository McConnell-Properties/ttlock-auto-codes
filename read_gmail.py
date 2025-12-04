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


def send_to_webhook(ref, received_at):
    """POST the reference + timestamp to your Apps Script webhook."""
    payload = {
        "ref": ref,                      # <-- matches Apps Script body.ref
        "receivedAt": received_at.isoformat()
    }
    print(f"[WEBHOOK] Sending payload: {payload}")
    resp = requests.post(WEBHOOK, json=payload, timeout=10)
    print(f"[WEBHOOK] Response status: {resp.status_code}, body: {resp.text}")


def main():
    with IMAPClient(IMAP_HOST) as server:
        print("[IMAP] Connecting...")
        server.login(USER, PASSWORD)
        print("[IMAP] Logged in as", USER)

        server.select_folder("INBOX")
        # only unread messages
        messages = server.search(["UNSEEN"])
        print(f"[IMAP] Found {len(messages)} unseen messages")

        if not messages:
            return

        for msgid in messages:
            raw = server.fetch([msgid], ["RFC822", "INTERNALDATE"])
            message = pyzmail.PyzMessage.factory(raw[msgid][b"RFC822"])

            subject = message.get_subject() or ""
            print(f"[EMAIL] msgid={msgid}, subject={subject}")

            if TARGET_SUBJECT not in subject:
                # not a payment email – leave it unread or mark read if you like
                continue

            # extract booking reference from subject
            match = re.search(REF_REGEX, subject)
            if not match:
                print(f"[EMAIL] No reference pattern found in subject: {subject}")
                # mark as seen anyway so we don't loop forever
                server.add_flags([msgid], [b'\\Seen'])
                continue

            ref = match.group(1)
            # use INTERNALDATE from IMAP as received time
            received_at = raw[msgid][b"INTERNALDATE"]
            if not isinstance(received_at, datetime.datetime):
                received_at = datetime.datetime.utcnow()

            print(f"[EMAIL] Detected payment reference {ref} at {received_at}")

            # send to Apps Script
            try:
                send_to_webhook(ref, received_at)
            except Exception as e:
                print(f"[WEBHOOK] Error sending to Apps Script: {e}")

            # mark processed so we don't re-handle
            server.add_flags([msgid], [b'\\Seen'])

    print("[IMAP] Done.")


if __name__ == "__main__":
    main()
