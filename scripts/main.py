from read_preauth_gmail import read_and_append
from update_google_sheets import update_sheet
from ttlock_log_parser import sync_log

def main():
    print("=== Starting full automation sequence ===")

    print("\nStep 1: Syncing Gmail → payments_log.csv …")
    read_and_append()

    print("\nStep 2: Updating Google Sheets (Deposit Payments) …")
    update_sheet()

    print("\nStep 3: Syncing TTLock logs → Google Sheets door code status …")
    sync_log()

    print("\n=== Automation sequence completed successfully ===")

if __name__ == "__main__":
    main()
