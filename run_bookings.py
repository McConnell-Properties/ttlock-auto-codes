# Script to process bookings and create TTLock codes
# Reads bookings.csv, sets TTLock credentials from environment, and logs actions.
import csv
import os
from datetime import datetime
import multi_property_lock_codes

# Assign TTLock credentials from environment to the helper module
multi_property_lock_codes.CLIENT_ID = os.getenv("TTLOCK_CLIENT_ID")
multi_property_lock_codes.ACCESS_TOKEN = os.getenv("TTLOCK_ACCESS_TOKEN")


def main():
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
                        print(f"⚠️ Skipping booking {booking_id} due to missing Lock ID")
                        continue

                    if not code:
                        print(f"⚠️ Skipping booking {booking_id} due to missing code")
                        continue

                    # Convert to milliseconds timestamps if start and end exist
                    try:
                        start_ms = int(start.timestamp() * 1000) if start else None
                        end_ms = int(end.timestamp() * 1000) if end else None
                        # Call helper to create lock code
                        result = multi_property_lock_codes.create_lock_code_simple(int(lock_id_str), code, start_ms, end_ms)
                        print(f"✅ Processed booking {booking_id} for {name}: {result}")
                    except Exception as e:
                        print(f"❌ Failed to create code for booking {booking_id}: {e}")
    except FileNotFoundError:
        print("⚠️ bookings.csv file not found")


if __name__ == "__main__":
    main()
