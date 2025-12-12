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

    # Check-in/out
    cis = group["check_in"].dropna()
    if len(cis) > 0:
        row["check_in"] = cis.iloc[0]

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

    # IMPORTANT: after normalization, headers look like:
    # "DTSTART (Check-in)"  -> "dtstart_(check_in)"
    # "DTEND (Check-out)"   -> "dtend_(check_out)"
    rename_map = {
        "dtstart_(check_in)": "check_in",
        "dtend_(check_out)": "check_out",
        "email": "email_address",
    }
    bookings.rename(columns=rename_map, inplace=True)

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
    # Parse dates
    # -----------------------------
    bookings["check_in"] = bookings["check_in"].apply(parse_date)
    bookings["check_out"] = bookings["check_out"].apply(parse_date)

    # -----------------------------
    # TTLock: derive front/room lock flags
    # -----------------------------
    print("🔐 Processing TTLock status…")

    # Normalize ttlog headers too
    ttlog.rename(columns=lambda c: c.strip().lower().replace(" ", "_"), inplace=True)

    bookings["front_door_lock_set"] = False
    bookings["room_lock_set"] = False

    if not ttlog.empty:
        # Front door lock
        front = ttlog[(ttlog["lock_type"] == "front_door")]

        # Room lock
        room = ttlog[(ttlog["lock_type"] == "room")]

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

    # Keep TTLock flags after grouping
    final["front_door_lock_set"] = final["reservation_code"].isin(
        bookings[bookings["front_door_lock_set"] == True]["reservation_code"]
    )
    final["room_lock_set"] = final["reservation_code"].isin(
        bookings[bookings["room_lock_set"] == True]["reservation_code"]
    )

    # Rename date fields to match original booking headers
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
