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

    # Standardise known columns
    rename_map = {
        "email": "email_address",
        "check-in_(check-in)": "check_in",
        "check-out_(check-out)": "check_out",
        "dtstart_(check-in)": "check_in",
        "dtend_(check-out)": "check_out",
    }
    bookings.rename(columns=rename_map, inplace=True)


    # -----------------------------
    # EXTRACT RESERVATION CODE FROM SUMMARY (###-###-###)
    # -----------------------------
    print("🔍 Extracting reservation_code from summary…")
    bookings["summary"] = bookings["summary"].astype(str)
    bookings["reservation_code"] = bookings["summary"].str.extract(r"(\d{3}-\d{3}-\d{3})")


    # -----------------------------
    # PARSE DATES (BUT NO FILTERING!)
    # -----------------------------
    bookings["check_in"]  = bookings["check_in"].apply(parse_date)
    bookings["check_out"] = bookings["check_out"].apply(parse_date)


    # -----------------------------
    # PAYMENT REQUIREMENT
    # -----------------------------
    print("🔍 Identifying Booking.com/Expedia reservations needing deposits…")
    bookings["description"] = bookings["description"].astype(str)
    bookings["needs_deposit"] = bookings["description"].str.contains(
        "booking.com|expedia", case=False, na=False
    )


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
    # FINAL COLUMNS
    # -----------------------------
    cols = [
        "reservation_code",
        "room",
        "location",
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

    final = bookings[[c for c in cols if c in bookings.columns]].copy()


    # -----------------------------
    # WRITE OUTPUT
    # -----------------------------
    final.to_csv(OUTPUT, index=False)
    print(f"✅ reservation_status.csv written to {OUTPUT}")
    print(f"📊 {len(final)} total reservations included (no filtering).")


if __name__ == "__main__":
    main()
