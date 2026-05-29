import os
import csv
import re
import glob
import ast
from datetime import datetime, date, timedelta, time
from zoneinfo import ZoneInfo

import pandas as pd

import multi_property_lock_codes as tt

DATA_DIR = "automation-data"
TTLOCK_LOG_PATH = "automation-data/ttlock_log.csv"

# Define headers globally to ensure consistency (Now includes start_ms and end_ms)
LOG_FIELDNAMES = [
    "timestamp",
    "reservation_code",
    "guest_name",
    "property_location",
    "door_number",
    "lock_type",
    "code_created",
    "ttlock_response",
    "start_ms",
    "end_ms"
]


def load_completed_locks():
    """
    Load a map of which locks have successfully been created.
    Now extracts keyboardPwdId and timestamps so we can update them if dates change.
    """
    completed = {}

    if not os.path.exists(TTLOCK_LOG_PATH):
        print("ℹ️ No ttlock_log.csv yet – treating this as first run.")
        return completed

    try:
        df = pd.read_csv(TTLOCK_LOG_PATH, dtype=str)
        df["timestamp"] = pd.to_datetime(df["timestamp"], errors='coerce')
        df = df.dropna(subset=['timestamp', 'reservation_code', 'lock_type'])
    except Exception as e:
        print(f"⚠️ Error reading/parsing {TTLOCK_LOG_PATH}: {e}. Assuming no completed locks yet.")
        return completed
    
    # Add columns if legacy log file doesn't have them yet
    if "start_ms" not in df.columns: df["start_ms"] = ""
    if "end_ms" not in df.columns: df["end_ms"] = ""

    success_df = df[df["code_created"] == "yes"]
    
    for _, row in success_df.iterrows():
        ref = row["reservation_code"]
        lock_type = row["lock_type"]

        # Safely parse the Password ID from the API response string
        pwd_id = None
        try:
            resp_dict = ast.literal_eval(row["ttlock_response"])
            pwd_id = resp_dict.get("keyboardPwdId")
        except:
            pass
        
        # Safely parse dates
        start_ms = row["start_ms"]
        end_ms = row["end_ms"]
        try:
            start_ms = int(float(start_ms)) if pd.notna(start_ms) and str(start_ms).strip() else None
        except: start_ms = None
        try:
            end_ms = int(float(end_ms)) if pd.notna(end_ms) and str(end_ms).strip() else None
        except: end_ms = None

        if ref not in completed:
            completed[ref] = {}
        
        completed[ref][lock_type] = {
            "keyboardPwdId": pwd_id,
            "start_ms": start_ms,
            "end_ms": end_ms
        }

    print(f"✔ Loaded completion status for {len(completed)} reservations.")
    return completed


def aggregate_bookings():
    """Load all CSVs in subfolders, apply date filters, merge duplicate rows."""
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
        print("⚠️ 'Booking reference' column not found in uploaded CSVs.")
        return []

    df["reservation_code"] = df["Booking reference"].fillna("").astype(str).str.strip()
    df = df[df["reservation_code"] != ""].copy()

    if df.empty: return []

    df["check_in"] = pd.to_datetime(df["Check in date"], errors="coerce")
    df["check_out"] = pd.to_datetime(df["Check out date"], errors="coerce")
    df = df.dropna(subset=["check_in", "check_out"])

    today = date.today()
    horizon = today + timedelta(days=30)

    mask = (df["check_out"].dt.date >= today) & (df["check_in"].dt.date <= horizon)
    df = df[mask].copy()

    if df.empty: return []

    bookings = []
    for ref, g in df.groupby("reservation_code"):
        first = g.iloc[0]
        location = first.get("Property name", "") or ""
        room = first.get("Rooms", "") or ""
        
        fname = str(first.get("Guest first name", "")).strip()
        if fname.lower() == "nan": fname = ""
        lname = str(first.get("Guest last name", "")).strip()
        if lname.lower() == "nan": lname = ""
        guest = f"{fname} {lname}".strip()

        check_in = g["check_in"].min()
        check_out = g["check_out"].max()

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

    print(f"✔ Aggregated to {len(bookings)} unique reservations.")
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
    
    for booking in bookings:
        ref = booking["reservation_code"]
        guest_name = booking["guest_name"]
        location = booking["property_location"]
        room_name = booking["door_number"]
        code = booking["code"]
        check_in = booking["check_in"]
        check_out = booking["check_out"]

        if not code: continue
        if location not in tt.PROPERTIES: continue
        prop_conf = tt.PROPERTIES[location]

        # -----------------------------------------------------------------
        # Time Adjustments (UK Timezone Aware)
        # -----------------------------------------------------------------
        uk_tz = ZoneInfo("Europe/London")
        start_dt = datetime.combine(check_in.date(), time(15, 0), tzinfo=uk_tz)
        start_ms = int(start_dt.timestamp() * 1000)

        end_dt = datetime.combine(check_out.date(), time(11, 0), tzinfo=uk_tz)
        end_ms = int(end_dt.timestamp() * 1000)
        # -----------------------------------------------------------------

        print(f"\n📋 Evaluating reservation {ref} for guest '{guest_name}'")
        print(f"   Property: {location}, Room: {room_name}")
        print(f"   Lock Time: {start_dt.strftime('%Y-%m-%d %H:%M %Z')} to {end_dt.strftime('%Y-%m-%d %H:%M %Z')}")

        done_locks_info = completed_map.get(ref, {})
        any_success_in_run = False

        # ---- 1. Front door code ----
        front_door_lock_id = prop_conf.get("FRONT_DOOR_LOCK_ID")
        if front_door_lock_id:
            fd_info = done_locks_info.get("front_door")
            
            if fd_info:
                # Code exists. Check if dates changed
                if fd_info["start_ms"] == start_ms and fd_info["end_ms"] == end_ms:
                    print(f"✅ Front door code already set and dates match – skipping.")
                else:
                    pwd_id = fd_info.get("keyboardPwdId")
                    if pwd_id:
                        print(f"🔄 Dates changed! Updating FRONT DOOR code valid period...")
                        success, resp = tt.change_lock_code_period(front_door_lock_id, pwd_id, start_ms, end_ms)
                        
                        log_rows.append({
                            "timestamp": datetime.utcnow().isoformat(),
                            "reservation_code": ref, "guest_name": guest_name,
                            "property_location": location, "door_number": "Front Door",
                            "lock_type": "front_door", "code_created": "yes" if success else "no",
                            "ttlock_response": str(resp), "start_ms": start_ms, "end_ms": end_ms
                        })
                        if success: any_success_in_run = True
                    else:
                        print(f"⚠️ Dates changed, but previous Password ID is missing. Cannot update automatically.")
            else:
                # Need to create new code
                print(f"🚪 Attempting FRONT DOOR code (Lock ID {front_door_lock_id}) using code {code}")
                success, resp = tt.create_lock_code_simple(front_door_lock_id, code, guest_name, start_ms, end_ms, f"Front Door ({location})", ref)
                
                is_duplicate_error = (not success and isinstance(resp, dict) and resp.get("errcode") == -3007)
                if is_duplicate_error:
                    print(f"   ℹ️ Lock returned 'Duplicate passcode' – treating as SUCCESS.")
                    success = True

                log_rows.append({
                    "timestamp": datetime.utcnow().isoformat(),
                    "reservation_code": ref, "guest_name": guest_name,
                    "property_location": location, "door_number": "Front Door",
                    "lock_type": "front_door", "code_created": "yes" if success else "no",
                    "ttlock_response": str(resp), "start_ms": start_ms, "end_ms": end_ms
                })
                if success: any_success_in_run = True

        # ---- 2. Room door code ----
        room_lock_id = prop_conf.get("ROOM_LOCK_IDS", {}).get(room_name)
        if room_lock_id:
            room_info = done_locks_info.get("room")
            
            if room_info:
                if room_info["start_ms"] == start_ms and room_info["end_ms"] == end_ms:
                    print(f"✅ Room code already set and dates match – skipping.")
                else:
                    pwd_id = room_info.get("keyboardPwdId")
                    if pwd_id:
                        print(f"🔄 Dates changed! Updating ROOM code valid period...")
                        success, resp = tt.change_lock_code_period(room_lock_id, pwd_id, start_ms, end_ms)
                        
                        log_rows.append({
                            "timestamp": datetime.utcnow().isoformat(),
                            "reservation_code": ref, "guest_name": guest_name,
                            "property_location": location, "door_number": room_name,
                            "lock_type": "room", "code_created": "yes" if success else "no",
                            "ttlock_response": str(resp), "start_ms": start_ms, "end_ms": end_ms
                        })
                        if success: any_success_in_run = True
                    else:
                        print(f"⚠️ Dates changed, but previous Password ID is missing. Cannot update automatically.")
            else:
                print(f"🚪 Attempting ROOM code – {room_name} (Lock ID {room_lock_id}) using code {code}")
                success, resp = tt.create_lock_code_simple(room_lock_id, code, guest_name, start_ms, end_ms, f"{room_name} ({location})", ref)
                
                is_duplicate_error = (not success and isinstance(resp, dict) and resp.get("errcode") == -3007)
                if is_duplicate_error:
                    print(f"   ℹ️ Lock returned 'Duplicate passcode' – treating as SUCCESS.")
                    success = True

                log_rows.append({
                    "timestamp": datetime.utcnow().isoformat(),
                    "reservation_code": ref, "guest_name": guest_name,
                    "property_location": location, "door_number": room_name,
                    "lock_type": "room", "code_created": "yes" if success else "no",
                    "ttlock_response": str(resp), "start_ms": start_ms, "end_ms": end_ms
                })
                if success: any_success_in_run = True

        if not any_success_in_run and not done_locks_info:
            print(f"❌ No successful TTLock codes created for {ref}.")


    # ---- Final Log Cleaning and Overwriting ----
    print("\n📝 Cleaning and writing log file...")
    existing_df = pd.DataFrame()
    if os.path.exists(TTLOCK_LOG_PATH):
        try:
            existing_df = pd.read_csv(TTLOCK_LOG_PATH, dtype=str)
        except: pass

    new_df = pd.DataFrame(log_rows, columns=LOG_FIELDNAMES)
    combined_df = pd.concat([existing_df, new_df], ignore_index=True)
    
    # Fill missing columns for legacy compatibility
    for col in LOG_FIELDNAMES:
        if col not in combined_df.columns:
            combined_df[col] = ""
            
    combined_df = combined_df.reindex(columns=LOG_FIELDNAMES)
    combined_df["timestamp"] = pd.to_datetime(combined_df["timestamp"], errors='coerce')
    combined_df = combined_df.dropna(subset=['reservation_code', 'lock_type'])
    
    cleaned_df = combined_df.sort_values(
        by=['timestamp'], ascending=False
    ).drop_duplicates(
        subset=['reservation_code', 'lock_type'], keep='first'
    ).sort_values(
        by=['timestamp'], ascending=True
    )

    cleaned_df['timestamp'] = cleaned_df['timestamp'].dt.strftime('%Y-%m-%dT%H:%M:%S.%f').str[:-3]
    os.makedirs(os.path.dirname(TTLOCK_LOG_PATH), exist_ok=True)
    cleaned_df.to_csv(TTLOCK_LOG_PATH, index=False, quoting=csv.QUOTE_MINIMAL)
    
    print(f"✔ Successfully cleaned and wrote {len(cleaned_df)} unique log entries to {TTLOCK_LOG_PATH}")
    print("=== TTLock Automation Complete ===")

if __name__ == "__main__":
    main()
