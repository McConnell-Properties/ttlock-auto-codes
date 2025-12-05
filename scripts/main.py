from read_preauth_gmail import read_and_append
from ttlock_log_parser import parse_ttlock_log
from run_ttlock import run_ttlock

def main():
    print("=== Starting full automation sequence ===")

    print("Step 1: Sync Gmail → payments_log.csv …")
    read_and_append()

    print("Step 2: Parsing TTLock log (for Sheets sync)…")
    parse_ttlock_log()

    print("Step 3: Running TTLock automation …")
    run_ttlock()

    print("=== Automation completed successfully ===")

if __name__ == "__main__":
    main()
