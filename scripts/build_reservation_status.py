# scripts/build_reservation_status.py

import pandas as pd
from datetime import datetime, timedelta
import os
import re

BOOKINGS = "automation-data/bookings.csv"
PAYMENTS = "automation-data/payments_log.csv"
TTLOG   = "automation-data/ttlock_log.csv"
OUTPUT  = "automation-data/reservation_status.csv"

# -----------------------------
# Parse date safely
# -----------------------------
def parse_date(x):
    try:
        return pd.to_datetime(x, utc=True, dayfirst=False)
    except:
        return pd.NaT


def main():

    # -----------------------------
    # LOAD INPUT FILES
    # -----------------------------
    print("📄 Loading bookings.csv…")
    bookings = pd.read_csv(BOOKINGS)

    print("📄 Loading payments_log.csv…")
    payments = pd.read_csv(PAYMENTS) if os.path.exists(PAYMENTS) else pd.DataFrame(columns=["ref"])

    print("📄 Loading ttlock_log.csv…")
    ttlog = pd.read_csv(TTLOG) if os.path.exists(TTLOG) else pd.DataFrame(columns=["reservation_code"])


    # -----------------------------
    # NORMALISE COLUMN NAMES
    # -----------------------------
    bookings.rename(columns=lambda c: c.strip().lower().replace(" ", "_"), inplace=True)

    # Your actual date columns AFTER normalisation:
    #   dtstart_(check-in)
    #   dtend_(check-out)
    #
    # We map them to usable standard names:
    bookings = bookings.rename(columns={
        "dtstart_(check-in)": "check_in",
        "dtend_(check-out)": "check_out",
        "email_address": "email_address",  # already good
        "guest_name": "guest_name",        # already good
        "location": "property_location",   # optional rename
        "room": "door_number",
    })

    # -----------------------------
    # EXTRACT RESERVATION CODE (###-###-###)
    # -----------------------------
    print("🔍 Extracting reservation_code from summary…")
    bookings["reservation_code"] = bookings["summary"].astype(str).str.extract(r"(\d{3}-\d{3}-\d{3})")


    # -----------------------------
    # PAYMENT REQUIREMENT
    # -----------------------------
    print("🔍 Identifying Booking.com/Expedia reservations needing deposits…")
    bookings["needs_deposit"] = bookings["description"].astype(str).str.contains(
        "booking.com|expedia", case=False, na=False
    )


    # -----------------------------
    # PARSE CHECK-IN / CHECK-OUT DATES
    # -----------------------------
    bookings["check_in"]  = bookings["check_in"].apply(parse_date)
    bookings["check_out"] = bookings["check_out"].apply(parse_date)


    today = datetime.utcnow()
    cutoff = today + timedelta(days=30)

    # -----------------------------
    # FILTER VALID BOOKINGS
    # -----------------------------
    valid = bookings[
        (bookings["check_out"] >= today) &
        (bookings["check_in"] <= cutoff)
    ].copy()

    print(f"➡ {len(valid)} valid upcoming/current reservations found.")


    # -----------------------------
    # PAYMENT STATUS
    # -----------------------------
    paid_refs = set(payments["ref"].astype(str)) if "ref" in payments else set()
    valid["payment_received"] = valid["reservation_code"].isin(paid_refs)

    valid["outstanding_payment"] = valid.apply(
        lambda r: r["needs_deposit"] and not r["payment_received"],
        axis=1
    )


    # -----------------------------
    # TTLOCK STATUS
    # -----------------------------
    done_refs = set(ttlog["reservation_code"].astype(str)) if "reservation_code" in ttlog else set()
    valid["lock_set"] = valid["reservation_code"].isin(done_refs)


    # -----------------------------
    # OUTPUT COLUMNS
    # -----------------------------
    cols = [
        "reservation_code",
        "property_location",
        "door_number",
        "guest_name",
        "email_address",
        "check_in",
        "check_out",
        "needs_deposit",
        "payment_received",
        "outstanding_payment",
        "lock_set",
        "description",
    ]

    final = valid[[c for c in cols if c in valid.columns]].copy()


    # -----------------------------
    # WRITE OUTPUT
    # -----------------------------
    final.to_csv(OUTPUT, index=False)
    print(f"✅ reservation_status.csv written to {OUTPUT}")


if __name__ == "__main__":
    main()
