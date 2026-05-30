import pandas as pd
from datetime import datetime
import os
import glob

INPUT_DIR = "automation-data/inputs"
TTLOG    = "automation-data/ttlock_log.csv"
OUTPUT   = "automation-data/reservation_status.csv"

# -----------------------------
# Parse date safely
# -----------------------------
def parse_date(x):
    try:
        return pd.to_datetime(x, utc=True)
    except:
        return pd.NaT

# -----------------------------
# Combine multiple rows
# -----------------------------
def combine_rows(group):
    row = group.iloc[0].copy()

    # Check-in/out (defensive)
    if "check_in_date" in group:
        cis = group["check_in_date"].dropna()
        if len(cis) > 0:
            row["check_in_date"] = cis.iloc[0]

    if "check_out_date" in group:
        cos = group["check_out_date"].dropna()
        if len(cos) > 0:
            row["check_out_date"] = cos.iloc[0]

    return row


def main():

    print("📄 Loading daily reservation CSVs from inputs folder…")
    
    # Grab all CSVs from the inputs dropzone
    all_csvs = glob.glob(f"{INPUT_DIR}/*.csv")
    
    if not all_csvs:
        print(f"❌ Could not find any CSVs in {INPUT_DIR}. Exiting.")
        return
        
    df_list = []
    for file in all_csvs:
        try:
            df_list.append(pd.read_csv(file, dtype=str))
        except Exception as e:
            print(f"⚠️ Skipping {file}: {e}")
            
    if not df_list:
        print("❌ No valid data found in CSVs. Exiting.")
        return
        
    # Combine them all into one master DataFrame
    reservations = pd.concat(df_list, ignore_index=True)

    print("📄 Loading ttlock_log.csv…")
    ttlog = pd.read_csv(TTLOG, dtype=str) if os.path.exists(TTLOG) else pd.DataFrame(columns=["reservation_code", "lock_type"])

    # -----------------------------
    # Normalize headers
    # -----------------------------
    # Converts columns to lowercase with underscores (e.g., "Check in date" -> "check_in_date")
    reservations.rename(columns=lambda c: str(c).strip().lower().replace(" ", "_"), inplace=True)
    
    # -----------------------------
    # Extract reservation code
    # -----------------------------
    if "booking_reference" in reservations.columns:
        print("🔍 Extracting reservation_code…")
        reservations["reservation_code"] = reservations["booking_reference"].fillna("").astype(str).str.strip()
    else:
        print("⚠️ 'Booking reference' column missing in uploaded CSVs. Cannot proceed.")
        return

    # Filter out empty references
    reservations = reservations[reservations["reservation_code"] != ""]
    
    if reservations.empty:
        print("⚠️ No valid reservations found. Exiting.")
        return

    # -----------------------------
    # Parse dates
    # -----------------------------
    if "check_in_date" in reservations.columns:
        reservations["check_in_date"] = reservations["check_in_date"].apply(parse_date)

    if "check_out_date" in reservations.columns:
        reservations["check_out_date"] = reservations["check_out_date"].apply(parse_date)

    # -----------------------------
    # TTLock: derive front/room lock flags
    # -----------------------------
    print("🔐 Processing TTLock status…")

    ttlog.rename(columns=lambda c: str(c).strip().lower().replace(" ", "_"), inplace=True)

    reservations["front_door_lock_set"] = False
    reservations["room_lock_set"] = False

    if not ttlog.empty and "lock_type" in ttlog.columns and "reservation_code" in ttlog.columns:
        # Only flag as set if the code creation was actually successful
        if "code_created" in ttlog.columns:
            success_ttlog = ttlog[ttlog["code_created"].astype(str).str.lower() == "yes"]
        else:
            success_ttlog = ttlog
            
        front = success_ttlog[success_ttlog["lock_type"] == "front_door"]
        room = success_ttlog[success_ttlog["lock_type"] == "room"]

        reservations.loc[
            reservations["reservation_code"].isin(front["reservation_code"]),
            "front_door_lock_set"
        ] = True

        reservations.loc[
            reservations["reservation_code"].isin(room["reservation_code"]),
            "room_lock_set"
        ] = True

    # -----------------------------
    # Combine per reservation
    # -----------------------------
    print("🔄 Deduplicating reservations…")
    final = (
        reservations.groupby("reservation_code", dropna=True)
        .apply(combine_rows)
        .reset_index(drop=True)
    )

    # Preserve TTLock flags after grouping
    final["front_door_lock_set"] = final["reservation_code"].isin(
        reservations.loc[reservations["front_door_lock_set"], "reservation_code"]
    )

    final["room_lock_set"] = final["reservation_code"].isin(
        reservations.loc[reservations["room_lock_set"], "reservation_code"]
    )

    # -----------------------------
    # Rename dates back to original presentation headers
    # -----------------------------
    final.rename(columns={
        "check_in_date": "Check in date",
        "check_out_date": "Check out date",
        "booking_reference": "Booking reference"
    }, inplace=True)

    # -----------------------------
    # Write output
    # -----------------------------
    # Ensure output directory exists just in case
    os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
    final.to_csv(OUTPUT, index=False)

    print(f"✅ reservation_status.csv written to {OUTPUT}")
    print(f"📊 {len(final)} combined reservations written.")


if __name__ == "__main__":
    main()
