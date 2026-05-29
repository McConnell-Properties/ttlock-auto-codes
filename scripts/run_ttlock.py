import os
import csv
import re
import glob
from datetime import datetime, date, timedelta, time
from zoneinfo import ZoneInfo

import pandas as pd

import multi_property_lock_codes as tt

DATA_DIR = "automation-data"
TTLOCK_LOG_PATH = "automation-data/ttlock_log.csv"

# Define headers globally to ensure consistency
LOG_FIELDNAMES = [
    "timestamp",
    "reservation_code",
    "guest_name",
    "property_location",
    "door_number",
    "lock_type",
    "code_created",
    "ttlock_response",
]


def load_completed_locks():
    """
    Load a map of which locks have successfully been created for each reservation.
    Structure: { 'reservation_ref': {'front_door', 'room'} }
    Only includes entries where code_created == 'yes'.
    This is used to determine which reservations to skip or partially skip.
    """
    completed = {}

    if not os.path.exists(TTLOCK_LOG_PATH):
        print("ℹ️ No ttlock_log.csv yet – treating this as first run.")
        return completed

    # Read the existing log file
    try:
        # Read existing log, treating all fields as string initially
        df = pd.read_csv(TTLOCK_LOG_PATH, dtype=str)
        df["timestamp"] = pd.to_datetime(df["timestamp"], errors='coerce')
        df = df.dropna(subset=['timestamp', 'reservation_code', 'lock_type'])
    except Exception as e:
        # If the file exists but can't be read (e.g., empty or bad format), assume no completed locks
        print(f"⚠️ Error reading/parsing {TTLOCK_LOG_PATH}: {e}. Assuming no completed locks yet.")
        return completed
    
    # Filter for successful entries
    success_df = df[df["code_created"] == "yes"]
    
    for _, row in success_df.iterrows():
        ref = row["reservation_code"]
        lock_type = row["lock_type"]

        if ref not in completed:
            completed[ref] = set()
        completed[ref].add(lock_type)

    print(f"✔ Loaded completion status for {len(completed)} reservations.")
    return completed


def aggregate_bookings():
    """
    Load all CSVs in subfolders, apply date filters, merge duplicate rows per reservation_code,
    and return a list of "booking" dicts ready for TTLock logic.
    """
    # Find all CSV files in automation-data and its subfolders
    all_csvs = [f for f in glob.glob(f"{DATA_DIR}/**/*.csv", recursive=True) 
                if not f.endswith("ttlock_log.csv") and not f.endswith("reservation_status.csv")]

    if not all_csvs:
        print(f"⚠️ No reservation CSVs found in {DATA_DIR}/ subfolders – aborting TTLock step.")
        return []

    df_list = []
    for file in all_csvs:
        try:
            df_list.append(pd.read_csv(file, dtype=str))
        except Exception as e:
            print(f"⚠️ Could not read {file}: {e}")

    if not df_list:
        return []

    df = pd.concat(df_list, ignore_index=True)
    df.columns = [c.strip() for c in df.columns]

    if "Booking reference" not in df.columns:
        print("⚠️ 'Booking reference' column not found in uploaded CSVs. Cannot process data.")
        return []

    df["reservation_code"] = df["Booking reference"].fillna("").astype(str).str.strip()
    df = df[df["reservation_code"] != ""].copy()

    if df.empty:
        print("ℹ️ No rows with a reservation reference found.")
        return []

    # ---- Parse dates & apply 30-day window ----
    df["check_in"] = pd.to_datetime(df["Check in date"], errors="coerce")
    df["check_out"] = pd.to_datetime(df["Check out date"], errors="coerce")

    df = df.dropna(subset=["check_in", "check_out"])

    today = date.today()
    horizon = today + timedelta(days=30)

    # Rule: ignore check-out in past, and check-in > 30 days in future
    mask = (df["check_out"].dt.date >= today) & (df["check_in"].dt.date <= horizon)
    df = df[mask].copy()

    if df.empty:
        print("ℹ️ No bookings within the 30-day window.")
        return []

    bookings = []

    # ---- Merge duplicate rows ----
    for ref, g in df.groupby("reservation_code"):
        first = g.iloc[0]

        location = first.get("Property name", "") or ""
        room = first.get("Rooms", "") or ""
        
        # Combine first and last name
        fname = str(first.get("Guest first name", "")).strip()
        if fname.lower() == "nan": fname = ""
        lname = str(first.get("Guest last name", "")).strip()
        if lname.lower() == "nan": lname = ""
        guest = f"{fname} {lname}".strip()

        check_in = g["check_in"].min()
        check_out = g["check_out"].max()

        # Get ONLY the last 4 digits for the code
        digits = re.sub(r"\D", "", ref)
        code = digits[-4:] if len(digits) >= 4 else None

        bookings.append({
            "reservation_code": ref,
            "guest_name": guest,
            "property_location": location,
            "door_number": room,
            "check_in": check_in,
            "check_out": check_out,
            "code": code,
        })

    print(f"✔ Aggregated to {len(bookings)} unique reservations (from {len(all_csvs)} files).")
    return bookings


def main():
    print("=== TTLock Automation Start ===")

    client_id = os.getenv("TTLOCK_CLIENT_ID")
    if not client_id:
        print("❌ TTLOCK_CLIENT_ID not set in environment – cannot proceed.")
        return
    tt.initialize_ttlock(client_id)

    completed_map = load_completed_locks()
    bookings = aggregate_bookings()

    if not bookings:
        print("ℹ️ No eligible bookings found – nothing to do.")
        return

    log_rows = []
    total_attempts = 0

    for booking in bookings:
        ref = booking["reservation_code"]
        guest_name = booking["guest_name"]
        location = booking["property_location"]
        room_name = booking["door_number"]
        code = booking["code"]
        check_in = booking["check_in"]
        check_out = booking["check_out"]

        print(f"\n📋 Evaluating reservation {ref} for guest '{guest_name}'")
        print(f"   Property: {location}, Room: {room_name}")

        # Check specifically if BOTH locks are already successful
        done_locks = completed_map.get(ref, set())
        
        # A reservation is skipped only when BOTH: a front door code has been successfully created, and a room door code has been successfully created
        if "front_door" in done_locks and "room" in done_locks:
            print(f"⏭️ Skipping {ref} – BOTH front door and room codes already successful.")
            continue

        if not code:
            print(f"⚠️ {ref}: could not derive a 4-digit code – skipping.")
            continue

        if location not in tt.PROPERTIES:
            print(f"⚠️ {ref}: unknown property_location '{location}' – skipping.")
            continue

        prop_conf = tt.PROPERTIES[location]

        # -----------------------------------------------------------------
        # Time Adjustments (UK Timezone Aware)
        # -----------------------------------------------------------------
        uk_tz = ZoneInfo("Europe/London")
        
        # Check-in starts at 3:00 PM (15:00) UK Time
        start_dt = datetime.combine(check_in.date(), time(15, 0), tzinfo=uk_tz)
        start_ms = int(start_dt.timestamp() * 1000)

        # Check-out ends at 11:00 AM (11:00) UK Time
        end_dt = datetime.combine(check_out.date(), time(11, 0), tzinfo=uk_tz)
        end_ms = int(end_dt.timestamp() * 1000)
        
        print(f"   Lock Time: {start_dt.strftime('%Y-%m-%d %H:%M %Z')} to {end_dt.strftime('%Y-%m-%d %H:%M %Z')}")
        # -----------------------------------------------------------------

        any_success_in_run = False

        # ---- 1. Front door code ----
        front_door_lock_id = prop_conf.get("FRONT_DOOR_LOCK_ID")
        if front_door_lock_id:
            # Skip ONLY if this specific lock is already successful
            if "front_door" in done_locks:
                print(f"✅ Front door code already set for {ref} – skipping this lock.")
            else:
                print(f"🚪 Attempting FRONT DOOR code for {location} (Lock ID {front_door_lock_id}) using code {code}")
                total_attempts += 1
                success, resp = tt.create_lock_code_simple(
                    front_door_lock_id,
                    code,
                    guest_name,
                    start_ms,
                    end_ms,
                    f"Front Door ({location})",
                    ref
                )

                # Special handling: If error is -3007 (Duplicate), treat as success so we don't retry forever
                is_duplicate_error = (not success and isinstance(resp, dict) and resp.get("errcode") == -3007)
                if is_duplicate_error:
                    print(f"   ℹ️ Lock returned 'Duplicate passcode' (Error -3007) – treating as SUCCESS.")
                    success = True

                log_rows.append({
                    "timestamp": datetime.utcnow().isoformat(),
                    "reservation_code": ref,
                    "guest_name": guest_name,
                    "property_location": location,
                    "door_number": "Front Door",
                    "lock_type": "front_door",
                    "code_created": "yes" if success else "no",
                    "ttlock_response": str(resp),
                })

                if success:
                    any_success_in_run = True
                    # Update the map so the next check in this loop (room lock) knows the status
                    done_locks.add("front_door") 
                    print(f"✅ Front door code CREATED (or already existed) for {ref}")
                else:
                    print(f"❌ Front door code FAILED for {ref}")
        else:
            print(f"ℹ️ No front door configured for property '{location}'")

        # ---- 2. Room door code ----
        room_lock_id = prop_conf.get("ROOM_LOCK_IDS", {}).get(room_name)
        if room_lock_id:
            # Skip ONLY if this specific lock is already successful
            if "room" in done_locks:
                print(f"✅ Room code already set for {ref} – skipping this lock.")
            else:
                print(f"🚪 Attempting ROOM code for {location} – {room_name} (Lock ID {room_lock_id}) using code {code}")
                total_attempts += 1
                success, resp = tt.create_lock_code_simple(
                    room_lock_id,
                    code,
                    guest_name,
                    start_ms,
                    end_ms,
                    f"{room_name} ({location})",
                    ref
                )

                # Special handling: If error is -3007 (Duplicate), treat as success so we don't retry forever
                is_duplicate_error = (not success and isinstance(resp, dict) and resp.get("errcode") == -3007)
                if is_duplicate_error:
                    print(f"   ℹ️ Lock returned 'Duplicate passcode' (Error -3007) – treating as SUCCESS.")
                    success = True

                log_rows.append({
                    "timestamp": datetime.utcnow().isoformat(),
                    "reservation_code": ref,
                    "guest_name": guest_name,
                    "property_location": location,
                    "door_number": room_name,
                    "lock_type": "room",
                    "code_created": "yes" if success else "no",
                    "ttlock_response": str(resp),
                })

                if success:
                    any_success_in_run = True
                    # Update the map so the final check knows the status
                    done_locks.add("room")
                    print(f"✅ Room code CREATED (or already existed) for {ref}")
                else:
                    print(f"❌ Room code FAILED for {ref}")
        else:
            print(f"⚠️ No lock configured for room '{room_name}' at '{location}'")

        if any_success_in_run:
            print(f"🎉 New codes created/logged for {ref}.")
        elif "front_door" in done_locks or "room" in done_locks:
            print(f"ℹ️ No NEW codes needed (some were already set).")
        else:
            print(f"❌ No successful TTLock codes created for {ref}.")


    # ---- Final Log Cleaning and Overwriting ----
    
    print("\n📝 Cleaning and writing log file...")
    
    existing_df = pd.DataFrame()
    if os.path.exists(TTLOCK_LOG_PATH):
        try:
            # Read existing log, treating all fields as string initially
            existing_df = pd.read_csv(TTLOCK_LOG_PATH, dtype=str)
        except pd.errors.EmptyDataError:
            print("ℹ️ Existing log file was empty. Starting fresh log.")
        except Exception as e:
            print(f"⚠️ Error reading existing log: {e}. Starting fresh log.")

    # Convert the new log entries list into a DataFrame
    new_df = pd.DataFrame(log_rows, columns=LOG_FIELDNAMES)

    # Combine existing and new data. Need to concatenate, then convert timestamp for sorting.
    combined_df = pd.concat([existing_df, new_df], ignore_index=True)
    
    # Ensure all columns are present and correctly ordered before conversion
    combined_df = combined_df.reindex(columns=LOG_FIELDNAMES)
    
    # Convert timestamp column, coercing errors (e.g., if there were bad dates)
    combined_df["timestamp"] = pd.to_datetime(combined_df["timestamp"], errors='coerce')
    
    # Drop rows where critical fields are missing
    combined_df = combined_df.dropna(subset=['reservation_code', 'lock_type'])
    
    # Sort by timestamp (newest first) and drop duplicates, keeping the first (newest) entry
    cleaned_df = combined_df.sort_values(
        by=['timestamp'], 
        ascending=False
    ).drop_duplicates(
        subset=['reservation_code', 'lock_type'], 
        keep='first'
    ).sort_values(
        by=['timestamp'], 
        ascending=True # Re-sort by time ascending for chronological order in file
    )

    # Convert timestamp back to ISO format string for consistent CSV logging
    cleaned_df['timestamp'] = cleaned_df['timestamp'].dt.strftime('%Y-%m-%dT%H:%M:%S.%f').str[:-3]

    # Write the final cleaned data, overwriting the old file
    os.makedirs(os.path.dirname(TTLOCK_LOG_PATH), exist_ok=True)
    cleaned_df.to_csv(TTLOCK_LOG_PATH, index=False, quoting=csv.QUOTE_MINIMAL)
    
    print(f"✔ Successfully cleaned and wrote {len(cleaned_df)} unique log entries to {TTLOCK_LOG_PATH}")
    print(f"   {len(log_rows)} new entries were added/updated in this run.")
    print("=== TTLock Automation Complete ===")


if __name__ == "__main__":
    main()
