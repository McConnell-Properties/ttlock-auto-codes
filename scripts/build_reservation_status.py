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


# -----------------------------
# Extract platform email from DESCRIPTION
# -----------------------------
def extract_platform_email(desc):
    if not isinstance(desc, str):
        return None
    match = re.search(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", desc)
    return match.group(0) if match else None


# -----------------------------
# Combine multiple rows for the same reservation
# -----------------------------
def combine_rows(group):
    row = group.iloc[0].copy()

    # guest email (first non-null)
    if "email_address" in group:
        emails = group["email_address"].dropna().unique()
        row["email_address"] = emails[0] if len(emails) > 0 else None

    # platform email (from description)
    descs = group["description"].dropna().astype(str).tolist()
    platform_emails = [extract_platform_email(d) for d in descs]
    platform_emails = [e for e in platform_emails if e]

    row["platform_email"] = platform_emails[0] if platform_emails else None

    return row


def main():

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

    rename_map = {
        "dtstart_(check-in)": "check_in",
        "dtend_(check-out)": "check_out",
        "email": "email_address",
    }
    bookings.rename(columns=rename_map, inplace=True)

    # -----------------------------
    # Extract reservation code from SUMMARY
    # -----------------------------
    print("🔍 Extracting reservation_code…")
    bookings["reservation_code"] = bookings["summary"].astype(str).str.extract(r"(\d{3}-\d{3}-\d{3})")

    # -----------------------------
    # Identify platform bookings needing deposit
    # -----------------------------
    bookings["needs_deposit"] = bookings["description"].astype(str).str.contains(
        "booking.com|expedia", case=False, na=False
    )

    # -----------------------------
    # Parse dates
    # -----------------------------
    if "check_in" in bookings:
        bookings["check_in"] = bookings["check_in"].apply(parse_date)
    if "check_out" in bookings:
        bookings["check_out"] = bookings["check_out"].apply(parse_date)

    # -----------------------------
    # Payment status
    # -----------------------------
    paid_refs = set(payments["ref"].astype(str)) if "ref" in payments else set()
    bookings["payment_received"] = bookings["reservation_code"].isin(paid_refs)

    bookings["outstanding_payment"] = bookings.apply(
        lambda r: r["needs_deposit"] and not r["payment_received"],
        axis=1
    )

    # -----------------------------
    # TTLock status
    # -----------------------------
    done_refs = set(ttlog["reservation_code"].astype(str)) if "reservation_code" in ttlog else set()
    bookings["lock_set"] = bookings["reservation_code"].isin(done_refs)

    # -----------------------------
    # COMBINE MULTIPLE ROWS PER RESERVATION
    # -----------------------------
    print("🔄 Deduplicating reservations…")

    final = (
        bookings
        .groupby("reservation_code", dropna=True)
        .apply(combine_rows)
        .reset_index(drop=True)
    )

    # -----------------------------
    # WRITE OUTPUT
    # -----------------------------
    final.to_csv(OUTPUT, index=False)
    print(f"✅ reservation_status.csv written to {OUTPUT}")
    print(f"📊 {len(final)} combined reservations written.")


if __name__ == "__main__":
    main()
