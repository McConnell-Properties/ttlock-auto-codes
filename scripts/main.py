from read_preauth_gmail import read_and_append
from ttlock_log_parser import parse_ttlock_log

def main():
    print("=== Starting full automation sequence ===")
    read_and_append()
    parse_ttlock_log()
    print("=== Automation completed successfully ===")

if __name__ == "__main__":
    main()
