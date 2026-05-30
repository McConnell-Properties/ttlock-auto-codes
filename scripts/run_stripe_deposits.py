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
def load_stripe_logs():
    """Load existing deposit logs so we don't create duplicate sessions."""
    if not os.path.exists(LOG_FILE):
        return set()
    try:
        df = pd.read_csv(LOG_FILE, dtype=str)
        return set(df["reservation_code"].dropna().unique())
    except Exception as e:
        print(f"⚠️ Could not read {LOG_FILE}: {e}")
        return set()

def get_upcoming_bookings():
    """Find bookings needing a deposit link based on the length of stay rules."""
    all_csvs = glob.glob(f"{DATA_DIR}/inputs/*.csv")

    if not all_csvs:
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
        return []

    df["reservation_code"] = df["booking_reference"].fillna("").astype(str).str.strip()
    df = df[df["reservation_code"] != ""]
    
    df["check_in"] = pd.to_datetime(df.get("check_in_date"), errors="coerce")
    df["check_out"] = pd.to_datetime(df.get("check_out_date"), errors="coerce")
    df = df.dropna(subset=["check_in", "check_out"])

    today = pd.Timestamp(date.today())
    
    # Calculate length of stay (number of nights)
    df["nights"] = (df["check_out"] - df["check_in"]).dt.days

    # Rule 1: Short stays (<= 5 nights) -> Trigger link 2 days before check-in
    mask_short = (df["nights"] <= 5) & (today >= (df["check_in"] - pd.Timedelta(days=2)))
    
    # Rule 2: Long stays (> 5 nights) -> Trigger link 3 days before check-out
    mask_long = (df["nights"] > 5) & (today >= (df["check_out"] - pd.Timedelta(days=3)))
    
    # Safety check: Ensure the guest hasn't already checked out
    mask_active = today < df["check_out"]

    # Combine filters
    mask = (mask_short | mask_long) & mask_active
    df = df[mask].copy()

    bookings = []
    for ref, g in df.groupby("reservation_code"):
        first = g.iloc[0]
        
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

    processed_refs = load_stripe_logs()
    bookings = get_upcoming_bookings()
    
    if not bookings:
        print("ℹ️ No eligible upcoming bookings found in dropzone matching the timing rules.")
        return

    new_logs = []

    for b in bookings:
        ref = b["reservation_code"]
        if ref in processed_refs:
            continue  # Already generated a link for this booking

        print(f"\n💳 Generating Standard 7-Day £80 Hold Session for {ref} ({b['guest_name']})")
        
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
            
            processed_refs.add(ref)

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
