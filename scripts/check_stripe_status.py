import os
import pandas as pd
import stripe

stripe.api_key = os.getenv("STRIPE_SECRET_KEY")
DATA_DIR = "automation-data"
LOG_FILE = f"{DATA_DIR}/stripe_deposit_log.csv"

def main():
    print("=== Stripe Status Checker Start ===")
    if not stripe.api_key:
        print("❌ STRIPE_SECRET_KEY not set in environment.")
        return

    if not os.path.exists(LOG_FILE):
        print("ℹ️ No stripe_deposit_log.csv found yet. Skipping.")
        return

    # Read the log as strings to prevent data mangling
    df = pd.read_csv(LOG_FILE, dtype=str)
    updated_count = 0

    for index, row in df.iterrows():
        status = str(row.get("status", ""))
        session_id = str(row.get("session_id", ""))
        ref = str(row.get("reservation_code", ""))
        
        # Only check links that haven't been finalized yet
        if status in ["link_generated", "hold_active"]:
            try:
                # Expand payment_intent to see if the hold is active, captured, or canceled
                session = stripe.checkout.Session.retrieve(session_id, expand=['payment_intent'])
                
                new_status = status # Default to current
                
                if session.status == "open":
                    pass # Guest hasn't paid yet
                
                elif session.status == "complete" and session.payment_intent:
                    pi_status = session.payment_intent.status
                    
                    if pi_status == "requires_capture":
                        new_status = "hold_active"
                    elif pi_status == "succeeded":
                        new_status = "captured"
                    elif pi_status == "canceled":
                        new_status = "released"
                        
                elif session.status == "expired":
                    new_status = "link_expired"

                # If the status changed, update the DataFrame
                if new_status != status:
                    df.at[index, "status"] = new_status
                    updated_count += 1
                    print(f"🔄 {ref}: Status changed from '{status}' to '{new_status}'")

            except Exception as e:
                print(f"⚠️ Error checking Stripe session for {ref}: {e}")

    if updated_count > 0:
        df.to_csv(LOG_FILE, index=False)
        print(f"✔ Saved {updated_count} updates to {LOG_FILE}")
    else:
        print("ℹ️ All existing links checked. No status changes detected.")
        
    print("=== Stripe Status Checker Complete ===")

if __name__ == "__main__":
    main()
