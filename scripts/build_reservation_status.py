# scripts/build_reservation_status.py
import pandas as pd
from datetime import datetime
import os
import re

BOOKINGS = "automation-data/bookings.csv"
PAYMENTS = "automation-data/payments_log.csv"
TTLOG   = "automation-data/ttlock_log.csv"
OUTPUT  = "automation-data/reservation_status.csv"

# -----------------------------
# Extract platform email from DESCRIPTION
# -----------------------------
def extract_platform_email(desc):
    if not isinstance(desc, str):
        return None
    # Booking.com / Expedia emails inside description
    match = re.search(r"[\w\.-]+@(guest\.booking\.com|expedia\.com)", desc, re.I)
    return match.group(0) if match else None


def main():

    print("📄 Loading bookings.csv…")
    bookings = pd.read_csv(BOOKINGS)

    print("📄 Loading payments_log.csv…")
    payments = pd.read_csv(PAYMENTS) if os.path.exists(PAYMENTS) else pd.DataFrame(columns=["ref"])

    print("📄 Loading ttlock_log.csv…")
    ttlog = pd.read_csv(TTLOG) if os.path.exists(TTLOG) else pd.DataFrame(columns=["reservation_code"])


    # -----------------------------
    # NORMALISE COLUMNS
    # -----------------------------
    bookings.rename(columns=lambda c: c.strip().lower().replace(" ", "_"), inplace=True)

    # Reservation codes
    bookings["reservation_code"] = bookings["summary"].astype(str).str.extract(r"(\d{3}-\d{3}-\d{3})")

    # Extract platform email from description
    bookings["platform_email"] = bookings["description"].apply(extract_platform_email)

    # Deposit requirement
    bookings["needs_deposit"] = bookings["description"].astype(str).str.contains(
        "booking.com|expedia", case=False, na=False
    )

    # -----------------------------
    # DATE FIELDS (keep raw)
    # -----------------------------
    # Do NOT filter — you requested full reservation list
    # Just keep check-in / check-out as strings
    if "dtstart_(check-in)" in bookings:
        bookings["check_in"] = bookings["dtstart_(check-in)"]
    if "dtend_(check-out)" in bookings:
        bookings["check_out"] = bookings["dtend_(check-out)"]

    # -----------------------------
    # PAYMENT STATUS
    # -----------------------------
    paid_refs = set(payments["ref"].astype(str)) if "ref" in payments else set()
    bookings["payment_received"] = bookings["reservation_code"].isin(paid_refs)

    bookings["outstanding_payment"] = bookings.apply(
        lambda r: r["needs_deposit"] and not r["payment_received"],
        axis=1
    )

    # -----------------------------
    # TTLOCK STATUS
    # -----------------------------
    done_refs = set(ttlog["reservation_code"].astype(str)) if "reservation_code" in ttlog else set()
    bookings["lock_set"] = bookings["reservation_code"].isin(done_refs)


    # -----------------------------
    # MERGE DUPLICATES BY reservation_code
    # -----------------------------
    print("🔄 Deduplicating reservations…")

    def combine_rows(group):
        # Prefer Airbnb email if present
        email = group["email_address"].dropna().iloc[0] if "email_address" in group else None
        platform_email = group["platform_email"].dropna().iloc[0] if group["platform_email"].notna().any() else None

        return pd.Series({
            "reservation_code": group["reservation_code"].iloc[0],
            "property_location": group["location"].dropna().iloc[0] if "location" in group else None,
            "door_number": group["room"].dropna().iloc[0] if "room" in group else None,
            "guest_name": group["guest_name"].dropna().iloc[0] if "guest_name" in group else None,
            "email_address": email,
            "platform_email": platform_email,
            "check_in": group["check_in"].dropna().iloc[0] if group["check_in"].notna().any() else None,
            "check_out": group["check_out"].dropna().iloc[0] if group["check_out"].notna().any() else None,
            "needs_deposit": group["needs_deposit"].any(),
            "payment_received": group["payment_received"].any(),
            "outstanding_payment": group["outstanding_payment"].any(),
            "lock_set": group["lock_set"].any(),
            "description": group["description"].iloc[0],
        })

    final = bookings.groupby("reservation_code", dropna=True).apply(combine_rows).reset_index(drop=True)


    # -----------------------------
    # SAVE OUTPUT
    # -----------------------------
    final.to_csv(OUTPUT, index=False)
    print(f"✅ reservation_status.csv written to {OUTPUT}")
    print(f"📊 {len(final)} unique reservations included.")


if __name__ == "__main__":
    main()
