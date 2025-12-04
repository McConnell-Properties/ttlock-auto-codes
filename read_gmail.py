import os
import csv
import datetime
import base64
import requests
from imapclient import IMAPClient
import pyzmail
import re

IMAP_HOST = "imap.gmail.com"
USER = os.environ["GMAIL_USER"]
PASSWORD = os.environ["GMAIL_APP_PASSWORD"]

WEBHOOK = os.environ["APPS_SCRIPT_WEBHOOK"]

GITHUB_TOKEN = os.environ["GITHUB_TOKEN"]
REPO_OWNER = "McConnell-Properties"
REPO_NAME = "ttlock-auto-codes"
PAYMENT_LOG_FILE = "payments_log.csv"

TARGET_SUBJECT = "Pre-authorisation confirmed"
REF_REGEX = r"(\d{3}-\d{3}-\d{3})"

# ------------------------------------------------------------
# GitHub Helpers
# ------------------------------------------------------------
def github_api_url(path):
    return f"https://api.github.com/repos/{REPO_OWNER}/{REPO_NAME}/contents/{path}"

def load_payments_log():
    """Fetch payments_log.csv from GitHub, return list of rows."""
    url = github_api_url(PAYMENT_LOG_FILE)
    res = requests.get(url, headers={"Authorization": f"token {GITHUB_TOKEN}"})

    if res.status_code == 200:
        data = res.json()
        content = base64.b64decode(data["content"]).decode("utf-8")
        reader = csv.reader(content.splitlines())
        rows = list(reader)
        sha = data["sha"]
        return rows, sha

    # File does not exist yet → return empty with no sha
    return [["timestamp", "reservation_code", "received_at"]], None

def save_payments_log(rows, sha):
    """Upload updated payments_log.csv to GitHub."""
    csv_text = "\n".join([",".join(r) for r in rows])
    encoded = base64.b64encode(csv_text.encode("utf-8")).decode("utf-8")

    payload = {
        "message": "Update payments_log.csv (last 30 days only)",
        "content": encoded,
        "branch": "main"
    }
    if sha:
        payload["sha"] = sha

    url = github_api_url(PAYMENT_LOG_FILE)
    res = requests.put(
        url,
        headers={"Authorization": f"token {GITHUB_TOKEN}"},
        json=payload,
        timeout=10
    )
    print("[GITHUB] Update status:", res.status_code, res.text)


# ------------------------------------------------------------
# Apps Script webhook
# ------------------------------------------------------------
def send_to_webhook(ref, received_at):
    payload = {
        "ref": ref,
        "receivedAt": received_at.isoformat()
    }
    resp = requests.post(WEBHOOK, json=payload, timeout=10)
    print(f"[WEBHOOK] Status {resp.status_code}, body={resp.text}")


# ------------------------------------------------------------
# Main IMAP logic
# ------------------------------------------------------------
def main():
    with IMAPClient(IMAP_HOST) as server:
        print("[IMAP] Connecting…")
        server.login(USER, PASSWORD)
        print("[IMAP] Logged in as", USER)

        server.select_folder("INBOX")
        messages = server.search(["UNSEEN"])
        print(f"[IMAP] Found {len(messages)} unseen messages")

        # Nothing to do
        if not messages:
            return

        # Load existing log
        rows, sha = load_payments_log()
        header = rows[0]
        existing = rows[1:]

        # Convert existing rows into datetime objects for filtering
        THIRTY_DAYS_AGO = datetime.datetime.utcnow() - datetime.timedelta(days=30)

        for msgid in messages:
            raw = server.fetch([msgid], ["RFC822", "INTERNALDATE"])
            message = pyzmail.PyzMessage.factory(raw[msgid][b"RFC822"])
            subject = message.get_subject() or ""

            print(f"[EMAIL] msgid={msgid}, subject={subject}")

            if TARGET_SUBJECT not in subject:
                continue

            match = re.search(REF_REGEX, subject)
            if not match:
                print("[EMAIL] No reference found in subject")
                server.add_flags([msgid], [b"\\Seen"])
                continue

            ref = match.group(1)
            received_at = raw[msgid][b"INTERNALDATE"]

            print(f"[EMAIL] Payment detected: {ref} at {received_at}")

            # Append new row
            existing.append([
                datetime.datetime.utcnow().isoformat(),
                ref,
                received_at.isoformat()
            ])

            # Notify Google Sheets
            send_to_webhook(ref, received_at)

            # Mark as processed
            server.add_flags([msgid], [b"\\Seen"])

        # Filter to last 30 days
        filtered = []
        for row in existing:
            timestamp = datetime.datetime.fromisoformat(row[0])
            if timestamp >= THIRTY_DAYS_AGO:
                filtered.append(row)

        # Save updated log
        new_rows = [header] + filtered
        save_payments_log(new_rows, sha)

        print("[IMAP] Done.")


if __name__ == "__main__":
    main()
