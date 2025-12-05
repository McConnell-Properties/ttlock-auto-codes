import pandas as pd

CSV_INPUT = "automation-data/ttlock_log.csv"
CSV_OUTPUT = "automation-data/ttlock_log.csv"


def parse_ttlock_log():
    print("Step 2: Parsing TTLock log …")

    try:
        df = pd.read_csv(CSV_INPUT)
    except:
        print("No ttlock_log.csv found.")
        return

    # basic cleanup: drop empty rows
    df = df.dropna(subset=["reservation_code"])

    df.to_csv(CSV_OUTPUT, index=False)
    print("✔ TTLock log cleaned and saved.")
