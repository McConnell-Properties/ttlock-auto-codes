import os
import csv
import re
from datetime import datetime, date, timedelta

import pandas as pd

import multi_property_lock_codes as tt

BOOKINGS_PATH = "automation-data/bookings.csv"
PAYMENTS_PATH = "automation-data/payments_log.csv"
TTLOCK_LOG_PATH = "automation-data/ttlock_log.csv"

# Define headers globally to ensure consistency
LOG_FIELDNAMES = [
    "timestamp",
    "reservation_code",
    "guest_name",
    "property_location",
    "door_number",
    "lock_type",
    "code_created",
    "ttlock_response",
]


def clean_date_str(s: str) -> str:
    """
    Clean the JS-style date string coming from Google Sheets CSV.
    """
    if not isinstance(s, str):
        return s
    return s.replace(" GMT+0000 (Greenwich Mean Time)", "")


def load_paid_refs():
    """
    Load reservation codes that have a payment/pre-auth recorded.
    """
    paid = set()

    if not os.path.exists(PAYMENTS_PATH):
        print("ℹ️ payments_log.csv not found – treating all NON-platform bookings as allowed, "
              "and platform bookings as unpaid.")
        return paid

    with open(PAYMENTS_PATH, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            ref = (row.get("reservation_code") or row.get("Reservation Code") or "").strip()
            if ref:
                paid.add(ref)

    print(f"✔ Loaded {len(paid)} paid/pre-auth reservation refs from {PAYMENTS_PATH}")
    return paid


def load_completed_locks():
    """
    Load a map of which locks have successfully been created for each reservation.
    Structure: { 'reservation_ref': {'front_door', 'room'} }
    Only includes entries where code_created == 'yes'.
    """
    completed = {}

    if not os.path.exists(TTLOCK_LOG_PATH):
        print("ℹ️ No ttlock_log.csv yet – treating this as first run.")
        return completed

    with open(TTLOCK_LOG_PATH, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            ref = (row.get("reservation_code") or row.get("Reservation Code") or "").strip()
            status = row.get("code_created")
            lock_type = row.get("lock_type")

            # Only track successful creations
            if ref and status == "yes" and lock_type:
                if ref not in completed:
                    completed[ref] = set()
                completed[ref].add(lock_type)

    print(f"✔ Loaded completion status for {len(completed)} reservations.")
    return completed


def append_log_entry(entry: dict):
    """
    Immediately append a single entry to the log file.
    """
    file_exists = os.path.isfile(TTLOCK_LOG_PATH)
    
    # Ensure directory exists
    os.makedirs(os.path.dirname(TTLOCK_LOG_PATH), exist_ok=True)

    with open(TTLOCK_LOG_PATH, "a", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=LOG_FIELDNAMES)
        if not file_exists:
            writer.writeheader()
        writer.writerow(entry)


def aggregate_bookings():
    """
    Load bookings.csv, apply date filters, merge duplicate rows per reservation_code,
    and return a list of "booking" dicts ready for TTLock logic.
    """
    if not os.path.exists(BOOKINGS_PATH):
        print(f"⚠️ {BOOKINGS_PATH} not found – aborting TTLock step.")
        return []

    df = pd.read_csv(BOOKINGS_PATH, dtype=str)
    df.columns = [c.strip() for c in df.columns]

    # ---- Extract reservation_code ----
    def extract_ref(summary):
        if not isinstance(summary, str):
            return ""
        m = re.search(r"(\d{3}-\d{3}-\d{3})", summary)
        return m.group(1) if m else ""

    df["reservation_code"] = df["SUMMARY"].apply(extract_ref)
    df = df[df["reservation_code"] != ""].copy()

    if df.empty:
        print("ℹ️ No rows in bookings.csv with a reservation reference.")
        return []

    # ---- Parse dates & apply 30-day window ----
    df["check_in"] = pd.to_datetime(
        df["DTSTART (Check-in)"].apply(clean_date_str),
        errors="coerce"
    )
    df["check_out"] = pd.to_datetime(
        df["DTEND (Check-out)"].apply(clean_date_str),
        errors="coerce"
    )

    df = df.dropna(subset=["check_in", "check_out"])

    today = date.today()
    horizon = today + timedelta(days=30)

    # Rule: ignore check-out in past, and check-in > 30 days in future
    mask = (df["check_out"].dt.date >= today) & (df["check_in"].dt.date <= horizon)
    df = df[mask].copy()

    if df.empty:
        print("ℹ️ No bookings within the 30-day window.")
        return []

    # ---- Detect platform rows ----
    def is_channel_row(desc, email):
        text = (str(desc) + " " + str(email)).lower()
        return ("@guest.booking.com" in text) or ("expediapartnercentral.com" in text)

    df["is_channel_row"] = df.apply(
        lambda r: is_channel_row(
            r.get("DESCRIPTION", ""),
            r.get("Email Address", "")
        ),
        axis=1
    )

    bookings = []

    # ---- Merge duplicate rows ----
    for ref, g in df.groupby("reservation_code"):
        first = g.iloc[0]

        location = first.get("Location", "") or ""
        room = first.get("Room", "") or ""
        guest = first.get("Guest Name", "") or ""
        desc = first.get("DESCRIPTION", "") or ""

        check_in = g["check_in"].min()
        check_out = g["check_out"].max()

        has_channel = g["is_channel_row"].any()

        emails_raw = g["Email Address"].astype(str).tolist()
        emails = [e for e in emails_raw if e and e.lower() != "nan"]
        emails = list(dict.fromkeys(emails))

        digits = re.sub(r"\D", "", ref)
        code = digits[:4] if len(digits) >= 4 else None

        bookings.append({
            "reservation_code": ref,
            "guest_name": guest,
            "property_location": location,
            "door_number": room,
            "check_in": check_in,
            "check_out": check_out,
            "has_channel": has_channel,
            "description": desc,
            "emails": ";".join(emails),
            "code": code,
        })

    print(f"✔ Aggregated to {len(bookings)} unique reservations (after merge & date filters).")
    return bookings


def main():
    print("=== TTLock Automation Start ===")

    client_id = os.getenv("TTLOCK_CLIENT_ID")
    if not client_id:
        print("❌ TTLOCK_CLIENT_ID not set in environment – cannot proceed.")
        return
    tt.initialize_ttlock(client_id)

    paid_refs = load_paid_refs()
    completed_map = load_completed_locks()
    bookings = aggregate_bookings()

    if not bookings:
        print("ℹ️ No eligible bookings found – nothing to do.")
        return

    for booking in bookings:
        ref = booking["reservation_code"]
        guest_name = booking["guest_name"]
        location = booking["property_location"]
        room_name = booking["door_number"]
        has_channel = booking["has_channel"]
        code = booking["code"]
        check_in = booking["check_in"]
        check_out = booking["check_out"]

        print(f"\n📋 Evaluating reservation {ref} for guest '{guest_name}'")
        print(f"   Property: {location}, Room: {room_name}")

        # Rule D: Check specifically if BOTH locks are already successful
        done_locks = completed_map.get(ref, set())
        
        if "front_door" in done_locks and "room" in done_locks:
            print(f"⏭️ Skipping {ref} – BOTH front door and room codes already successful.")
            continue

        # Rule A & B: deposit/pre-auth logic
        is_paid = ref in paid_refs
        if has_channel and not is_paid:
            print(f"⏭️ Skipping {ref} – platform booking with NO payment/pre-auth yet.")
            continue
        elif has_channel:
            print(f"✅ {ref} is platform booking WITH payment – allowed.")
        else:
            print(f"✅ {ref} is non-platform booking – allowed without payment record.")

        if not code:
            print(f"⚠️ {ref}: could not derive a 4-digit code – skipping.")
            continue

        if location not in tt.PROPERTIES:
            print(f"⚠️ {ref}: unknown property_location '{location}' – skipping.")
            continue

        prop_conf = tt.PROPERTIES[location]
        start_ms = int(check_in.timestamp() * 1000)
        end_ms = int(check_out.timestamp() * 1000)

        any_success = False

        # ---- 1. Front door code ----
        front_door_lock_id = prop_conf.get("FRONT_DOOR_LOCK_ID")
        if front_door_lock_id:
            # Skip ONLY if this specific lock is already successful
            if "front_door" in done_locks:
                print(f"✅ Front door code already set for {ref} – skipping this lock.")
            else:
                print(f"🚪 Attempting FRONT DOOR code for {location} (Lock ID {front_door_lock_id})")
                success, resp = tt.create_lock_code_simple(
                    front_door_lock_id,
                    code,
                    guest_name,
                    start_ms,
                    end_ms,
                    f"Front Door ({location})",
                    ref
                )

                log_entry = {
                    "timestamp": datetime.utcnow().isoformat(),
                    "reservation_code": ref,
                    "guest_name": guest_name,
                    "property_location": location,
                    "door_number": "Front Door",
                    "lock_type": "front_door",
                    "code_created": "yes" if success else "no",
                    "ttlock_response": str(resp),
                }
                append_log_entry(log_entry)

                if success:
                    any_success = True
                    print(f"✅ Front door code CREATED for {ref}")
                else:
                    print(f"❌ Front door code FAILED for {ref}")
        else:
            print(f"ℹ️ No front door configured for property '{location}'")

        # ---- 2. Room door code ----
        room_lock_id = prop_conf.get("ROOM_LOCK_IDS", {}).get(room_name)
        if room_lock_id:
            # Skip ONLY if this specific lock is already successful
            if "room" in done_locks:
                print(f"✅ Room code already set for {ref} – skipping this lock.")
            else:
                print(f"🚪 Attempting ROOM code for {location} – {room_name} (Lock ID {room_lock_id})")
                success, resp = tt.create_lock_code_simple(
                    room_lock_id,
                    code,
                    guest_name,
                    start_ms,
                    end_ms,
                    f"{room_name} ({location})",
                    ref
                )

                log_entry = {
                    "timestamp": datetime.utcnow().isoformat(),
                    "reservation_code": ref,
                    "guest_name": guest_name,
                    "property_location": location,
                    "door_number": room_name,
                    "lock_type": "room",
                    "code_created": "yes" if success else "no",
                    "ttlock_response": str(resp),
                }
                append_log_entry(log_entry)

                if success:
                    any_success = True
                    print(f"✅ Room code CREATED for {ref}")
                else:
                    print(f"❌ Room code FAILED for {ref}")
        else:
            print(f"⚠️ No lock configured for room '{room_name}' at '{location}'")

        if any_success:
            print(f"🎉 New codes created/logged for {ref}.")
        elif "front_door" in done_locks or "room" in done_locks:
            print(f"ℹ️ No NEW codes needed (some were already set).")
        else:
            print(f"❌ No successful TTLock codes created for {ref}.")


if __name__ == "__main__":
    main()
