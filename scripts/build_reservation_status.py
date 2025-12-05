# scripts/build_reservation_status.py

import pandas as pd
from datetime import datetime, timedelta
import os

BOOKINGS = "automation-data/bookings.csv"
PAYMENTS = "automation-data/payments_log.csv"
TTLOG   = "automation-data/ttlock_log.csv"
OUTPUT  = "automation-data/reservation_status.csv"

def parse_weird_date(x):
    """
    Converts dates like:
    'Fri Dec 05 2025 00:00:00 GMT+0000 (Greenwich Mean Time)'
    into a real datetime.
    """
    try:
        return pd.to_datetime(x, utc=True)
    except:
        try:
            # Remove the timezone description in brackets
            cleaned = str(x).split("(")[0].strip()
            return pd.to_datetime(cleaned, utc=True)
        except:
            return pd.NaT

def main():

    print("📄 Loading bookings.csv…")
    bookings = pd.read_csv(BOOKINGS)

    print("📄 Loading payments_log.csv…")
    payments = pd.read_csv(PAYMENTS) if os.path.exists(PAYMENTS) else pd.DataFrame(columns=["ref"])

    print("📄 Loading ttlock_log.csv…")
    ttlog = pd.read_csv(TTLOG) if os.path.exists(TTLOG) else pd.DataFrame(columns=["reservation_code"])


    # -----------------------------------------
    # NORMALISE BOOKINGS CSV HEADERS
    # -----------------------------------------
    bookings.rename(columns=lambda c: c.strip().lower().replace(" ", "_"), inplace=True)

    # SUMMARY → extract ###-###-### reference
    bookings["reservation_code"] = bookings["summary"].astype(str).str.extract(r"(\d{3}-\d{3}-\d{3})")

    # detect booking.com / expedia
    bookings["needs_deposit"] = bookings["description"].str.contains(
        "guest.booking.com|expedia", case=False, na=False
    )

    # Parse your weird date format
    bookings["check_in"]  = bookings["dtstart_(check-in)"].apply(parse_weird_date)
    bookings["check_out"] = bookings["dtend_(check-out)"].apply(parse_weird_date)

    # -----------------------------------------
    # DATE FILTER
    # -----------------------------------------
    now = datetime.utcnow().replace(tzinfo=pd.Timestamp.utcnow().tz)
    cutoff = now + timedelta(days=30)

    valid = bookings[
        (bookings["check_out"] >= now) &
        (bookings["check_in"] <= cutoff)
    ].copy()

    print(f"➡ {len(valid)} active reservations found.")

    # -----------------------------------------
    # PAYMENT STATUS
    # -----------------------------------------
    paid_refs = set(payments["ref"].astype(str)) if "ref" in payments else set()
    valid["payment_received"] = valid["reservation_code"].isin(paid_refs)

    valid["outstanding_payment"] = valid.apply(
        lambda r: r["needs_deposit"] and not r["payment_received"],
        axis=1
    )

    # -----------------------------------------
    # TTLOCK STATUS
    # -----------------------------------------
    done_refs = set(ttlog["reservation_code"].astype(str)) if "reservation_code" in ttlog else set()
    valid["lock_set"] = valid["reservation_code"].isin(done_refs)

    # -----------------------------------------
    # FINAL STRUCTURE
    # -----------------------------------------
    cols = [
        "reservation_code",
        "room",
        "location",
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

    final = valid[[c for c in cols if c in valid.columns]]

    final.to_csv(OUTPUT, index=False)
    print(f"✅ reservation_status.csv written to {OUTPUT}")


if __name__ == "__main__":
    main()
