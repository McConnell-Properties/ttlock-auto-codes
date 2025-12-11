# scripts/build_reservation_status.py

import pandas as pd
from datetime import datetime, timedelta
import os

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
    except Exception:
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
    print("📑 Bookings columns after normalise:", list(bookings.columns))

    # After normalisation, from your example CSV we expect:
    #   room
    #   prodid
    #   version
    #   uid
    #   dtstamp
    #   dtstart_(check-in)
    #   dtend_(check-out)
    #   summary
    #   description
    #   sequence
    #   location
    #   guest_name
    #   email_address
    #   phone_number

    # Make explicit property_location / door_number for downstream use
    if "property_location" not in bookings and "location" in bookings:
        bookings["property_location"] = bookings["location"]
    if "door_number" not in bookings and "room" in bookings:
        bookings["door_number"] = bookings["room"]

    # -----------------------------
    # EXTRACT RESERVATION CODE (###-###-###)
    # -----------------------------
    print("🔍 Extracting reservation_code from summary…")
    if "summary" in bookings:
        bookings["reservation_code"] = bookings["summary"].astype(str).str.extract(
            r"(\d{3}-\d{3}-\d{3})"
        )
    else:
        bookings["reservation_code"] = pd.NA

    # -----------------------------
    # PAYMENT REQUIREMENT
    # -----------------------------
    print("🔍 Identifying Booking.com/Expedia reservations needing deposits…")
    if "description" in bookings:
        bookings["needs_deposit"] = bookings["description"].astype(str).str.contains(
            "booking.com|expedia", case=False, na=False
        )
    else:
        bookings["needs_deposit"] = False

    # -----------------------------
    # PARSE CHECK-IN / CHECK-OUT DATES
    # -----------------------------
    # We create standard 'check_in' / 'check_out' fields using your real columns
    # Priority order: existing check_in/check_out, then dtstart_(check-in)/dtend_(check-out)
    checkin_source = None
    checkout_source = None

    for candidate in ["check_in", "check-in_date", "dtstart_(check-in)"]:
        if candidate in bookings.columns:
            checkin_source = candidate
            break

    for candidate in ["check_out", "check-out_date", "dtend_(check-out)"]:
        if candidate in bookings.columns:
            checkout_source = candidate
            break

    print(f"⏱ Using '{checkin_source}' as check_in source")
    print(f"⏱ Using '{checkout_source}' as check_out source")

    if checkin_source:
        bookings["check_in"] = bookings[checkin_source].apply(parse_date)
    else:
        bookings["check_in"] = pd.NaT

    if checkout_source:
        bookings["check_out"] = bookings[checkout_source].apply(parse_date)
    else:
        bookings["check_out"] = pd.NaT

    # Quick debug: how many rows have valid date ranges?
    print(
        "📊 Non-NaT counts:",
        "check_in =", bookings["check_in"].notna().sum(),
        "check_out =", bookings["check_out"].notna().sum(),
    )

    today = datetime.utcnow().replace(tzinfo=None)
    cutoff = today + timedelta(days=30)

    # Because check_in / check_out are timezone-aware, compare on .dt.tz_convert(None)
    check_in_naive = bookings["check_in"].dt.tz_convert(None)
    check_out_naive = bookings["check_out"].dt.tz_convert(None)

    # -----------------------------
    # FILTER VALID BOOKINGS
    # -----------------------------
    valid_mask = (check_out_naive >= today) & (check_in_naive <= cutoff)
    valid = bookings[valid_mask].copy()

    print(f"➡ {len(valid)} valid upcoming/current reservations found (within next 30 days).")

    # -----------------------------
    # PAYMENT STATUS
    # -----------------------------
    paid_refs = set(payments["ref"].astype(str)) if "ref" in payments else set()
    valid["payment_received"] = valid["reservation_code"].astype(str).isin(paid_refs)

    valid["outstanding_payment"] = valid.apply(
        lambda r: bool(r.get("needs_deposit", False)) and not bool(r.get("payment_received", False)),
        axis=1,
    )

    # -----------------------------
    # TTLOCK STATUS
    # -----------------------------
    done_refs = set(ttlog["reservation_code"].astype(str)) if "reservation_code" in ttlog else set()
    valid["lock_set"] = valid["reservation_code"].astype(str).isin(done_refs)

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
    print(f"📦 Rows in reservation_status.csv: {len(final)}")


if __name__ == "__main__":
    main()
