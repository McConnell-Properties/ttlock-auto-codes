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
    "ttlock_start",    # Human-readable comparison field
    "ttlock_end",      # Human-readable comparison field
    "stripe_session_id",
    "stripe_payment_url",
    "stripe_status",
    "stripe_timestamp"
]

# -----------------------------
# ROBUST PARSING HELPERS
# -----------------------------
def find_field(row_dict, fields):
    """Dynamically lookup values across common column header variations."""
    for f in fields:
        if f in row_dict and pd.notna(row_dict[f]):
            val = str(row_dict[f]).strip()
            if val and val.lower() != "nan":
                return val
    return ""

def clean_date(val):
    """Safely convert any messy timestamp string format into a clean YYYY-MM-DD date."""
    if not val:
        return ""
    try:
        return pd.to_datetime(val).strftime("%Y-%m-%d")
    except:
        return ""

# -----------------------------
# CORE PIPELINE LOGIC
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

    today_date = date.today()
    today_ts = pd.Timestamp(today_date)
    uk_tz = ZoneInfo("Europe/London")

    # ==========================================
    # PHASE 1: BUILD & UPDATE MASTER STATE
    # ==========================================
    bookings_state = {}

    # 1A. Load Existing Status Log & Check Live Stripe Statuses
    if os.path.exists(LOG_PATH):
        try:
            df_old = pd.read_csv(LOG_PATH, dtype=str)
            print(f"📖 Found existing log file with {len(df_old)} data entries. Normalizing headers...")
            
            for index, row in df_old.iterrows():
                row_dict = row.to_dict()
                
                ref = find_field(row_dict, ["reservation_code", "Booking reference", "booking_reference"])
                if not ref: continue
                
                if ref not in bookings_state:
                    bookings_state[ref] = {"core": {}, "locks": {}, "stripe": {}, "timestamp": row_dict.get("timestamp", datetime.utcnow().isoformat())}
                
                # Clean dates robustly from any structural variation
                ci = clean_date(find_field(row_dict, ["check_in", "Check in date", "Check-in date"]))
                co = clean_date(find_field(row_dict, ["check_out", "Check out date", "Check-out date"]))
                
                # SAFEGUARD FIX: Calculate expected timestamps to patch legacy sheets missing start_ms/end_ms
                calc_start_ms = ""
                calc_end_ms = ""
                calc_t_start = ""
                calc_t_end = ""
                if ci and co:
                    try:
                        c_dt = pd.to_datetime(ci)
                        o_dt = pd.to_datetime(co)
                        start_dt = datetime.combine(c_dt.date(), time(15, 0), tzinfo=uk_tz)
                        calc_start_ms = str(int(start_dt.timestamp() * 1000))
                        calc_t_start = start_dt.strftime("%Y-%m-%d %H:%M %Z")
                        
                        end_dt = datetime.combine(o_dt.date(), time(11, 0), tzinfo=uk_tz)
                        calc_end_ms = str(int(end_dt.timestamp() * 1000))
                        calc_t_end = end_dt.strftime("%Y-%m-%d %H:%M %Z")
                    except: pass

                # Use real ms/text if they exist, otherwise inject calculated values so they bypass API triggers
                start_ms_val = str(row_dict.get("start_ms", "")).strip() or calc_start_ms
                end_ms_val = str(row_dict.get("end_ms", "")).strip() or calc_end_ms
                t_start_val = str(row_dict.get("ttlock_start", "")).strip() or calc_t_start
                t_end_val = str(row_dict.get("ttlock_end", "")).strip() or calc_t_end

                # Reconstruct full guest name
                gname = find_field(row_dict, ["guest_name", "Guest Name"])
                if not gname:
                    fname = find_field(row_dict, ["guest_first_name", "Guest first name"])
                    lname = find_field(row_dict, ["guest_last_name", "Guest last name"])
                    gname = f"{fname} {lname}".strip()

                bookings_state[ref]["core"] = {
                    "guest_name": gname,
                    "guest_email": find_field(row_dict, ["guest_email", "Guest email", "email"]),
                    "property_location": find_field(row_dict, ["property_location", "Property name", "property_name"]),
                    "door_number": find_field(row_dict, ["door_number", "Rooms", "rooms", "room"]),
                    "check_in": ci,
                    "check_out": co
                }
                
                # --- LEGACY LOCK COMPATIBILITY TRANSLATOR ---
                ltype = find_field(row_dict, ["lock_type"])
                
                # If we are reading a legacy wide-row format
                if not ltype:
                    fd_set = str(row_dict.get("front_door_lock_set", "")).strip().lower() == "true"
                    room_set = str(row_dict.get("room_lock_set", "")).strip().lower() == "true"
                    
                    bookings_state[ref]["locks"]["front_door"] = {
                        "code_created": "yes" if fd_set else "no",
                        "ttlock_response": "Legacy log preserved",
                        "start_ms": start_ms_val,
                        "end_ms": end_ms_val,
                        "ttlock_start": t_start_val,
                        "ttlock_end": t_end_val
                    }
                    bookings_state[ref]["locks"]["room"] = {
                        "code_created": "yes" if room_set else "no",
                        "ttlock_response": "Legacy log preserved",
                        "start_ms": start_ms_val,
                        "end_ms": end_ms_val,
                        "ttlock_start": t_start_val,
                        "ttlock_end": t_end_val
                    }
                else:
                    # Reading the new unified long-row format
                    if find_field(row_dict, ["code_created"]):
                        bookings_state[ref]["locks"][ltype] = {
                            "code_created": row_dict.get("code_created", "no"),
                            "ttlock_response": row_dict.get("ttlock_response", ""),
                            "start_ms": start_ms_val, "end_ms": end_ms_val,
                            "ttlock_start": t_start_val, "ttlock_end": t_end_val
                        }
                # ----------------------------------------------
                
                # Load Stripe Details safely
                s_id = find_field(row_dict, ["stripe_session_id", "session_id"])
                if s_id:
                    bookings_state[ref]["stripe"] = {
                        "stripe_session_id": s_id,
                        "stripe_payment_url": find_field(row_dict, ["stripe_payment_url", "payment_url"]),
                        "stripe_status": find_field(row_dict, ["stripe_status"]),
                        "stripe_timestamp": find_field(row_dict, ["stripe_timestamp", "stripe_time"])
                    }
                
                # Live Stripe hold status checking
                stripe_data = bookings_state[ref]["stripe"]
                status = stripe_data.get("stripe_status", "")
                session_id = stripe_data.get("stripe_session_id", "")
                
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
                            stripe_data["stripe_status"] = new_status
                            print(f"   🔄 Stripe Status Checked for {ref}: '{status}' -> '{new_status}'")
                    except Exception as e:
                        pass
        except Exception as e:
            print(f"⚠️ Warning reading history file: {e}")

    # 1B. Ingest New Dropzone Data (Overwrites old core data)
    all_csvs = glob.glob(f"{DATA_DIR}/inputs/*.csv")
    if all_csvs:
        print(f"📥 Parsing new reservations from dropzone...")
        df_list = []
        for file in all_csvs:
            try: df_list.append(pd.read_csv(file, dtype=str))
            except: pass
        
        if df_list:
            df_in = pd.concat(df_list, ignore_index=True)
            df_in.columns = [c.strip() for c in df_in.columns]
            
            for _, row in df_in.iterrows():
                row_dict = row.to_dict()
                ref = find_field(row_dict, ["reservation_code", "Booking reference", "booking_reference"])
                if not ref: continue
                
                ci = clean_date(find_field(row_dict, ["check_in", "Check in date", "Check-in date"]))
                co = clean_date(find_field(row_dict, ["check_out", "Check out date", "Check-out date"]))
                if not ci or not co: continue
                
                if ref not in bookings_state:
                    bookings_state[ref] = {"core": {}, "locks": {}, "stripe": {}, "timestamp": datetime.utcnow().isoformat()}

                gname = find_field(row_dict, ["guest_name", "Guest Name"])
                if not gname:
                    fname = find_field(row_dict, ["guest_first_name", "Guest first name"])
                    lname = find_field(row_dict, ["guest_last_name", "Guest last name"])
                    gname = f"{fname} {lname}".strip()

                bookings_state[ref]["core"].update({
                    "guest_name": gname,
                    "guest_email": find_field(row_dict, ["guest_email", "Guest email", "email"]),
                    "property_location": find_field(row_dict, ["property_location", "Property name", "property_name"]),
                    "door_number": find_field(row_dict, ["door_number", "Rooms", "rooms", "room"]),
                    "check_in": ci,
                    "check_out": co
                })

    # ==========================================
    # PHASE 2: EVALUATE & EXECUTE TASKS
    # ==========================================
    print(f"\n🚀 Evaluating activities for {len(bookings_state)} recorded bookings...")
    final_log_rows = []

    for ref, state in bookings_state.items():
        core = state["core"]
        
        co_str = core.get("check_out", "")
        ci_str = core.get("check_in", "")
        co_dt = pd.to_datetime(co_str, errors="coerce")
        ci_dt = pd.to_datetime(ci_str, errors="coerce")
        
        # --- HISTORICAL BOOKING HANDLER ---
        # If the checkout date has already passed, save records directly to maintain historical lines
        if pd.isna(co_dt) or pd.isna(ci_dt) or co_dt.date() < today_date:
            print(f"⏳ Skipping {ref} ({core.get('guest_name')}): Checkout date ({co_str}) has passed.")
            
            lock_types_to_save = list(state["locks"].keys()) if state["locks"] else ["front_door", "room"]
            for ltype in lock_types_to_save:
                l_data = state["locks"].get(ltype, {"code_created": "yes", "ttlock_response": "Historical log preserved", "start_ms": "", "end_ms": "", "ttlock_start": "", "ttlock_end": ""})
                row_dict = {"timestamp": state.get("timestamp", datetime.utcnow().isoformat()), "reservation_code": ref, "lock_type": ltype}
                row_dict.update(core)
                row_dict.update(l_data)
                row_dict.update(state.get("stripe", {}))
                final_log_rows.append(row_dict)
            continue
        # ----------------------------------

        location = core["property_location"]
        room_name = core["door_number"]
        guest_name = core["guest_name"]
        email = core["guest_email"]

        digits = re.sub(r"\D", "", ref)
        code = digits[-4:] if len(digits) >= 4 else None

        if not code or location not in tt.PROPERTIES:
            continue

        print(f"\n📋 Processing {ref} ({guest_name}) - {location}")

        # --- STRIPE EVALUATION ---
        stripe_data = state["stripe"]
        nights = (co_dt - ci_dt).days
        
        trigger_stripe = False
        if nights <= 5 and today_ts >= (ci_dt - pd.Timedelta(days=2)): trigger_stripe = True
        elif nights > 5 and today_ts >= (co_dt - pd.Timedelta(days=3)): trigger_stripe = True

        is_valid_link = False
        if stripe_data.get("stripe_timestamp"):
            s_ts = pd.to_datetime(stripe_data["stripe_timestamp"], errors="coerce")
            is_expired = pd.notna(s_ts) and (datetime.utcnow() - s_ts.to_pydatetime() > timedelta(hours=24))
            status_str = str(stripe_data.get("stripe_status", "")).lower()
            is_secured = any(x in status_str for x in ["paid", "succeed", "captured", "hold_active"])
            if (not is_expired) or is_secured: is_valid_link = True

        if trigger_stripe and not is_valid_link:
            print(f"   💳 Deposit timing met. Link missing/expired. Generating...")
            try:
                session = stripe.checkout.Session.create(
                    payment_method_types=['card'], mode='payment', customer_email=email if email else None,
                    line_items=[{'price_data': {'currency': CURRENCY, 'product_data': {'name': f"Security Deposit - {location}", 'description': f"Refundable hold for {ref}"}, 'unit_amount': DEPOSIT_AMOUNT}, 'quantity': 1}],
                    payment_intent_data={'capture_method': 'manual'},
                    success_url='https://mcconnell-properties.com/', cancel_url='https://mcconnell-properties.com/',
                    metadata={'reservation_code': ref, 'guest_name': guest_name, 'property': location}
                )
                stripe_data.update({"stripe_session_id": session.id, "stripe_payment_url": session.url, "stripe_status": "link_generated", "stripe_timestamp": datetime.utcnow().isoformat()})
                print(f"      ✅ Generated: {session.url}")
            except Exception as e:
                print(f"      ❌ Stripe Error: {e}")
        elif trigger_stripe and is_valid_link:
            print(f"   💳 Deposit timing met. Existing link is active/secured ({stripe_data.get('stripe_status')}).")
        else:
            print(f"   ⏳ Deposit timing NOT met yet (Stay: {nights} nights). Skipping Stripe.")

        # --- TTLOCK EVALUATION ---
        prop_conf = tt.PROPERTIES[location]
        start_dt = datetime.combine(ci_dt.date(), time(15, 0), tzinfo=uk_tz)
        start_ms = int(start_dt.timestamp() * 1000)
        end_dt = datetime.combine(co_dt.date(), time(11, 0), tzinfo=uk_tz)
        end_ms = int(end_dt.timestamp() * 1000)
        
        t_start_str = start_dt.strftime("%Y-%m-%d %H:%M %Z")
        t_end_str = end_dt.strftime("%Y-%m-%d %H:%M %Z")

        for ltype in ["front_door", "room"]:
            lock_id = None
            if ltype == "front_door": lock_id = prop_conf.get("FRONT_DOOR_LOCK_ID")
            elif ltype == "room": lock_id = prop_conf.get("ROOM_LOCK_IDS", {}).get(room_name)

            if not lock_id: continue

            l_data = state["locks"].get(ltype, {"code_created": "no", "ttlock_response": "", "start_ms": "", "end_ms": "", "ttlock_start": "", "ttlock_end": ""})
            
            if l_data["code_created"] == "yes":
                if str(l_data["start_ms"]) == str(start_ms) and str(l_data["end_ms"]) == str(end_ms):
                    print(f"   ✅ {ltype} code matches calendar window. Bypassing API.")
                else:
                    pwd_id = None
                    try: pwd_id = ast.literal_eval(l_data["ttlock_response"]).get("keyboardPwdId")
                    except: pass
                    
                    if pwd_id:
                        print(f"   🔄 Dates changed. Modifying {ltype} window via API...")
                        success, resp = tt.change_lock_code_period(lock_id, pwd_id, start_ms, end_ms)
                        l_data.update({"code_created": "yes" if success else "no", "ttlock_response": str(resp), "start_ms": start_ms, "end_ms": end_ms, "ttlock_start": t_start_str, "ttlock_end": t_end_str})
                    else:
                        l_data["code_created"] = "no"

            if l_data["code_created"] != "yes":
                print(f"   🚪 Generating {ltype} code via API...")
                desc = "Front Door" if ltype == "front_door" else room_name
                success, resp = tt.create_lock_code_simple(lock_id, code, guest_name, start_ms, end_ms, f"{desc} ({location})", ref)
                if not success and isinstance(resp, dict) and resp.get("errcode") == -3007: success = True
                l_data.update({"code_created": "yes" if success else "no", "ttlock_response": str(resp), "start_ms": start_ms, "end_ms": end_ms, "ttlock_start": t_start_str, "ttlock_end": t_end_str})

            # Format finalized dictionary fields
            final_row = {"timestamp": state.get("timestamp", datetime.utcnow().isoformat()), "reservation_code": ref, "lock_type": ltype}
            final_row.update(core)
            final_row.update(l_data)
            final_row.update(stripe_data)
            final_log_rows.append(final_row)

    # ==========================================
    # PHASE 3: WRITE MASTER LOG
    # ==========================================
    print("\n📝 Refreshing unified tracking table...")
    if not final_log_rows:
        print("ℹ️ No rows to write.")
        return

    final_df = pd.DataFrame(final_log_rows, columns=LOG_FIELDNAMES)
    for col in LOG_FIELDNAMES:
        if col not in final_df.columns: final_df[col] = ""
    
    final_df = final_df.reindex(columns=LOG_FIELDNAMES)
    os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)
    final_df.to_csv(LOG_PATH, index=False, quoting=csv.QUOTE_MINIMAL)
    
    print(f"✔ Master table fully refreshed with {len(final_df)} records.")
    print("=== Pipeline Execution Complete ===")

if __name__ == "__main__":
    main()
