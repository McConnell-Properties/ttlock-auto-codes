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
        return pd.to_datetime(x, utc=True)
    except:
        return pd.NaT


# -----------------------------
# Extract platform email
# -----------------------------
def extract_platform_email(desc):
    if not isinstance(desc, str):
        return None
    match = re.search(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", desc)
    return match.group(0) if match else None


# -----------------------------
# Combine multiple bookings rows
# -----------------------------
def combine_rows(group):
    row = group.iloc[0].copy()

    # Email
    emails = group["email_address"].dropna().unique()
    row["email_address"] = emails[0] if len(emails) > 0 else None

    # Platform email
    descs = group["description"].dropna().astype(str).tolist()
    platform_emails = [extract_platform_email(d) for d in descs]
    platform_emails = [e for e in platform_emails if e]
    row["platform_email"] = platform_emails[0] if platform_emails else None

    # Check-in/out (defensive)
    if "check_in" in group:
        cis = group["check_in"].dropna()
        if len(cis) > 0:
            row["check_in"] = cis.iloc[0]

    if "check_out" in group:
        cos = group["check_out"].dropna()
        if len(cos) > 0:
            row["check_out"] = cos.iloc[0]

    return row


def main():

    print("📄 Loading bookings.csv…")
    bookings = pd.read_csv(BOOKINGS)

    print("📄 Loading payments_log.csv…")
    payments = pd.read_csv(PAYMENTS) if os.path.exists(PAYMENTS) else pd.DataFrame(columns=["ref"])

    print("📄 Loading ttlock_log.csv…")
    ttlog = pd.read_csv(TTLOG) if os.path.exists(TTLOG) else pd.DataFrame(columns=["reservation_code"])

    # -----------------------------
    # Normalize booking headers
    # -----------------------------
    bookings.rename(columns=lambda c: c.strip().lower().replace(" ", "_"), inplace=True)

    # 🔧 FIX: rename ONLY if the normalized columns exist
    if "dtstart_(check_in)" in bookings.columns:
        bookings.rename(columns={"dtstart_(check_in)": "check_in"}, inplace=True)

    if "dtend_(check_out)" in bookings.columns:
        bookings.rename(columns={"dtend_(check_out)": "check_out"}, inplace=True)

    if "email" in bookings.columns:
        bookings.rename(columns={"email": "email_address"}, inplace=True)

    # -----------------------------
    # Extract reservation code
    # -----------------------------
    print("🔍 Extracting reservation_code…")
    bookings["reservation_code"] = bookings["summary"].astype(str).str.extract(r"(\d{3}-\d{3}-\d{3})")

    # -----------------------------
    # Deposit & Payment Status
    # -----------------------------
    bookings["needs_deposit"] = bookings["description"].astype(str).str.contains(
        "booking.com|expedia", case=False, na=False
    )

    paid_refs = set(payments["ref"].astype(str)) if "ref" in payments else set()
    bookings["payment_received"] = bookings["reservation_code"].isin(paid_refs)

    bookings["outstanding_payment"] = bookings.apply(
        lambda r: r["needs_deposit"] and not r["payment_received"],
        axis=1
    )

    # -----------------------------
    # 🔧 FIX: Parse dates ONLY if columns exist
    # -----------------------------
    if "check_in" in bookings.columns:
        bookings["check_in"] = bookings["check_in"].apply(parse_date)

    if "check_out" in bookings.columns:
        bookings["check_out"] = bookings["check_out"].apply(parse_date)

    # -----------------------------
    # TTLock: derive front/room lock flags
    # -----------------------------
    print("🔐 Processing TTLock status…")

    ttlog.rename(columns=lambda c: c.strip().lower().replace(" ", "_"), inplace=True)

    bookings["front_door_lock_set"] = False
    bookings["room_lock_set"] = False

    if not ttlog.empty:
        front = ttlog[ttlog["lock_type"] == "front_door"]
        room = ttlog[ttlog["lock_type"] == "room"]

        bookings.loc[
            bookings["reservation_code"].isin(front["reservation_code"]),
            "front_door_lock_set"
        ] = True

        bookings.loc[
            bookings["reservation_code"].isin(room["reservation_code"]),
            "room_lock_set"
        ] = True

    # -----------------------------
    # Combine per reservation
    # -----------------------------
    print("🔄 Deduplicating reservations…")
    final = (
        bookings.groupby("reservation_code", dropna=True)
        .apply(combine_rows)
        .reset_index(drop=True)
    )

    # Preserve TTLock flags
    final["front_door_lock_set"] = final["reservation_code"].isin(
        bookings.loc[bookings["front_door_lock_set"], "reservation_code"]
    )

    final["room_lock_set"] = final["reservation_code"].isin(
        bookings.loc[bookings["room_lock_set"], "reservation_code"]
    )

    # -----------------------------
    # Rename dates back to original headers
    # -----------------------------
    final.rename(columns={
        "check_in": "DTSTART (Check-in)",
        "check_out": "DTEND (Check-out)",
    }, inplace=True)

    # -----------------------------
    # Write output
    # -----------------------------
    final.to_csv(OUTPUT, index=False)

    print(f"✅ reservation_status.csv written to {OUTPUT}")
    print(f"📊 {len(final)} combined reservations written.")


if __name__ == "__main__":
    main()
