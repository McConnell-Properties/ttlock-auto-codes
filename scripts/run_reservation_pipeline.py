import os
import csv
import re
import glob
import ast
from datetime import datetime, date, timedelta, time
from zoneinfo import ZoneInfo

import pandas as pd
import stripe

import multi_property_lock_codes as tt

# -----------------------------
# CONFIGURATION
# -----------------------------
stripe.api_key = os.getenv("STRIPE_SECRET_KEY")
DEPOSIT_AMOUNT = 8000  # £80.00 (Stripe uses pence/cents)
CURRENCY = "gbp"

DATA_DIR = "automation-data"
LOG_PATH = "automation-data/reservation_status.csv"

# Unified Headers tracking both Lock State and Stripe Link Metrics
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
    "end_ms",
    "stripe_session_id",
    "stripe_payment_url",
    "stripe_status",
    "stripe_timestamp"
]

# -----------------------------
# HELPERS & LOG PARSERS
# -----------------------------
def load_existing_log_data():
    """
    Reads the single source of truth log file to extract:
    1. Completed locks mapped by reservation and lock type.
    2. Active, unexpired, or already paid Stripe links.
    """
    completed_locks = {}
    active_stripe_links = {}

    if not os.path.exists(LOG_PATH):
        print("ℹ️ No reservation_status.csv found yet – treating this as a first run.")
        return completed_locks, active_stripe_links

    try:
        df = pd.read_csv(LOG_PATH, dtype=str)
        if df.empty:
            return completed_locks, active_stripe_links
        
        # SAFE GUARD: Dynamically ensure ALL standard formatting columns exist 
        # to avoid KeyErrors if reading a legacy or custom tracking file
        for col in LOG_FIELDNAMES:
            if col not in df.columns:
                df[col] = ""

        # --- 1. Parse Active Stripe Links ---
        df_stripe = df.dropna(subset=["reservation_code"]).copy()
        df_stripe = df_stripe[df_stripe["stripe_timestamp"] != ""]
        
        if not df_stripe.empty:
            df_stripe["stripe_ts_dt"] = pd.to_datetime(df_stripe["stripe_timestamp"], errors="coerce")
            # Sort newest first so we get the latest generated link per booking reference
            df_stripe = df_stripe.sort_values(by="stripe_ts_dt", ascending=False)
            
            for _, row in df_stripe.drop_duplicates(subset=["reservation_code"], keep="first").iterrows():
                ref = row["reservation_code"]
                ts_dt = row["stripe_ts_dt"]
                status = str(row.get("stripe_status", "")).lower()
                
                is_expired = pd.notna(ts_dt) and (datetime.utcnow() - ts_dt.to_pydatetime() > timedelta(hours=24))
                is_paid = any(x in status for x in ["paid", "succeed", "captured"])
                
                # A link is active if it's less than 24 hours old OR already paid/settled
                if (not is_expired) or is_paid:
                    active_stripe_links[ref] = {
                        "session_id": row.get("stripe_session_id", ""),
                        "payment_url": row.get("stripe_payment_url", ""),
                        "status": row.get("stripe_status", "link_generated"),
                        "timestamp": row["stripe_timestamp"]
                    }

        # --- 2. Parse Completed TTLock Configurations ---
        df["timestamp_dt"] = pd.to_datetime(df["timestamp"], errors='coerce')
        success_locks = df[df["code_created"] == "yes"].sort_values(by="timestamp_dt", ascending=False)
        
        for _, row in success_locks.drop_duplicates(subset=["reservation_code", "lock_type"], keep="first").iterrows():
            ref = row["reservation_code"]
            lock_type = row["lock_type"]
            
            pwd_id = None
            try:
                resp_dict = ast.literal_eval(row["ttlock_response"])
                pwd_id = resp_dict.get("keyboardPwdId")
            except:
                pass
                
            start_ms = row["start_ms"]
            end_ms = row["end_ms"]
            try: start_ms = int(float(start_ms)) if pd.notna(start_ms) and str(start_ms).strip() else None
            except: start_ms = None
            try: end_ms = int(float(end_ms)) if pd.notna(end_ms) and str(end_ms).strip() else None
            except: end_ms = None
            
            if ref not in completed_locks:
                completed_locks[ref] = {}
                
            completed_locks[ref][lock_type] = {
                "keyboardPwdId": pwd_id,
                "start_ms": start_ms,
                "end_ms": end_ms,
                "raw_response": row["ttlock_response"]
            }
            
    except Exception as e:
        print(f"⚠️ Error parsing unified tracking logs: {e}")

    print(f"✔ Loaded {len(completed_locks)} lock maps and {len(active_stripe_links)} active payment tokens.")
    return completed_locks, active_stripe_links


def aggregate_bookings():
    """Load all CSVs in dropzone folders, apply date filters, merge duplicate rows."""
    all_csvs = glob.glob(f"{DATA_DIR}/inputs/*.csv")

    if not all_csvs:
        print(f"⚠️ No reservation CSVs found in {DATA_DIR}/inputs/ – aborting pipeline execution step.")
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

        email = str(first.get("Guest email", "")).strip()
        if email.lower() == "nan" or not email: email = None

        check_in = g["check_in"].min()
        check_out = g["check_out"].max()

        digits = re.sub(r"\D", "", ref)
        code = digits[-4:] if len(digits) >= 4 else None

        bookings.append({
            "reservation_code": ref,
            "guest_name": guest,
            "guest_email": email,
            "property_location": location,
            "door_number": room,
            "check_in": check_in,
            "check_out": check_out,
            "code": code,
        })

    print(f"✔ Aggregated to {len(bookings)} unique reservations from input dropzone.")
    return bookings


# -----------------------------
# MAIN PIPELINE EXECUTION
# -----------------------------
def main():
    print("=== Unified Reservation Status Pipeline Start ===")
    
    # Initialize TTLock
    client_id = os.getenv("TTLOCK_CLIENT_ID")
    if not client_id:
        print("❌ TTLOCK_CLIENT_ID not set in environment – cannot proceed.")
        return
    tt.initialize_ttlock(client_id)

    # Verify Stripe
    if not stripe.api_key:
        print("❌ STRIPE_SECRET_KEY not set in environment – cannot proceed.")
        return

    # Load Single Source of Truth Arrays
    completed_locks_map, active_stripe_map = load_existing_log_data()
    bookings = aggregate_bookings()

    if not bookings:
        print("ℹ️ No eligible bookings found in dropzone matching processing requirements.")
        return

    log_rows = []
    
    for booking in bookings:
        ref = booking["reservation_code"]
        guest_name = booking["guest_name"]
        email = booking["guest_email"]
        location = booking["property_location"]
        room_name = booking["door_number"]
        code = booking["code"]
        check_in = booking["check_in"]
        check_out = booking["check_out"]

        if not code: continue
        if location not in tt.PROPERTIES: continue
        prop_conf = tt.PROPERTIES[location]

        # Time Adjustment Math (Europe/London Timezone Aware)
        uk_tz = ZoneInfo("Europe/London")
        start_dt = datetime.combine(check_in.date(), time(15, 0), tzinfo=uk_tz)
        start_ms = int(start_dt.timestamp() * 1000)

        end_dt = datetime.combine(check_out.date(), time(11, 0), tzinfo=uk_tz)
        end_ms = int(end_dt.timestamp() * 1000)
        
        nights = (check_out - check_in).days

        print(f"\n📋 Processing Booking: {ref} — Guest: {guest_name}")
        print(f"   Property: {location}, Stay: {nights} Nights")

        # -------------------------------------------------------------
        # STEP 1: EVALUATE STRIPE DEPOSIT LINK
        # -------------------------------------------------------------
        stripe_id = ""
        stripe_url = ""
        stripe_status = ""
        stripe_ts = ""
        new_stripe_generated = False

        if ref in active_stripe_map:
            # Active or fully paid link already exists—retrieve and reuse it
            stripe_id = active_stripe_map[ref]["session_id"]
            stripe_url = active_stripe_map[ref]["payment_url"]
            stripe_status = active_stripe_map[ref]["status"]
            stripe_ts = active_stripe_map[ref]["timestamp"]
            print(f"   💳 Valid/Paid Stripe link detected in log file: {stripe_status}")
        else:
            # No active link exists (<24h old or paid), force immediate generation override
            print(f"   💳 No active Stripe session found or link expired. Generating new checkout token...")
            try:
                session = stripe.checkout.Session.create(
                    payment_method_types=['card'],
                    mode='payment',
                    customer_email=email,
                    line_items=[{
                        'price_data': {
                            'currency': CURRENCY,
                            'product_data': {
                                'name': f"Security Deposit - {location}",
                                'description': f"Refundable damage hold for booking {ref}",
                            },
                            'unit_amount': DEPOSIT_AMOUNT,
                        },
                        'quantity': 1,
                    }],
                    payment_intent_data={'capture_method': 'manual'},
                    success_url='https://mcconnell-properties.com/', 
                    cancel_url='https://mcconnell-properties.com/',
                    metadata={
                        'reservation_code': ref,
                        'guest_name': guest_name,
                        'property': location
                    }
                )
                stripe_id = session.id
                stripe_url = session.url
                stripe_status = "link_generated"
                stripe_ts = datetime.utcnow().isoformat()
                new_stripe_generated = True
                print(f"   ✅ Stripe link generated: {stripe_url}")
            except Exception as se:
                print(f"   ❌ Stripe Session Creation Error for {ref}: {se}")

        # -------------------------------------------------------------
        # STEP 2: EVALUATE TTLOCK ACCESS CODES
        # -------------------------------------------------------------
        done_locks_info = completed_locks_map.get(ref, {})
        fd_row_written = False
        room_row_written = False

        # ---- A. Front Door Code ----
        front_door_lock_id = prop_conf.get("FRONT_DOOR_LOCK_ID")
        if front_door_lock_id:
            fd_info = done_locks_info.get("front_door")
            if fd_info:
                if fd_info["start_ms"] == start_ms and fd_info["end_ms"] == end_ms:
                    print(f"   ✅ Front door code is matching calendar windows – skipping API request.")
                else:
                    pwd_id = fd_info.get("keyboardPwdId")
                    if pwd_id:
                        print(f"   🔄 Dates altered! Modifying FRONT DOOR valid window via API...")
                        success, resp = tt.change_lock_code_period(front_door_lock_id, pwd_id, start_ms, end_ms)
                        log_rows.append({
                            "timestamp": datetime.utcnow().isoformat(), "reservation_code": ref, "guest_name": guest_name,
                            "property_location": location, "door_number": "Front Door", "lock_type": "front_door",
                            "code_created": "yes" if success else "no", "ttlock_response": str(resp), "start_ms": start_ms, "end_ms": end_ms,
                            "stripe_session_id": stripe_id, "stripe_payment_url": stripe_url, "stripe_status": stripe_status, "stripe_timestamp": stripe_ts
                        })
                        fd_row_written = True
            else:
                print(f"   🚪 Initializing FRONT DOOR entry pin (Code: {code})...")
                success, resp = tt.create_lock_code_simple(front_door_lock_id, code, guest_name, start_ms, end_ms, f"Front Door ({location})", ref)
                if not success and isinstance(resp, dict) and resp.get("errcode") == -3007:
                    success = True # Catch duplicate pin codes as successes
                log_rows.append({
                    "timestamp": datetime.utcnow().isoformat(), "reservation_code": ref, "guest_name": guest_name,
                    "property_location": location, "door_number": "Front Door", "lock_type": "front_door",
                    "code_created": "yes" if success else "no", "ttlock_response": str(resp), "start_ms": start_ms, "end_ms": end_ms,
                    "stripe_session_id": stripe_id, "stripe_payment_url": stripe_url, "stripe_status": stripe_status, "stripe_timestamp": stripe_ts
                })
                fd_row_written = True

        # ---- B. Room Door Code ----
        room_lock_id = prop_conf.get("ROOM_LOCK_IDS", {}).get(room_name)
        if room_lock_id:
            room_info = done_locks_info.get("room")
            if room_info:
                if room_info["start_ms"] == start_ms and room_info["end_ms"] == end_ms:
                    print(f"   ✅ Room code is matching calendar windows – skipping API request.")
                else:
                    pwd_id = room_info.get("keyboardPwdId")
                    if pwd_id:
                        print(f"   🔄 Dates altered! Modifying ROOM code valid window via API...")
                        success, resp = tt.change_lock_code_period(room_lock_id, pwd_id, start_ms, end_ms)
                        log_rows.append({
                            "timestamp": datetime.utcnow().isoformat(), "reservation_code": ref, "guest_name": guest_name,
                            "property_location": location, "door_number": room_name, "lock_type": "room",
                            "code_created": "yes" if success else "no", "ttlock_response": str(resp), "start_ms": start_ms, "end_ms": end_ms,
                            "stripe_session_id": stripe_id, "stripe_payment_url": stripe_url, "stripe_status": stripe_status, "stripe_timestamp": stripe_ts
                        })
                        room_row_written = True
            else:
                print(f"   🚪 Initializing ROOM door entry pin (Room: {room_name} Code: {code})...")
                success, resp = tt.create_lock_code_simple(room_lock_id, code, guest_name, start_ms, end_ms, f"{room_name} ({location})", ref)
                if not success and isinstance(resp, dict) and resp.get("errcode") == -3007:
                    success = True
                log_rows.append({
                    "timestamp": datetime.utcnow().isoformat(), "reservation_code": ref, "guest_name": guest_name,
                    "property_location": location, "door_number": room_name, "lock_type": "room",
                    "code_created": "yes" if success else "no", "ttlock_response": str(resp), "start_ms": start_ms, "end_ms": end_ms,
                    "stripe_session_id": stripe_id, "stripe_payment_url": stripe_url, "stripe_status": stripe_status, "stripe_timestamp": stripe_ts
                })
                room_row_written = True

        # -------------------------------------------------------------
        # STEP 3: HANDLE STRIPE PROGRESS LOG RETENTION
        # -------------------------------------------------------------
        if new_stripe_generated:
            if not fd_row_written and front_door_lock_id:
                fd_info = done_locks_info.get("front_door")
                log_rows.append({
                    "timestamp": datetime.utcnow().isoformat(), "reservation_code": ref, "guest_name": guest_name,
                    "property_location": location, "door_number": "Front Door", "lock_type": "front_door",
                    "code_created": "yes" if fd_info else "no", "ttlock_response": str(fd_info.get("raw_response", "")) if fd_info else "",
                    "start_ms": start_ms, "end_ms": end_ms,
                    "stripe_session_id": stripe_id, "stripe_payment_url": stripe_url, "stripe_status": stripe_status, "stripe_timestamp": stripe_ts
                })
            if not room_row_written and room_lock_id:
                room_info = done_locks_info.get("room")
                log_rows.append({
                    "timestamp": datetime.utcnow().isoformat(), "reservation_code": ref, "guest_name": guest_name,
                    "property_location": location, "door_number": room_name, "lock_type": "room",
                    "code_created": "yes" if room_info else "no", "ttlock_response": str(room_info.get("raw_response", "")) if room_info else "",
                    "start_ms": start_ms, "end_ms": end_ms,
                    "stripe_session_id": stripe_id, "stripe_payment_url": stripe_url, "stripe_status": stripe_status, "stripe_timestamp": stripe_ts
                })

    # -------------------------------------------------------------
    # STEP 4: CLEAN AND RE-WRITE MASTER STATUS LOG
    # -------------------------------------------------------------
    print("\n📝 Cleaning and updates writing to master log data tables...")
    existing_df = pd.DataFrame()
    if os.path.exists(LOG_PATH):
        try:
            existing_df = pd.read_csv(LOG_PATH, dtype=str)
        except: pass

    new_df = pd.DataFrame(log_rows, columns=LOG_FIELDNAMES)
    combined_df = pd.concat([existing_df, new_df], ignore_index=True)
    
    # Fill structural vacancies for legacy row models
    for col in LOG_FIELDNAMES:
        if col not in combined_df.columns:
            combined_df[col] = ""
            
    combined_df = combined_df.reindex(columns=LOG_FIELDNAMES)
    combined_df["timestamp"] = pd.to_datetime(combined_df["timestamp"], errors='coerce')
    combined_df = combined_df.dropna(subset=['reservation_code', 'lock_type'])
    
    # De-duplicate rows: Keep the newest timestamp for each unique reservation + lock type
    cleaned_df = combined_df.sort_values(
        by=['timestamp'], ascending=False
    ).drop_duplicates(
        subset=['reservation_code', 'lock_type'], keep='first'
    ).sort_values(
        by=['timestamp'], ascending=True
    )

    cleaned_df['timestamp'] = cleaned_df['timestamp'].dt.strftime('%Y-%m-%dT%H:%M:%S.%f').str[:-3]
    os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)
    cleaned_df.to_csv(LOG_PATH, index=False, quoting=csv.QUOTE_MINIMAL)
    
    print(f"✔ Successfully saved {len(cleaned_df)} unique records to {LOG_PATH}")
    print("=== Pipeline Execution Complete ===")

if __name__ == "__main__":
    main()
