import os
import glob
import pandas as pd
import stripe
from datetime import datetime, date, timedelta

# -----------------------------
# CONFIGURATION
# -----------------------------
stripe.api_key = os.getenv("STRIPE_SECRET_KEY")
DEPOSIT_AMOUNT = 8000  # £80.00 (Stripe uses pence/cents)
CURRENCY = "gbp"

DATA_DIR = "automation-data"
LOG_FILE = f"{DATA_DIR}/stripe_deposit_log.csv"
LOG_FIELDNAMES = ["timestamp", "reservation_code", "guest_name", "property_location", "check_in", "session_id", "payment_url", "status"]

# -----------------------------
# HELPERS
# -----------------------------
def load_active_stripe_refs():
    """
    Load reservation codes that have a valid, unexpired session link.
    If a link was generated over 24 hours ago and is still pending, 
    we allow it to be regenerated.
    """
    if not os.path.exists(LOG_FILE):
        return set()
    try:
        df = pd.read_csv(LOG_FILE, dtype=str)
        if df.empty:
            return set()
            
        # Convert timestamp to a datetime object for comparison
        df["timestamp_dt"] = pd.to_datetime(df["timestamp"], errors="coerce")
        
        # Define the expiration cutoff (24 hours ago)
        expiration_cutoff = datetime.utcnow() - timedelta(hours=24)
        
        # A link is considered "still active" if it is under 24 hours old 
        # OR if it has been marked as fully paid/succeeded.
        active_mask = (df["timestamp_dt"] >= expiration_cutoff) | (df["status"].str.lower().str.contains("paid|succeed|captured", na=False))
        
        active_refs = set(df[active_mask]["reservation_code"].dropna().unique())
        return active_refs
        
    except Exception as e:
        print(f"⚠️ Could not evaluate active logs from {LOG_FILE}: {e}")
        return set()

def get_upcoming_bookings():
    """Find bookings needing a deposit link, including expired links that need regeneration."""
    all_csvs = glob.glob(f"{DATA_DIR}/inputs/*.csv")

    if not all_csvs:
        print("⚠️ No CSV files found in the inputs dropzone.")
        return []

    df_list = []
    for file in all_csvs:
        try:
            df_list.append(pd.read_csv(file, dtype=str))
        except:
            continue

    if not df_list:
        return []

    df = pd.concat(df_list, ignore_index=True)
    df.rename(columns=lambda c: str(c).strip().lower().replace(" ", "_"), inplace=True)

    if "booking_reference" not in df.columns:
        print("⚠️ 'booking_reference' column missing from input CSVs.")
        return []

    df["reservation_code"] = df["booking_reference"].fillna("").astype(str).str.strip()
    df = df[df["reservation_code"] != ""]
    
    df["check_in"] = pd.to_datetime(df.get("check_in_date"), errors="coerce")
    df["check_out"] = pd.to_datetime(df.get("check_out_date"), errors="coerce")
    df = df.dropna(subset=["check_in", "check_out"])

    today = pd.Timestamp(date.today())
    df["nights"] = (df["check_out"] - df["check_in"]).dt.days

    # Load currently active refs to identify what has already expired
    active_refs = load_active_stripe_refs()

    bookings = []
    for ref, g in df.groupby("reservation_code"):
        first = g.iloc[0]
        checkout_date = first["check_out"]
        
        # Safety Check: If the guest has already checked out completely, skip them
        if today >= checkout_date:
            continue

        # --- FORCE REGENERATION OVERRIDE ---
        # If this reservation exists in our data dropzone, but does NOT have 
        # an active link (< 24 hours old or paid) in our logs, FORCE it to process immediately.
        if ref not in active_refs:
            force_process = True
        else:
            # Otherwise, fall back to standard timing rules for brand new bookings
            mask_short = (first["nights"] <= 5) & (today >= (first["check_in"] - pd.Timedelta(days=2)))
            mask_long = (first["nights"] > 5) & (today >= (first["check_out"] - pd.Timedelta(days=3)))
            force_process = mask_short | mask_long

        if force_process:
            fname = str(first.get("guest_first_name", "")).strip()
            lname = str(first.get("guest_last_name", "")).strip()
            guest = f"{fname} {lname}".strip().replace("nan", "")
            email = str(first.get("guest_email", "")).strip()
            
            bookings.append({
                "reservation_code": ref,
                "guest_name": guest,
                "guest_email": email if email.lower() != "nan" else None,
                "property_location": first.get("property_name", ""),
                "check_in": first["check_in"].strftime("%Y-%m-%d")
            })

    return bookings

# -----------------------------
# MAIN LOGIC
# -----------------------------
def main():
    print("=== Stripe Pre-Authorization Automation Start ===")
    
    if not stripe.api_key:
        print("❌ STRIPE_SECRET_KEY not set in environment – cannot proceed.")
        return

    # Call the new smart filter function instead
    active_refs = load_active_stripe_refs()
    bookings = get_upcoming_bookings()
    
    if not bookings:
        print("ℹ️ No eligible upcoming bookings found in dropzone matching the timing rules.")
        return

    new_logs = []

    for b in bookings:
        ref = b["reservation_code"]
        if ref in active_refs:
            continue  # Skips only if there's a live link < 24 hrs old, or if already paid

        print(f"\n💳 Generating/Regenerating Standard 7-Day £80 Hold Session for {ref} ({b['guest_name']})")
        
        try:
            # Create a Stripe Checkout Session for a standard authorization hold
            session = stripe.checkout.Session.create(
                payment_method_types=['card'],
                mode='payment',
                customer_email=b['guest_email'],
                line_items=[{
                    'price_data': {
                        'currency': CURRENCY,
                        'product_data': {
                            'name': f"Security Deposit - {b['property_location']}",
                            'description': f"Refundable damage hold for booking {ref}",
                        },
                        'unit_amount': DEPOSIT_AMOUNT,
                    },
                    'quantity': 1,
                }],
                payment_intent_data={
                    'capture_method': 'manual', # This ensures it's an authorization hold, not a direct charge
                },
                success_url='https://mcconnell-properties.com/', 
                cancel_url='https://mcconnell-properties.com/',
                metadata={
                    'reservation_code': ref,
                    'guest_name': b['guest_name'],
                    'property': b['property_location']
                }
            )
            
            print(f"✅ Success! URL generated: {session.url}")
            
            new_logs.append({
                "timestamp": datetime.utcnow().isoformat(),
                "reservation_code": ref,
                "guest_name": b["guest_name"],
                "property_location": b["property_location"],
                "check_in": b["check_in"],
                "session_id": session.id,
                "payment_url": session.url,
                "status": "link_generated"
            })
            
            active_refs.add(ref)

        except Exception as e:
            print(f"❌ Stripe Error for {ref}: {e}")

    # Save to Log File
    if new_logs:
        print("\n📝 Saving new Stripe sessions to log...")
        new_df = pd.DataFrame(new_logs, columns=LOG_FIELDNAMES)
        
        if os.path.exists(LOG_FILE):
            existing_df = pd.read_csv(LOG_FILE)
            combined = pd.concat([existing_df, new_df], ignore_index=True)
        else:
            combined = new_df
            
        os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)
        combined.to_csv(LOG_FILE, index=False)
        print(f"✔ Added {len(new_logs)} new deposit links to {LOG_FILE}")
    else:
        print("\nℹ️ No new deposit links needed right now.")

    print("=== Stripe Pre-Authorization Automation Complete ===")

if __name__ == "__main__":
    main()
