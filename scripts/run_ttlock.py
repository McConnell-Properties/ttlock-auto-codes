import os
import csv
from datetime import datetime
import re

import multi_property_lock_codes as tt
import run_bookings  # Your previous booking-to-code generator

BOOKINGS_PATH = "automation-data/bookings.csv"
LOG_PATH = "automation-data/ttlock_log.csv"


def load_existing_log():
    if not os.path.exists(LOG_PATH):
        return set()

    existing = set()
    with open(LOG_PATH, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            existing.add((row["reservation_code"], row["door_number"]))
    return existing


def run_ttlock():
    print("\n=== Step 3: TTLock Automation ===")

    if not os.path.exists(BOOKINGS_PATH):
        print("⚠️ bookings.csv missing, skipping TTLock automation.")
        return

    processed_pairs = load_existing_log()
    log_entries = []

    # Load bookings
    with open(BOOKINGS_PATH, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        bookings = list(reader)

    print(f"Found {len(bookings)} bookings…")

    for b in bookings:
        reservation = b.get("reservation_code", "").strip()
        guest = b.get("guest_name", "").strip()
        prop = b.get("property_location", "").strip()
        room = b.get("door_number", "").strip()
        code = b.get("code", "")

        if not reservation or not prop or not room:
            print(f"⚠️ Skipping booking with missing data: {b}")
            continue

        pair = (reservation, room)

        if pair in processed_pairs:
            print(f"⏩ Already processed {reservation} / {room}, skipping")
            continue

        print(f"\n🔐 Generating codes for: {reservation} | {guest} | {prop} | {room}")

        # Generate code if missing
        if not code:
            digits = re.sub(r"\D", "", reservation)
            if len(digits) >= 4:
                code = digits[:4]
                print(f"Generated fallback code {code}")

        start_str = b.get("check_in")
        end_str = b.get("check_out")

        try:
            start_ms = int(datetime.fromisoformat(start_str).timestamp() * 1000)
            end_ms = int(datetime.fromisoformat(end_str).timestamp() * 1000)
        except:
            print(f"⚠️ Invalid dates for {reservation}")
            continue

        # -------- CREATE FRONT DOOR CODE --------
        front_lock = tt.PROPERTIES[prop]["FRONT_DOOR_LOCK_ID"]
        if front_lock:
            ok, response = tt.create_lock_code_simple(
                front_lock, code, guest, start_ms, end_ms, 
                f"Front Door {prop}", reservation
            )
            log_entries.append({
                "timestamp": datetime.now().isoformat(),
                "reservation_code": reservation,
                "guest_name": guest,
                "property_location": prop,
                "door_number": "Front Door",
                "lock_type": "front_door",
                "code_created": "yes" if ok else "no",
                "ttlock_response": str(response)
            })

        # -------- CREATE ROOM DOOR CODE --------
        room_lock = tt.PROPERTIES[prop]["ROOM_LOCK_IDS"].get(room)
        if room_lock:
            ok, response = tt.create_lock_code_simple(
                room_lock, code, guest, start_ms, end_ms, 
                f"{prop} {room}", reservation
            )
            log_entries.append({
                "timestamp": datetime.now().isoformat(),
                "reservation_code": reservation,
                "guest_name": guest,
                "property_location": prop,
                "door_number": room,
                "lock_type": "room",
                "code_created": "yes" if ok else "no",
                "ttlock_response": str(response)
            })
        else:
            print(f"⚠️ No lock for {room} in {prop}")

    # Write log
    if log_entries:
        mode = "a" if os.path.exists(LOG_PATH) else "w"
        with open(LOG_PATH, mode, newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=[
                "timestamp", "reservation_code", "guest_name",
                "property_location", "door_number",
                "lock_type", "code_created", "ttlock_response"
            ])
            if mode == "w":
                writer.writeheader()
            writer.writerows(log_entries)

    print(f"✅ TTLock processing complete. {len(log_entries)} new actions logged.")
