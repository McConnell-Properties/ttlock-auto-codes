# scripts/build_combined_csv.py

import pandas as pd
from datetime import datetime, timedelta
import os

BOOKINGS = "automation-data/bookings.csv"
PAYMENTS = "automation-data/payments_log.csv"
TTLOG   = "automation-data/ttlock_log.csv"
OUTPUT  = "automation-data/reservation_status.csv"

def parse_date(x):
    try:
        return pd.to_datetime(x, utc=True)
    except:
        return pd.NaT


def main():

    # -----------------------------
    # LOAD INPUTS
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

    # Extract reservation ref (###-###-###)
    bookings["reservation_code"] = bookings["summary"].astype(str).str.extract(r"(\d{3}-\d{3}-\d{3})")

    # Booking.com / Expedia detection
    bookings["needs_deposit"] = bookings["description"].str.contains(
        "guest.booking.com|expedia", case=False, na=False
    )

    # Convert dates
    bookings["check_in"]  = bookings["dtstart_(check-in)"].apply(parse_date)
    bookings["check_out"] = bookings["dtend_(check-out)"].apply(parse_date)

    today = datetime.utcnow()
    cutoff = today + timedelta(days=30)

    # -----------------------------
    # ALWAYS INCLUDE ALL RELEVANT RESERVATIONS
    # -----------------------------
    valid = bookings[
        (bookings["check_out"] >= today) &
        (bookings["check_in"] <= cutoff)
    ].copy()

    print(f"➡ {len(valid)} relevant reservations found.")


    # -----------------------------
    # PAYMENT STATUS
    # -----------------------------
    paid_refs = set(payments["ref"].astype(str).unique()) if "ref" in payments else set()

    valid["payment_received"] = valid["reservation_code"].isin(paid_refs)
    valid["outstanding_payment"] = valid.apply(
        lambda r: r["needs_deposit"] and not r["payment_received"],
        axis=1
    )


    # -----------------------------
    # TTLOCK STATUS
    # -----------------------------
    done_refs = set(ttlog["reservation_code"].astype(str).unique()) if "reservation_code" in ttlog else set()
    valid["lock_set"] = valid["reservation_code"].isin(done_refs)


    # -----------------------------
    # FINAL COLUMNS
    # -----------------------------
    cols = [
        "reservation_code",
        "room",
        "location",
        "guest_name",
        "email_address",
        "phone_number",
        "check_in",
        "check_out",
        "needs_deposit",
        "payment_received",
        "outstanding_payment",
        "lock_set",
        "description",
    ]

    final = valid[[c for c in cols if c in valid.columns]].copy()

    # Sort for readability
    final = final.sort_values("check_in")


    # -----------------------------
    # WRITE OUTPUT CSV
    # -----------------------------
    final.to_csv(OUTPUT, index=False)
    print(f"✅ reservation_status.csv written with {len(final)} rows → {OUTPUT}")


if __name__ == "__main__":
    main()
