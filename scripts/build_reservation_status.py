# scripts/build_reservation_status.py

import pandas as pd
from datetime import datetime, timedelta
import os
import re

BOOKINGS = "automation-data/bookings.csv"
PAYMENTS = "automation-data/payments_log.csv"
TTLOG   = "automation-data/ttlock_log.csv"
OUTPUT  = "automation-data/reservation_status.csv"


# ----------------------------------------------------
# Safe date parser
# ----------------------------------------------------
def parse_date(x):
    try:
        return pd.to_datetime(x, utc=True)
    except:
        return pd.NaT


def main():

    print("📄 Loading bookings.csv…")
    bookings = pd.read_csv(BOOKINGS)

    print("📄 Loading payments_log.csv…")
    payments = pd.read_csv(PAYMENTS) if os.path.exists(PAYMENTS) else pd.DataFrame(columns=["ref"])

    print("📄 Loading ttlock_log.csv…")
    ttlog = pd.read_csv(TTLOG) if os.path.exists(TTLOG) else pd.DataFrame(columns=["reservation_code"])


    # ----------------------------------------------------
    # STANDARDISE COLUMNS
    # ----------------------------------------------------
    bookings.rename(columns=lambda c: c.strip().lower().replace(" ", "_"), inplace=True)

    # Map actual CSV fields → expected names
    col_map = {
        "dtstart_(check-in)": "check_in",
        "dtend_(check-out)": "check_out",
        "email_address": "email_address",
        "guest_name": "guest_name",
        "location": "property_location",
        "room": "door_number"
    }
    bookings.rename(columns=col_map, inplace=True)

    # ----------------------------------------------------
    # EXTRACT RESERVATION CODE
    # ----------------------------------------------------
    bookings["reservation_code"] = bookings["summary"].astype(str).str.extract(r"(\d{3}-\d{3}-\d{3})")


    # ----------------------------------------------------
    # PLATFORM DEPOSIT RULE
    # ----------------------------------------------------
    bookings["needs_deposit"] = bookings["description"].astype(str).str.contains(
        "booking.com|expedia", case=False, na=False
    )


    # ----------------------------------------------------
    # PARSE DATES
    # ----------------------------------------------------
    bookings["check_in"] = bookings["check_in"].apply(parse_date)
    bookings["check_out"] = bookings["check_out"].apply(parse_date)

    today = datetime.utcnow()
    cutoff = today + timedelta(days=30)

    valid = bookings[
        (bookings["check_out"] >= today) &
        (bookings["check_in"] <= cutoff)
    ].copy()

    print(f"➡ {len(valid)} valid bookings inside 30-day window.")


    # ----------------------------------------------------
    # PAYMENT STATUS
    # ----------------------------------------------------
    paid_refs = set(payments["ref"].astype(str)) if "ref" in payments else set()

    valid["payment_received"] = valid["reservation_code"].isin(paid_refs)

    valid["outstanding_payment"] = valid.apply(
        lambda r: r["needs_deposit"] and not r["payment_received"],
        axis=1
    )


    # ----------------------------------------------------
    # TTLOCK STATUS
    # ----------------------------------------------------
    done_refs = set(ttlog["reservation_code"].astype(str)) if "reservation_code" in ttlog else set()
    valid["lock_set"] = valid["reservation_code"].isin(done_refs)


    # ----------------------------------------------------
    # OUTPUT COLUMNS
    # ----------------------------------------------------
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
        "description"
    ]

    final = valid[[c for c in cols if c in valid.columns]].copy()

    final.to_csv(OUTPUT, index=False)
    print(f"✅ reservation_status.csv written to {OUTPUT}")


if __name__ == "__main__":
    main()
