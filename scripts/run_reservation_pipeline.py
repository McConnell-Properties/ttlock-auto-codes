import os
import csv
import re
import glob
import ast
from datetime import datetime, date, timedelta, time as dt_time
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

# Tracking fields we manage. Everything else is treated as safe CRM data.
TRACKING_FIELDS = [
    "front_door_lock_set", "front_door_ttlock_response",
    "room_lock_set", "room_ttlock_response",
    "start_ms", "end_ms", "ttlock_start", "ttlock_end",
    "stripe_session_id", "stripe_payment_url", "stripe_status", "stripe_timestamp",
    "timestamp"
]

# Legacy ghost columns from older scripts that must be purged
LEGACY_COLS = [
    "reservation_code", "guest_name", "guest_email", "property_location", 
    "door_number", "check_in", "check_out", "lock_type", "code_created", "ttlock_response"
]

# -----------------------------
# ROBUST PARSING HELPERS
# -----------------------------
def find_field(row_dict, fields):
    for f in fields:
        if f in row_dict and pd.notna(row_dict[f]):
            val = str(row_dict[f]).strip()
            if val and val.lower() != "nan":
                return val
    return ""

def clean_date(val):
    if not val: return ""
    try: return pd.to_datetime(val).strftime("%Y-%m-%d")
    except: return ""

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

    today_date = date.today()
    today_ts = pd.Timestamp(today_date)
    uk_tz = ZoneInfo("Europe/London")

    bookings_state = {}

    # ==========================================
    # PHASE 1A: LOAD EXISTING LOGS (AUTO-HEAL)
    # ==========================================
    if os.path.exists(LOG_PATH):
        try:
            df_old = pd.read_csv(LOG_PATH, dtype=str)
            print(f"📖 Found existing log file with {len(df_old)} entries. Running Auto-Heal & Purge...")
            
            # Sort old to new so the newest updates are evaluated last
            if "timestamp" in df_old.columns:
                df_old["tmp_ts"] = pd.to_datetime(df_old["timestamp"], errors="coerce")
                df_old = df_old.sort_values(by="tmp_ts", ascending=True)
                df_old = df_old.drop(columns=["tmp_ts"])

            for index, row in df_old.iterrows():
                row_dict = row.to_dict()
                ref = find_field(row_dict, ["reservation_code", "Booking reference", "booking_reference"])
                if not ref: continue
                
                if ref not in bookings_state:
                    bookings_state[ref] = row_dict.copy()
                else:
                    # If this is the second row of a corrupted "long format" duplicate, merge it safely!
                    for k, v in row_dict.items():
                        if pd.notna(v) and str(v).strip():
                            if k not in bookings_state[ref] or not str(bookings_state[ref][k]).strip():
                                bookings_state[ref][k] = v

                # SELF-HEALING: Collapse "long format" duplicate rows back into wide format
                if "lock_type" in row_dict and find_field(row_dict, ["lock_type"]):
                    ltype = str(row_dict["lock_type"]).strip().lower()
                    cc = str(row_dict.get("code_created", "")).strip().lower() in ["yes", "true"]
                    resp = str(row_dict.get("ttlock_response", ""))
                    
                    if ltype == "front_door":
                        bookings_state[ref]["front_door_lock_set"] = "True" if cc else "False"
                        bookings_state[ref]["front_door_ttlock_response"] = resp
                    elif ltype in ["room", "room_door"]:
                        bookings_state[ref]["room_lock_set"] = "True" if cc else "False"
                        bookings_state[ref]["room_ttlock_response"] = resp

                # PURGE GHOST COLUMNS: Erase legacy script headers so they don't export
                for col in LEGACY_COLS:
                    bookings_state[ref].pop(col, None)

                # Stripe live check
                status = str(row_dict.get("stripe_status", ""))
                session_id = str(row_dict.get("stripe_session_id", ""))
                if status in ["link_generated", "hold_active"] and session_id:
                    try:
                        session = stripe.checkout.Session.retrieve(session_id, expand=['payment_intent'])
                        new_status = status
                        if session.status == "open": pass
                        elif session.status == "complete" and session.payment_intent:
                            pi_status = session.payment_intent.status
                            if pi_status == "requires_capture": new_status = "hold_active"
                            elif pi_status == "succeeded": new_status = "captured"
                            elif pi_status == "canceled": new_status = "released"
                        elif session.status == "expired": new_status = "link_expired"

                        if new_status != status:
                            bookings_state[ref]["stripe_status"] = new_status
                            print(f"   🔄 Stripe Checked for {ref}: '{status}' -> '{new_status}'")
                    except: pass
                
        except Exception as e:
            print(f"⚠️ Warning reading history file: {e}")

    # ==========================================
    # PHASE 1B: LOAD DROPZONE (MERGE CRM DATA)
    # ==========================================
    all_csvs = glob.glob(f"{DATA_DIR}/inputs/*.csv")
    if all_csvs:
        print(f"📥 Parsing new reservations from dropzone to restore CRM columns...")
        for file in all_csvs:
            try:
                df_in = pd.read_csv(file, dtype=str)
                df_in.columns = [c.strip() for c in df_in.columns]
                
                for _, row in df_in.iterrows():
                    row_dict = row.to_dict()
                    ref = find_field(row_dict, ["Booking reference", "booking_reference", "reservation_code"])
                    if not ref: continue
                    
                    if ref not in bookings_state:
                        bookings_state[ref] = row_dict
                    else:
                        # RESTORE DATA: Pull all CRM columns into memory, ignoring tracking fields
                        for k, v in row_dict.items():
                            if pd.notna(v) and str(v).strip() and k not in TRACKING_FIELDS and k not in LEGACY_COLS:
                                bookings_state[ref][k] = v
            except: pass

    # ==========================================
    # PHASE 2: EVALUATE & EXECUTE TASKS
    # ==========================================
    print(f"\n🚀 Evaluating activities for {len(bookings_state)} recorded bookings...")
    final_log_rows = []

    for ref, state in bookings_state.items():
        ci = clean_date(find_field(state, ["Check in date", "Check-in date"]))
        co = clean_date(find_field(state, ["Check out date", "Check-out date"]))
        
        co_dt = pd.to_datetime(co, errors="coerce")
        ci_dt = pd.to_datetime(ci, errors="coerce")
        
        # Keep historical bookings unmodified (1 line per booking)
        if pd.isna(co_dt) or pd.isna(ci_dt) or co_dt.date() < today_date:
            print(f"⏳ Skipping {ref}: Checkout date has passed.")
            final_log_rows.append(state)
            continue

        gname = find_field(state, ["Guest Name"])
        if not gname or gname.lower() == "nan":
            fname = find_field(state, ["Guest first name", "guest_first_name"])
            lname = find_field(state, ["Guest last name", "guest_last_name"])
            gname = f"{fname} {lname}".strip()
            
        location = find_field(state, ["Property name", "property_name"])
        room_name = find_field(state, ["Rooms", "rooms", "room"])
        email = find_field(state, ["Guest email", "email"])
        
        digits = re.sub(r"\D", "", ref)
        code = digits[-4:] if len(digits) >= 4 else None

        if not code or location not in tt.PROPERTIES:
            final_log_rows.append(state)
            continue

        print(f"\n📋 Processing {ref} ({gname}) - {location}")
        state["timestamp"] = datetime.utcnow().isoformat()

        # --- STRIPE ---
        nights = (co_dt - ci_dt).days
        trigger_stripe = (nights <= 5 and today_ts >= (ci_dt - pd.Timedelta(days=2))) or (nights > 5 and today_ts >= (co_dt - pd.Timedelta(days=3)))

        stripe_ts = str(state.get("stripe_timestamp", ""))
        s_dt = pd.to_datetime(stripe_ts, errors="coerce")
        is_expired = pd.notna(s_dt) and (datetime.utcnow() - s_dt.to_pydatetime() > timedelta(hours=24))
        status_str = str(state.get("stripe_status", "")).lower()
        is_secured = any(x in status_str for x in ["paid", "succeed", "captured", "hold_active"])
        is_valid_link = (not is_expired and stripe_ts) or is_secured

        if trigger_stripe and not is_valid_link:
            print(f"   💳 Deposit timing met. Link missing/expired. Generating...")
            try:
                session = stripe.checkout.Session.create(
                    payment_method_types=['card'], mode='payment', customer_email=email if email else None,
                    line_items=[{'price_data': {'currency': CURRENCY, 'product_data': {'name': f"Security Deposit - {location}"}, 'unit_amount': DEPOSIT_AMOUNT}, 'quantity': 1}],
                    payment_intent_data={'capture_method': 'manual'},
                    success_url='https://mcconnell-properties.com/', cancel_url='https://mcconnell-properties.com/',
                    metadata={'reservation_code': ref, 'guest_name': gname, 'property': location}
                )
                state["stripe_session_id"] = session.id
                state["stripe_payment_url"] = session.url
                state["stripe_status"] = "link_generated"
                state["stripe_timestamp"] = datetime.utcnow().isoformat()
                print(f"      ✅ Generated: {session.url}")
            except Exception as e: print(f"      ❌ Stripe Error: {e}")
        elif trigger_stripe and is_valid_link:
            print(f"   💳 Deposit timing met. Existing link is active/secured ({state.get('stripe_status')}).")
        else:
            print(f"   ⏳ Deposit timing NOT met yet (Stay: {nights} nights).")

        # --- TTLOCK ---
        prop_conf = tt.PROPERTIES[location]
        start_dt = datetime.combine(ci_dt.date(), dt_time(15, 0), tzinfo=uk_tz)
        target_start_ms = str(int(start_dt.timestamp() * 1000))
        end_dt = datetime.combine(co_dt.date(), dt_time(11, 0), tzinfo=uk_tz)
        target_end_ms = str(int(end_dt.timestamp() * 1000))

        # Safe parsing for timestamps to prevent false modifications
        try: current_start_ms = str(int(float(str(state.get("start_ms", "")).strip())))
        except: current_start_ms = ""
        try: current_end_ms = str(int(float(str(state.get("end_ms", "")).strip())))
        except: current_end_ms = ""

        # Front Door Lock Logic
        fd_id = prop_conf.get("FRONT_DOOR_LOCK_ID")
        if fd_id:
            fd_set = str(state.get("front_door_lock_set", "")).lower() in ["true", "yes"]
            if fd_set:
                if current_start_ms == target_start_ms and current_end_ms == target_end_ms:
                    print(f"   ✅ Front door code matches calendar window. Bypassing API.")
                else:
                    pwd_id = ast.literal_eval(state.get("front_door_ttlock_response", "{}")).get("keyboardPwdId") if state.get("front_door_ttlock_response") else None
                    if pwd_id:
                        print(f"   🔄 Dates changed. Modifying Front Door window...")
                        success, resp = tt.change_lock_code_period(fd_id, pwd_id, target_start_ms, target_end_ms)
                        state["front_door_lock_set"] = "True" if success else "False"
                        state["front_door_ttlock_response"] = str(resp)
                    else: fd_set = False # Fallback to recreating

            if not fd_set:
                print(f"   🚪 Generating Front Door code via API...")
                success, resp = tt.create_lock_code_simple(fd_id, code, gname, target_start_ms, target_end_ms, f"Front Door ({location})", ref)
                if not success and isinstance(resp, dict) and resp.get("errcode") == -3007: success = True
                state["front_door_lock_set"] = "True" if success else "False"
                state["front_door_ttlock_response"] = str(resp)

        # Room Lock Logic
        rm_id = prop_conf.get("ROOM_LOCK_IDS", {}).get(room_name)
        if rm_id:
            rm_set = str(state.get("room_lock_set", "")).lower() in ["true", "yes"]
            if rm_set:
                if current_start_ms == target_start_ms and current_end_ms == target_end_ms:
                    print(f"   ✅ Room code matches calendar window. Bypassing API.")
                else:
                    pwd_id = ast.literal_eval(state.get("room_ttlock_response", "{}")).get("keyboardPwdId") if state.get("room_ttlock_response") else None
                    if pwd_id:
                        print(f"   🔄 Dates changed. Modifying Room window...")
                        success, resp = tt.change_lock_code_period(rm_id, pwd_id, target_start_ms, target_end_ms)
                        state["room_lock_set"] = "True" if success else "False"
                        state["room_ttlock_response"] = str(resp)
                    else: rm_set = False # Fallback to recreating

            if not rm_set:
                print(f"   🚪 Generating Room code via API...")
                success, resp = tt.create_lock_code_simple(rm_id, code, gname, target_start_ms, target_end_ms, f"{room_name} ({location})", ref)
                if not success and isinstance(resp, dict) and resp.get("errcode") == -3007: success = True
                state["room_lock_set"] = "True" if success else "False"
                state["room_ttlock_response"] = str(resp)

        # Sync final timestamps
        state["start_ms"] = target_start_ms
        state["end_ms"] = target_end_ms
        state["ttlock_start"] = start_dt.strftime("%Y-%m-%d %H:%M %Z")
        state["ttlock_end"] = end_dt.strftime("%Y-%m-%d %H:%M %Z")

        # One row per booking
        final_log_rows.append(state)

    # ==========================================
    # PHASE 3: WRITE MASTER LOG
    # ==========================================
    print("\n📝 Refreshing tracking table...")
    if not final_log_rows: return

    final_df = pd.DataFrame(final_log_rows)
    
    # Ensure all required tracking fields exist in output
    for col in TRACKING_FIELDS:
        if col not in final_df.columns: final_df[col] = ""

    os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)
    
    # Organize so Tracking Fields are neat at the beginning, followed by CRM Data
    existing_tracking = [c for c in TRACKING_FIELDS if c in final_df.columns]
    crm_cols = [c for c in final_df.columns if c not in existing_tracking]
    final_df = final_df[existing_tracking + crm_cols]

    # Output ALL columns dynamically, no truncation!
    final_df.to_csv(LOG_PATH, index=False, quoting=csv.QUOTE_MINIMAL)
    print(f"✔ Master table refreshed with {len(final_df)} records.")

if __name__ == "__main__":
    main()
