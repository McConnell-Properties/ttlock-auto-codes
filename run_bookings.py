# Script to process bookings and create TTLock codes
# This script reads bookings.csv and uses the create_lock_code_simple helper
# from multi_property_lock_codes to create door codes. It also logs actions.

import csv
from datetime import datetime
from multi_property_lock_codes import create_lock_code_simple

if __name__ == "__main__":
    try:
        with open("bookings.csv", newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            rows = list(reader)
            if not rows:
                print("ℹ️ No bookings in bookings.csv")
            else:
                print(f"ℹ️ Processing {len(rows)} bookings from bookings.csv")
                for row in rows:
                    # Extract fields with fallbacks
                    name = row.get("Guest Name") or row.get("guest_name") or row.get("Name") or ""
                    booking_id = row.get("Reservation Code") or row.get("reservation_code") or ""
                    code = row.get("Code") or row.get("door_code") or row.get("code") or ""
                    start_str = row.get("Check-in Date") or row.get("check_in") or row.get("check_in_date") or ""
                    end_str = row.get("Check-out Date") or row.get("check_out") or row.get("check_out_date") or ""
                    lock_id_str = row.get("Lock ID") or row.get("lock_id") or None

                    # Parse dates
                    try:
                        start = datetime.fromisoformat(start_str) if start_str else None
                        end = datetime.fromisoformat(end_str) if end_str else None
                    except Exception as e:
                        print(f"⚠️ Could not parse dates for booking {booking_id}: {e}")
                        continue

                    if not lock_id_str:
                        print(f"⚠️ No lock_id for booking {booking_id}; skipping")
                        continue
                    if start is None or end is None:
                        print(f"⚠️ Missing start or end date for booking {booking_id}; skipping")
                        continue

                    print(f"🔐 Creating code for {name} (booking {booking_id}) with code {code}")
                    try:
                        # Convert lock_id to int if possible
                        try:
                            lock_id = int(lock_id_str)
                        except:
                            lock_id = lock_id_str
                        create_lock_code_simple(lock_id, code, name, start, end, "Room", booking_id)
                    except Exception as e:
                        print(f"⚠️ Error creating code for booking {booking_id}: {e}")
    except FileNotFoundError:
        print("ℹ️ bookings.csv not found in repository")
