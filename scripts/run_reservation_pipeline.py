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
    "stripe_session_id",
    "stripe_payment_url",
    "stripe_status",
    "stripe_timestamp"
]

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

    # 1A. Load Existing Status Log
    if os.path.exists(LOG_PATH):
        try:
            df_old = pd.read_csv(LOG_PATH, dtype=str)
            # Ensure all columns exist
            for col in LOG_FIELDNAMES:
                if col not in df_old.columns:
                    df_old[col] = ""
            
            # Sort old to new so latest updates win
            df_old["tmp_ts"] = pd.to_datetime(df_old["timestamp"], errors="coerce")
            df_old = df_old.sort_values(by="tmp_ts", ascending=True)

            for _, row in df_old.dropna(subset=["reservation_code"]).iterrows():
                ref = row["reservation_code"].strip()
                ltype = row.get("lock_type", "").strip() or "room"
                
                if ref not in bookings_state:
                    bookings_state[ref] = {
                        "core": {},
                        "locks": {},
                        "stripe": {}
                    }
                
                # Load Core Details
                bookings_state[ref]["core"] = {
                    "guest_name": row.get("guest_name", ""),
                    "guest_email": row.get("guest_email", ""),
                    "property_location": row.get("property_location", ""),
                    "door_number": row.get("door_number", ""),
                    "check_in": row.get("check_in", ""),
                    "check_out": row.get("check_out", "")
                }
                
                # Load Lock Details
                bookings_state[ref]["locks"][ltype] = {
                    "code_created": row.get("code_created", "no"),
                    "ttlock_response": row.get("ttlock_response", ""),
                    "start_ms": row.get("start_ms", ""),
                    "end_ms": row.get("end_ms", "")
                }
                
                # Load Stripe Details (we only need one stripe record per booking)
                if str(row.get("stripe_timestamp", "")).strip():
                    bookings_state[ref]["stripe"] = {
                        "stripe_session_id": row.get("stripe_session_id", ""),
                        "stripe_payment_url": row.get("stripe_payment_url", ""),
                        "stripe_status": row.get("stripe_status", "link_generated"),
                        "stripe_timestamp": row.get("stripe_timestamp", "")
                    }
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
            
            if "Booking reference" in df_in.columns:
                df_in["reservation_code"] = df_in["Booking reference"].fillna("").astype(str).str.strip()
                df_in = df_in[df_in["reservation_code"] != ""]
                df_in["check_in_dt"] = pd.to_datetime(df_in.get("Check in date"), errors="coerce")
                df_in["check_out_dt"] = pd.to_datetime(df_in.get("Check out date"), errors="coerce")
                df_in = df_in.dropna(subset=["check_in_dt", "check_out_dt"])

                for ref, g in df_in.groupby("reservation_code"):
                    first = g.iloc[0]
                    co_dt = g["check_out_dt"].max()
                    
                    if ref not in bookings_state:
                        bookings_state[ref] = {"core": {}, "locks": {}, "stripe": {}}

                    fname = str(first.get("Guest first name", "")).strip().replace("nan", "")
                    lname = str(first.get("Guest last name", "")).strip().replace("nan", "")
                    guest = f"{fname} {lname}".strip()
                    email = str(first.get("Guest email", "")).strip().replace("nan", "")

                    bookings_state[ref]["core"].update({
                        "guest_name": guest,
                        "guest_email": email if email else bookings_state[ref]["core"].get("guest_email", ""),
                        "property_location": first.get("Property name", "") or "",
                        "door_number": first.get("Rooms", "") or "",
                        "check_in": g["check_in_dt"].min().strftime("%Y-%m-%d"),
                        "check_out": co_dt.strftime("%Y-%m-%d")
                    })

    # ==========================================
    # PHASE 2: EVALUATE & EXECUTE TASKS
    # ==========================================
    print(f"\n🚀 Evaluating activities for {len(bookings_state)} recorded bookings...")
    final_log_rows = []

    for ref, state in bookings_state.items():
        core = state["core"]
        
        # Skip incomplete data or past bookings
        if not core.get("check_out") or not core.get("check_in"): continue
        
        co_dt = pd.to_datetime(core["check_out"], errors="coerce")
        ci_dt = pd.to_datetime(core["check_in"], errors="coerce")
        
        if pd.isna(co_dt) or pd.isna(ci_dt) or co_dt.date() < today_date:
            continue  # Skip expired stays

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
        
        # Determine if timing rules dictate a link is needed right now
        trigger_stripe = False
        if nights <= 5 and today_ts >= (ci_dt - pd.Timedelta(days=2)):
            trigger_stripe = True
        elif nights > 5 and today_ts >= (co_dt - pd.Timedelta(days=3)):
            trigger_stripe = True

        # Check if we already have a valid link
        is_valid_link = False
        if stripe_data.get("stripe_timestamp"):
            s_ts = pd.to_datetime(stripe_data["stripe_timestamp"], errors="coerce")
            is_expired = pd.notna(s_ts) and (datetime.utcnow() - s_ts.to_pydatetime() > timedelta(hours=24))
            status_str = str(stripe_data.get("stripe_status", "")).lower()
            is_paid = any(x in status_str for x in ["paid", "succeed", "captured"])
            
            if (not is_expired) or is_paid:
                is_valid_link = True

        if trigger_stripe and not is_valid_link:
            print(f"   💳 Deposit timing met. Link missing/expired. Generating...")
            try:
                session = stripe.checkout.Session.create(
                    payment_method_types=['card'],
                    mode='payment',
                    customer_email=email if email else None,
                    line_items=[{'price_data': {'currency': CURRENCY, 'product_data': {'name': f"Security Deposit - {location}", 'description': f"Refundable hold for {ref}"}, 'unit_amount': DEPOSIT_AMOUNT}, 'quantity': 1}],
                    payment_intent_data={'capture_method': 'manual'},
                    success_url='https://mcconnell-properties.com/', cancel_url='https://mcconnell-properties.com/',
                    metadata={'reservation_code': ref, 'guest_name': guest_name, 'property': location}
                )
                stripe_data.update({
                    "stripe_session_id": session.id, "stripe_payment_url": session.url,
                    "stripe_status": "link_generated", "stripe_timestamp": datetime.utcnow().isoformat()
                })
                print(f"      ✅ Generated: {session.url}")
            except Exception as e:
                print(f"      ❌ Stripe Error: {e}")
        elif trigger_stripe and is_valid_link:
            print(f"   💳 Deposit timing met. Existing link is active/paid.")
        else:
            print(f"   ⏳ Deposit timing NOT met yet (Stay: {nights} nights). Skipping Stripe.")

        # --- TTLOCK EVALUATION ---
        prop_conf = tt.PROPERTIES[location]
        start_dt = datetime.combine(ci_dt.date(), time(15, 0), tzinfo=uk_tz)
        start_ms = int(start_dt.timestamp() * 1000)
        end_dt = datetime.combine(co_dt.date(), time(11, 0), tzinfo=uk_tz)
        end_ms = int(end_dt.timestamp() * 1000)

        for ltype in ["front_door", "room"]:
            lock_id = None
            if ltype == "front_door": lock_id = prop_conf.get("FRONT_DOOR_LOCK_ID")
            elif ltype == "room": lock_id = prop_conf.get("ROOM_LOCK_IDS", {}).get(room_name)

            if not lock_id: continue

            l_data = state["locks"].get(ltype, {"code_created": "no", "ttlock_response": "", "start_ms": "", "end_ms": ""})
            
            if l_data["code_created"] == "yes":
                if str(l_data["start_ms"]) == str(start_ms) and str(l_data["end_ms"]) == str(end_ms):
                    print(f"   ✅ {ltype} code matches calendar window.")
                else:
                    pwd_id = None
                    try: pwd_id = ast.literal_eval(l_data["ttlock_response"]).get("keyboardPwdId")
                    except: pass
                    
                    if pwd_id:
                        print(f"   🔄 Dates changed. Modifying {ltype} window...")
                        success, resp = tt.change_lock_code_period(lock_id, pwd_id, start_ms, end_ms)
                        l_data.update({"code_created": "yes" if success else "no", "ttlock_response": str(resp), "start_ms": start_ms, "end_ms": end_ms})
                    else:
                        l_data["code_created"] = "no"

            if l_data["code_created"] != "yes":
                print(f"   🚪 Generating {ltype} code...")
                desc = "Front Door" if ltype == "front_door" else room_name
                success, resp = tt.create_lock_code_simple(lock_id, code, guest_name, start_ms, end_ms, f"{desc} ({location})", ref)
                if not success and isinstance(resp, dict) and resp.get("errcode") == -3007: success = True
                l_data.update({"code_created": "yes" if success else "no", "ttlock_response": str(resp), "start_ms": start_ms, "end_ms": end_ms})

            # Append the completed row object to our final output list
            final_row = {
                "timestamp": datetime.utcnow().isoformat(),
                "reservation_code": ref,
                "lock_type": ltype
            }
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
    
    # Fill missing columns
    for col in LOG_FIELDNAMES:
        if col not in final_df.columns: final_df[col] = ""
    
    final_df = final_df.reindex(columns=LOG_FIELDNAMES)
    
    os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)
    final_df.to_csv(LOG_PATH, index=False, quoting=csv.QUOTE_MINIMAL)
    
    print(f"✔ Master table fully refreshed with {len(final_df)} records.")
    print("=== Pipeline Execution Complete ===")

if __name__ == "__main__":
    main()
