# scripts/run_ttlock.py
#
# Create TTLock codes for eligible bookings based on:
# - bookings.csv (from iCal via GAS → GitHub)
# - payments_log.csv (from Gmail → GitHub)
#
# Rules:
#   1) If there is ANY platform email (guest.booking.com / expediapartnercentral)
#      → require a matching row in payments_log.csv.
#   2) If there is NO platform email → always allowed (direct booking).
#   3) Never re-attempt reservations that already have a successful code in ttlock_log.csv.
#
# Files (relative to repo root):
#   automation-data/bookings.csv
#   automation-data/payments_log.csv
#   automation-data/ttlock_log.csv

import csv
import os
import re
from datetime import datetime, timedelta

import multi_property_lock_codes as tt


# -----------------------------
# FILE PATHS
# -----------------------------
BOOKINGS_CSV = os.path.join("automation-data", "bookings.csv")
PAYMENTS_CSV = os.path.join("automation-data", "payments_log.csv")
TTLOCK_LOG_CSV = os.path.join("automation-data", "ttlock_log.csv")


# -----------------------------
# HELPERS
# -----------------------------
def parse_gas_date(value):
    """
    Parse the date format coming from GAS / Apps Script.
    Examples we've seen:
      "Fri Dec 05 2025 00:00:00 GMT+0000 (Greenwich Mean Time)"
    We only care about the date, not time.
    """
    if not value:
        return None

    s = str(value).strip()

    # Try ISO style first (just in case)
    try:
        return datetime.fromisoformat(s)
    except Exception:
        pass

    # Fallback: use the "Fri Dec 05 2025" prefix (first 15 chars)
    # Format: "%a %b %d %Y"
    try:
        prefix = s[:15]
        return datetime.strptime(prefix, "%a %b %d %Y")
    except Exception:
        print(f"⚠️ Could not parse date string: {s!r}")
        return None


def load_payments():
    """
    Read payments_log.csv and return a set of reservation_code values
    that are considered 'paid'.
    payments_log.csv columns: timestamp, reservation_code, received_at
    """
    paid = set()
    if not os.path.exists(PAYMENTS_CSV):
        print("ℹ️ payments_log.csv not found — treating all direct bookings as allowed, platforms as unpaid.")
        return paid

    with open(PAYMENTS_CSV, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            ref = (row.get("reservation_code") or "").strip()
            if ref:
                paid.add(ref)

    print(f"💳 Loaded {len(paid)} paid reservation codes from payments_log.csv")
    return paid


def load_existing_successes():
    """
    Read ttlock_log.csv and return a set of reservation_code values
    for which at least one code was successfully created (code_created == 'yes').
    """
    success = set()
    if not os.path.exists(TTLOCK_LOG_CSV):
        print("ℹ️ ttlock_log.csv does not exist yet — no prior successes.")
        return success

    with open(TTLOCK_LOG_CSV, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            ref = (row.get("reservation_code") or "").strip()
            created = (row.get("code_created") or "").strip().lower()
            if ref and created == "yes":
                success.add(ref)

    print(f"📒 Found {len(success)} reservations with existing successful codes in ttlock_log.csv")
    return success


def load_and_merge_bookings():
    """
    Load bookings.csv and merge rows by SUMMARY (reservation ref).
    bookings.csv headers (from GAS):
      Room, PRODID, VERSION, UID, DTSTAMP,
      DTSTART (Check-in), DTEND (Check-out),
      SUMMARY, DESCRIPTION, SEQUENCE,
      Location, Guest Name, Email Address, Phone Number

    Return a dict: ref -> merged booking
    """
    if not os.path.exists(BOOKINGS_CSV):
        print(f"⚠️ {BOOKINGS_CSV} not found — cannot create TTLock codes.")
        return {}

    with open(BOOKINGS_CSV, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    print(f"📄 Loaded {len(rows)} rows from {BOOKINGS_CSV}")

    merged = {}

    for row in rows:
        ref = (row.get("SUMMARY") or "").strip()
        if not ref:
            continue

        room = (row.get("Room") or "").strip()
        location = (row.get("Location") or "").strip()
        guest_name = (row.get("Guest Name") or "").strip()
        email = (row.get("Email Address") or "").strip()
        desc = (row.get("DESCRIPTION") or "").strip()

        checkin_raw = row.get("DTSTART (Check-in)")
        checkout_raw = row.get("DTEND (Check-out)")

        ci = parse_gas_date(checkin_raw)
        co = parse_gas_date(checkout_raw)

        existing = merged.get(ref)
        if not existing:
            existing = {
                "ref": ref,
                "room": room,
                "location": location,
                "guest_name": guest_name,
                "check_in": ci,
                "check_out": co,
                "description": desc,
                "channel_email": "",
                "personal_email": "",
                "has_platform": False,  # Booking.com / Expedia?
            }
        else:
            # Update basic fields with the latest non-empty
            if room:
                existing["room"] = room
            if location:
                existing["location"] = location
            if guest_name:
                existing["guest_name"] = guest_name
            if desc:
                existing["description"] = desc

            # Merge date range
            if ci and (existing["check_in"] is None or ci < existing["check_in"]):
                existing["check_in"] = ci
            if co and (existing["check_out"] is None or co > existing["check_out"]):
                existing["check_out"] = co

        # Classify email(s)
        if email:
            low = email.lower()
            is_channel = "guest.booking.com" in low or "expediapartnercentral.com" in low
            if is_channel:
                existing["channel_email"] = email
                existing["has_platform"] = True
            else:
                existing["personal_email"] = email

        merged[ref] = existing

    print(f"📦 Merged into {len(merged)} unique reservations by SUMMARY reference")
    return merged


def generate_code_from_ref(ref):
    """
    Generate a 4-digit code from reservation reference by stripping non-digits.
    """
    digits = re.sub(r"\D", "", ref or "")
    if len(digits) < 4:
        return None
    return digits[:4]


# -----------------------------
# MAIN TTLOCK RUNNER
# -----------------------------
def main():
    print("=== TTLock Booking Automation ===")

    # 1) Ensure TTLock CLIENT_ID is configured
    client_id = os.getenv("TTLOCK_CLIENT_ID")
    if not client_id:
        print("❌ TTLOCK_CLIENT_ID not set in environment — aborting.")
        return

    # Initialise ttlock helper (sets global CLIENT_ID)
    tt.initialize_ttlock(client_id)

    # 2) Load payments and existing successes
    paid_refs = load_payments()
    already_success = load_existing_successes()

    # 3) Load bookings and merge duplicates
    merged = load_and_merge_bookings()
    if not merged:
        print("ℹ️ No merged bookings to process.")
        return

    today = datetime.utcnow().date()
    max_check_in = today + timedelta(days=30)

    log_entries = []

    processed_count = 0
    eligible_count = 0
    skipped_paid_logic = 0
    skipped_past = 0
    skipped_future = 0
    skipped_existing = 0

    for ref, booking in merged.items():
        processed_count += 1

        room = booking["room"]
        location = booking["location"]
        guest_name = booking["guest_name"]
        ci = booking["check_in"]
        co = booking["check_out"]
        has_platform = booking["has_platform"]

        # Date sanity
        if not ci or not co:
            print(f"⚠️ Skipping {ref}: missing check-in/check-out")
            continue

        ci_date = ci.date()
        co_date = co.date()

        # Skip past check-outs
        if co_date < today:
            skipped_past += 1
            print(f"⏩ Skipping {ref}: checkout in the past ({co_date})")
            continue

        # Skip very far future check-ins (> 30 days)
        if ci_date > max_check_in:
            skipped_future += 1
            print(f"⏩ Skipping {ref}: check-in beyond 30 days ({ci_date})")
            continue

        # Skip if we already successfully created a code in a previous run
        if ref in already_success:
            skipped_existing += 1
            print(f"⏩ Skipping {ref}: already has successful code in ttlock_log.csv")
            continue

        # Eligibility by platform / payment
        is_paid = ref in paid_refs
        needs_deposit = has_platform

        if needs_deposit and not is_paid:
            skipped_paid_logic += 1
            print(f"⏩ Skipping {ref}: platform booking but NO payment found.")
            continue

        # At this point: either direct booking, or platform+paid
        eligible_count += 1

        # Validate property & room mapping
        if location not in tt.PROPERTIES:
            print(f"⚠️ Skipping {ref}: unknown property location '{location}'")
            continue

        property_cfg = tt.PROPERTIES[location]

        # Room key in PROPERTIES is like 'Room 1', 'Room 2' etc.
        door_number = room  # Room column already looks like 'Room 2'
        room_lock_id = property_cfg.get("ROOM_LOCK_IDS", {}).get(door_number)
        front_lock_id = property_cfg.get("FRONT_DOOR_LOCK_ID")

        if not room_lock_id and not front_lock_id:
            print(f"⚠️ Skipping {ref}: no lock IDs configured for {location}, {door_number}")
            continue

        # Generate code from ref
        code = generate_code_from_ref(ref)
        if not code:
            print(f"⚠️ Skipping {ref}: cannot derive 4-digit code from reference '{ref}'")
            continue

        print(f"\n📋 Processing eligible reservation {ref} for {guest_name}")
        print(f"   Property: {location}, Room: {door_number}")
        print(f"   Check-in: {ci_date}, Check-out: {co_date}")
        print(f"   Platform? {needs_deposit}, Paid? {is_paid}, Code: {code}")

        start_ms = int(ci.replace(hour=15, minute=0, second=0, microsecond=0).timestamp() * 1000)
        end_ms = int(co.replace(hour=11, minute=0, second=0, microsecond=0).timestamp() * 1000)

        any_success = False

        # FRONT DOOR
        if front_lock_id:
            print(f"🚪 Attempting front door code for {location} (lock {front_lock_id})")
            ok, resp = tt.create_lock_code_simple(
                front_lock_id,
                code,
                guest_name,
                start_ms,
                end_ms,
                f"Front Door ({location})",
                ref,
            )
            if ok:
                any_success = True
                log_entries.append({
                    "timestamp": datetime.utcnow().isoformat(),
                    "reservation_code": ref,
                    "guest_name": guest_name,
                    "property_location": location,
                    "door_number": "Front Door",
                    "lock_type": "front_door",
                    "code_created": "yes",
                    "ttlock_response": "success",
                })
            else:
                log_entries.append({
                    "timestamp": datetime.utcnow().isoformat(),
                    "reservation_code": ref,
                    "guest_name": guest_name,
                    "property_location": location,
                    "door_number": "Front Door",
                    "lock_type": "front_door",
                    "code_created": "no",
                    "ttlock_response": str(resp),
                })

        # ROOM DOOR
        if room_lock_id:
            print(f"🚪 Attempting room {door_number} code for {location} (lock {room_lock_id})")
            ok, resp = tt.create_lock_code_simple(
                room_lock_id,
                code,
                guest_name,
                start_ms,
                end_ms,
                f"{door_number} ({location})",
                ref,
            )
            if ok:
                any_success = True
                log_entries.append({
                    "timestamp": datetime.utcnow().isoformat(),
                    "reservation_code": ref,
                    "guest_name": guest_name,
                    "property_location": location,
                    "door_number": door_number,
                    "lock_type": "room",
                    "code_created": "yes",
                    "ttlock_response": "success",
                })
            else:
                log_entries.append({
                    "timestamp": datetime.utcnow().isoformat(),
                    "reservation_code": ref,
                    "guest_name": guest_name,
                    "property_location": location,
                    "door_number": door_number,
                    "lock_type": "room",
                    "code_created": "no",
                    "ttlock_response": str(resp),
                })

        if any_success:
            print(f"✅ Completed reservation {ref} — at least one code created.")
        else:
            print(f"❌ Reservation {ref} — no lock codes were successfully created.")

    # -----------------------------
    # WRITE / APPEND LOG FILE
    # -----------------------------
    if log_entries:
        os.makedirs(os.path.dirname(TTLOCK_LOG_CSV), exist_ok=True)
        file_exists = os.path.exists(TTLOCK_LOG_CSV)

        with open(TTLOCK_LOG_CSV, "a", newline="", encoding="utf-8") as log_file:
            fieldnames = [
                "timestamp",
                "reservation_code",
                "guest_name",
                "property_location",
                "door_number",
                "lock_type",
                "code_created",
                "ttlock_response",
            ]
            writer = csv.DictWriter(log_file, fieldnames=fieldnames)
            if not file_exists:
                writer.writeheader()
            writer.writerows(log_entries)

        print(f"\n📝 Appended {len(log_entries)} entries to {TTLOCK_LOG_CSV}")
    else:
        print("ℹ️ No log entries to write.")

    # Summary
    print("\n=== TTLock run summary ===")
    print(f"Total merged reservations: {processed_count}")
    print(f"Eligible (after date + payment rules): {eligible_count}")
    print(f"Skipped — past checkout: {skipped_past}")
    print(f"Skipped — >30 days ahead: {skipped_future}")
    print(f"Skipped — already had success: {skipped_existing}")
    print(f"Skipped — platform without payment: {skipped_paid_logic}")
    print("=== End of run ===")


if __name__ == "__main__":
    main()
