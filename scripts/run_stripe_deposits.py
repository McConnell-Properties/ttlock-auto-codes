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
    """Find bookings checking in within the next 2 days."""
    all_csvs = [f for f in glob.glob(f"{DATA_DIR}/**/*.csv", recursive=True) 
                if not f.endswith("ttlock_log.csv") and not f.endswith("reservation_status.csv") and not f.endswith("stripe_deposit_log.csv")]

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
    df.columns = [c.strip() for c in df.columns]

    if "Booking reference" not in df.columns:
        return []

    df["reservation_code"] = df["Booking reference"].fillna("").astype(str).str.strip()
    df = df[df["reservation_code"] != ""]
    
    df["check_in"] = pd.to_datetime(df["Check in date"], errors="coerce")
    df = df.dropna(subset=["check_in"])

    today = pd.Timestamp(date.today())
    target_date = today + timedelta(days=2)

    # Filter: Check-in is on or before 2 days from now (and hasn't been cancelled in our view)
    mask = df["check_in"] <= target_date
    df = df[mask].copy()

    bookings = []
    for ref, g in df.groupby("reservation_code"):
        first = g.iloc[0]
        
        fname = str(first.get("Guest first name", "")).strip()
        lname = str(first.get("Guest last name", "")).strip()
        guest = f"{fname} {lname}".strip().replace("nan", "")
        email = str(first.get("Guest email", "")).strip()
        
        bookings.append({
            "reservation_code": ref,
            "guest_name": guest,
            "guest_email": email if email.lower() != "nan" else None,
            "property_location": first.get("Property name", ""),
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
        print("ℹ️ No eligible upcoming bookings found.")
        return

    new_logs = []

    for b in bookings:
        ref = b["reservation_code"]
        if ref in processed_refs:
            continue  # Already generated a link for this booking

        print(f"\n💳 Generating £80 Deposit Session for {ref} ({b['guest_name']})")
        
        try:
            # Create a Stripe Checkout Session for the Pre-Auth
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
                    'capture_method': 'manual', # THIS MAKES IT A HOLD, NOT A CHARGE
                    'payment_method_options': {
                        'card': {
                            'request_extended_authorization': 'true' # OPTION B: 30-DAY HOLD
                        }
                    }
                },
                # Placeholder URLs until you have a real website to send them back to
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
