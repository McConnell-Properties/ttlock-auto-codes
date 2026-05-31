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
LEGACY_STRIPE_LOG = "automation-data/stripe_deposit_log.csv"

LOG_FIELDNAMES = [
    "timestamp",
    "reservation_code",
    "guest_name",
    "guest_email",
    "property_location",
    "door_number",
    "check_in",
    "check_out",
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
# PHASE 1: INGESTION & STATE SYNC
# -----------------------------
def sync_and_load_master_state():
    """
    Step 1 of the pipeline: Merges existing logs, legacy separate stripe files,
    and fresh dropzone files into one master state dictionary matrix.
    """
    today = date.today()
    master_records = {}
    uk_tz = ZoneInfo("Europe/London")

    print(f"📅 Current Automation System Date: {today.strftime('%Y-%m-%d')}")

    # --- 1. Load Existing Reservation Status Base ---
    if os.path.exists(LOG_PATH):
        try:
            df_old = pd.read_csv(LOG_PATH, dtype=str)
            print(f"📖 Found reservation_status.csv with {len(df_old)} rows.")
            
            for col in LOG_FIELDNAMES:
                if col not in df_old.columns:
                    df_old[col] = ""
            
            df_old["tmp_ts"] = pd.to_datetime(df_old["timestamp"], errors="coerce")
            df_old = df_old.sort_values(by="tmp_ts", ascending=True)

            for _, row in df_old.dropna(subset=["reservation_code"]).iterrows():
                ref = row["reservation_code"]
                ltype = row.get("lock_type", "room")
                if not ltype or str(ltype).strip() == "": ltype = "room"
                
                row_dict = row.to_dict()

                # Reverse-engineer text check-in/out dates from TTLock ms timestamps if empty
                start_ms_val = row_dict.get("start_ms", "")
                end_ms_val = row_dict.get("end_ms", "")

                if (not row_dict.get("check_in")) and start_ms_val:
                    try:
                        ms = int(float(start_ms_val))
                        row_dict["check_in"] = datetime.fromtimestamp(ms / 1000, tz=uk_tz).strftime("%Y-%m-%d")
                    except: pass
                    
                if (not row_dict.get("check_out")) and end_ms_val:
                    try:
                        ms = int(float(end_ms_val))
                        row_dict["check_out"] = datetime.fromtimestamp(ms / 1000, tz=uk_tz).strftime("%Y-%m-%d")
                    except: pass
                
                if ref not in master_records:
                    master_records[ref] = {}
                master_records[ref][ltype] = row_dict
        except Exception as e:
            print(f"⚠️ Warning reading baseline history file: {e}")

    # --- 2. BACK-MIGRATE LEGACY STRIPE SEPARATE DATA ---
    if os.path.exists(LEGACY_STRIPE_LOG):
        try:
            df_stripe = pd.read_csv(LEGACY_STRIPE_LOG, dtype=str)
            print(f"💳 Found legacy stripe_deposit_log.csv with {len(df_stripe)} links. Migrating data...")
            
            df_stripe["tmp_s_ts"] = pd.to_datetime(df_stripe["timestamp"], errors="coerce")
            df_stripe = df_stripe.sort_values(by="tmp_s_ts", ascending=True)

            for _, s_row in df_stripe.dropna(subset=["reservation_code"]).iterrows():
                ref = s_row["reservation_code"]
                
                # Check if this booking reference exists in our active master records
                if ref in master_records:
                    for ltype in master_records[ref]:
                        # Only port over link metrics if the target fields are currently empty
                        if not master_records[ref][ltype].get("stripe_payment_url"):
                            master_records[ref][ltype].update({
                                "stripe_session_id": s_row.get("session_id", ""),
                                "stripe_payment_url": s_row.get("payment_url", ""),
                                "stripe_status": s_row.get("status", "link_generated"),
                                "stripe_timestamp": s_row.get("timestamp", "")
                            })
        except Exception as se:
            print(f"⚠️ Warning migrating legacy Stripe file records: {se}")

    # --- 3. Ingest New Dropzone Files ---
    all_csvs = glob.glob(f"{DATA_DIR}/inputs/*.csv")
    if all_csvs:
        print(f"📥 Found raw data files in dropzone. Parsing uploads...")
        df_list = []
        for file in all_csvs:
            try: df_list.append(pd.read_csv(file, dtype=str))
            except: continue
        
        if df_list:
            df_new = pd.concat(df_list, ignore_index=True)
            df_new.columns = [c.strip() for c in df_new.columns]
            
            if "Booking reference" in df_new.columns:
                df_new["reservation_code"] = df_new["Booking reference"].fillna("").astype(str).str.strip()
                df_new = df_new[df_new["reservation_code"] != ""].copy()
                df_new["check_in_dt"] = pd.to_datetime(df_new["Check in date"], errors="coerce")
                df_new["check_out_dt"] = pd.to_datetime(df_new["Check out date"], errors="coerce")
                df_new = df_new.dropna(subset=["check_in_dt", "check_out_dt"])

                for ref, g in df_new.groupby("reservation_code"):
                    first = g.iloc[0]
                    co_dt = g["check_out_dt"].max()
                    
                    if co_dt.date() < today:
                        continue

                    fname = str(first.get("Guest first name", "")).strip().replace("nan", "")
                    lname = str(first.get("Guest last name", "")).strip().replace("nan", "")
                    guest = f"{fname} {lname}".strip()
                    email = str(first.get("Guest email", "")).strip()
                    if email.lower() == "nan" or not email: email = ""
                    
                    location = first.get("Property name", "") or ""
                    room = first.get("Rooms", "") or ""
                    ci_str = g["check_in_dt"].min().strftime("%Y-%m-%d")
                    co_str = co_dt.strftime("%Y-%m-%d")

                    for ltype in ["front_door", "room"]:
                        if ref not in master_records:
                            master_records[ref] = {}
                        
                        if ltype not in master_records[ref]:
                            master_records[ref][ltype] = {col: "" for col in LOG_FIELDNAMES}
                            master_records[ref][ltype]["reservation_code"] = ref
                            master_records[ref][ltype]["lock_type"] = ltype
                            master_records[ref][ltype]["code_created"] = "no"

                        master_records[ref][ltype].update({
                            "guest_name": guest,
                            "guest_email": email if email else master_records[ref][ltype].get("guest_email", ""),
                            "property_location": location,
                            "door_number": room,
                            "check_in": ci_str,
                            "check_out": co_str
                        })

    # --- 4. Filter out expired entries with strict diagnostic logging ---
    active_state_matrix = []
    print("\n🔍 --- DIAGNOSTIC CALENDAR EVALUATION ---")
    
    for ref, tracks in master_records.items():
        for ltype, record in tracks.items():
            guest = record.get("guest_name", "Unknown Guest")
            co_str = record.get("check_out", "")
            
            if not co_str:
                print(f"❌ Skipped {ref} ({guest}) [{ltype}] -> Reason: No check-out date found.")
                continue
                
            co_dt = pd.to_datetime(co_str, errors="coerce")
            if pd.isna(co_dt):
                print(f"❌ Skipped {ref} ({guest}) [{ltype}] -> Reason: Date '{co_str}' failed to parse.")
                continue
                
            if co_dt.date() >= today:
                print(f"✅ Active Tracked Row: {ref} ({guest}) — Checkout: {co_str} — Stripe Url Status: {'Loaded' if record.get('stripe_payment_url') else 'Empty'}")
                active_state_matrix.append(record)
            else:
                print(f"⚠️ Skipped {ref} ({guest}) [{ltype}] -> Reason: Stay expired ({co_str}).")

    print("-------------------------------------------\n")
    print(f"✔ State Synchronization Complete. Tracked active rows: {len(active_state_matrix)}")
    return active_state_matrix


# -----------------------------
# PHASE 2: ACTIVITY EXECUTION
# -----------------------------
def main():
    print("=== Unified Reservation Status Pipeline Start ===")
    
    client_id = os.getenv("TTLOCK_CLIENT_ID")
    if not client_id:
        print("❌ TTLOCK_CLIENT_ID not set in environment – cannot proceed.")
        return
    tt.initialize_ttlock(client_id)

    if not stripe.api_key:
        print("❌ STRIPE_SECRET_KEY not set in environment – cannot proceed.")
        return

    # RUN PHASE 1: Load, Ingest, Auto-Recover, and Cross-Migrate metrics
    active_rows = sync_and_load_master_state()

    if not active_rows:
        print("ℹ️ No active tracked reservations found to evaluate. Exiting pipeline.")
        return

    print(f"🚀 Evaluating required activities directly off the {len(active_rows)} master state records...")
    processed_log_rows = []

    for row in active_rows:
        ref = row["reservation_code"]
        guest_name = row["guest_name"]
        email = row["guest_email"] if row["guest_email"] else None
        location = row["property_location"]
        room_name = row["door_number"]
        ltype = row["lock_type"]
        
        digits = re.sub(r"\D", "", ref)
        code = digits[-4:] if len(digits) >= 4 else None

        if not code or location not in tt.PROPERTIES:
            processed_log_rows.append(row)
            continue

        prop_conf = tt.PROPERTIES[location]
        ci_dt = pd.to_datetime(row["check_in"])
        co_dt = pd.to_datetime(row["check_out"])

        uk_tz = ZoneInfo("Europe/London")
        start_dt = datetime.combine(ci_dt.date(), time(15, 0), tzinfo=uk_tz)
        start_ms = int(start_dt.timestamp() * 1000)
        end_dt = datetime.combine(co_dt.date(), time(11, 0), tzinfo=uk_tz)
        end_ms = int(end_dt.timestamp() * 1000)

        row["timestamp"] = datetime.utcnow().isoformat()

        # --- TASK A: MONITOR STRIPE DEPOSIT LINKS ---
        stripe_ts_str = row.get("stripe_timestamp", "")
        stripe_status_str = str(row.get("stripe_status", "")).lower()
        
        is_link_valid = False
        if stripe_ts_str:
            ts_dt = pd.to_datetime(stripe_ts_str, errors="coerce")
            is_expired = pd.notna(ts_dt) and (datetime.utcnow() - ts_dt.to_pydatetime() > timedelta(hours=24))
            is_paid = any(x in stripe_status_str for x in ["paid", "succeed", "captured"])
            if (not is_expired) or is_paid:
                is_link_valid = True

        if is_link_valid:
            pass
        else:
            print(f"   💳 Stripe Link Needed for {ref} ({guest_name}). Requesting Checkout Session...")
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
                    metadata={'reservation_code': ref, 'guest_name': guest_name, 'property': location}
                )
                row["stripe_session_id"] = session.id
                row["stripe_payment_url"] = session.url
                row["stripe_status"] = "link_generated"
                row["stripe_timestamp"] = datetime.utcnow().isoformat()
                print(f"      ✅ Link generated: {session.url}")
            except Exception as se:
                print(f"      ❌ Stripe Error: {se}")

        # --- TASK B: MONITOR TTLOCK ACCESS CODES ---
        code_created = row.get("code_created", "no")
        raw_response_str = row.get("ttlock_response", "")

        target_lock_id = None
        if ltype == "front_door":
            target_lock_id = prop_conf.get("FRONT_DOOR_LOCK_ID")
        elif ltype == "room":
            target_lock_id = prop_conf.get("ROOM_LOCK_IDS", {}).get(room_name)

        if target_lock_id:
            if code_created == "yes":
                old_start = row.get("start_ms", "")
                old_end = row.get("end_ms", "")
                dates_changed = (str(old_start) != str(start_ms)) or (str(old_end) != str(end_ms))
                
                if dates_changed:
                    pwd_id = None
                    try:
                        resp_dict = ast.literal_eval(raw_response_str)
                        pwd_id = resp_dict.get("keyboardPwdId")
                    except: pass
                    
                    if pwd_id:
                        print(f"   🔄 Scheduling window modification for {ref} — Lock ID {target_lock_id}")
                        success, resp = tt.change_lock_code_period(target_lock_id, pwd_id, start_ms, end_ms)
                        row["code_created"] = "yes" if success else "no"
                        row["ttlock_response"] = str(resp)
                        row["start_ms"] = start_ms
                        row["end_ms"] = end_ms
                    else:
                        code_created = "no"

            if code_created != "yes":
                print(f"   🚪 Generating hardware access credentials for {ref} — Type: {ltype.upper()}")
                desc_label = "Front Door" if ltype == "front_door" else room_name
                success, resp = tt.create_lock_code_simple(target_lock_id, code, guest_name, start_ms, end_ms, f"{desc_label} ({location})", ref)
                
                if not success and isinstance(resp, dict) and resp.get("errcode") == -3007:
                    success = True
                    
                row["code_created"] = "yes" if success else "no"
                row["ttlock_response"] = str(resp)
                row["start_ms"] = start_ms
                row["end_ms"] = end_ms

        processed_log_rows.append(row)

    # --- SAVE UPDATED MASTER LOG FILE ---
    print("\n📝 Committing changes to local storage tracker...")
    final_df = pd.DataFrame(processed_log_rows, columns=LOG_FIELDNAMES)
    final_df["timestamp"] = pd.to_datetime(final_df["timestamp"], errors='coerce')
    
    final_df = final_df.sort_values(by=['timestamp'], ascending=False).drop_duplicates(
        subset=['reservation_code', 'lock_type'], keep='first'
    ).sort_values(by=['timestamp'], ascending=True)

    final_df['timestamp'] = final_df['timestamp'].dt.strftime('%Y-%m-%dT%H:%M:%S.%f').str[:-3]
    os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)
    final_df.to_csv(LOG_PATH, index=False, quoting=csv.QUOTE_MINIMAL)
    
    print(f"✔ Master table fully refreshed with {len(final_df)} records.")
    print("=== Pipeline Execution Complete ===")

if __name__ == "__main__":
    main()
