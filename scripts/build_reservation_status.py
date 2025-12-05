# scripts/build_reservation_status.py

import pandas as pd
import os

BOOKINGS = "automation-data/bookings.csv"
PAYMENTS = "automation-data/payments_log.csv"
TTLOG   = "automation-data/ttlock_log.csv"
OUTPUT  = "automation-data/reservation_status.csv"


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
    # NORMALISE BOOKINGS COLUMNS
    # -----------------------------
    bookings.rename(columns=lambda c: c.strip().lower().replace(" ", "_"), inplace=True)

    # Extract reservation reference (###-###-###)
    bookings["reservation_code"] = bookings["summary"].astype(str).str.extract(r"(\d{3}-\d{3}-\d{3})")

    # Detect channel bookings needing deposits
    bookings["needs_deposit"] = bookings["description"].str.contains(
        "guest.booking.com|expedia",
        case=False,
        na=False
    )

    # -----------------------------
    # PAYMENT STATUS
    # -----------------------------
    paid_refs = set(payments["ref"].astype(str).tolist()) if "ref" in payments else set()

    bookings["payment_received"] = bookings["reservation_code"].isin(paid_refs)

    bookings["outstanding_payment"] = bookings.apply(
        lambda r: r["needs_deposit"] and not r["payment_received"],
        axis=1
    )

    # -----------------------------
    # TTLOCK STATUS
    # -----------------------------
    done_refs = set(ttlog["reservation_code"].astype(str).tolist()) if "reservation_code" in ttlog else set()

    bookings["lock_set"] = bookings["reservation_code"].isin(done_refs)

    # -----------------------------
    # FINAL COLUMN ORDER
    # -----------------------------
    cols = [
        "reservation_code",
        "room",
        "location",
        "guest_name",
        "email_address",
        "dtstart_(check-in)",
        "dtend_(check-out)",
        "needs_deposit",
        "payment_received",
        "outstanding_payment",
        "lock_set",
        "description",
    ]

    final = bookings[[c for c in cols if c in bookings.columns]]

    # -----------------------------
    # WRITE OUTPUT CSV
    # -----------------------------
    final.to_csv(OUTPUT, index=False)
    print(f"✅ reservation_status.csv written to {OUTPUT}")


if __name__ == "__main__":
    main()
