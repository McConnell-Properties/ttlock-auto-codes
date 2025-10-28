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
                    
                    # NEW: Read property_location and door_number from CSV
                    property_location = row.get("property_location") or row.get("Property Location") or ""
                    door_number = row.get("door_number") or row.get("Door Number") or ""
                    
                    print(f"\n📋 Processing booking {booking_id} for {name}")
                    print(f"   Property: {property_location}, Room: {door_number}")
                    
                    # Parse dates
                    try:
                        start = datetime.fromisoformat(start_str) if start_str else None
                        end = datetime.fromisoformat(end_str) if end_str else None
                    except Exception as e:
                        print(f"⚠️ Could not parse dates for booking {booking_id}: {e}")
                        continue
                    
                    # Validate required fields
                    if not property_location:
                        print(f"⚠️ Skipping booking {booking_id} due to missing property_location")
                        continue
                    
                    if not door_number:
                        print(f"⚠️ Skipping booking {booking_id} due to missing door_number")
                        continue
                    
                    if not code:
                        print(f"⚠️ Skipping booking {booking_id} due to missing code")
                        continue
                    
                    # Match property_location to PROPERTIES dict
                    if property_location not in multi_property_lock_codes.PROPERTIES:
                        print(f"⚠️ Unknown property location '{property_location}' - not in PROPERTIES dict")
                        continue
                    
                    property_config = multi_property_lock_codes.PROPERTIES[property_location]
                    
                    # Convert to milliseconds timestamps if start and end exist
                    try:
                        start_ms = int(start.timestamp() * 1000) if start else None
                        end_ms = int(end.timestamp() * 1000) if end else None
                        
                        # Track success for this booking
                        any_success = False
                        
                        # 1. Attempt to create code for FRONT DOOR (if configured)
                        front_door_lock_id = property_config.get("front_door")
                        if front_door_lock_id:
                            print(f"🚪 Attempting front door code for {property_location}...")
                            result = multi_property_lock_codes.create_lock_code_simple(
                                front_door_lock_id, code, name, start_ms, end_ms, 
                                f"Front Door ({property_location})", booking_id
                            )
                            if result:
                                print(f"✅ Front door code created successfully (Lock ID: {front_door_lock_id})")
                                any_success = True
                            else:
                                print(f"❌ Failed to create front door code (Lock ID: {front_door_lock_id})")
                        else:
                            print(f"ℹ️ No front door configured for {property_location}")
                        
                        # 2. Attempt to create code for ROOM LOCK (if present)
                        room_lock_id = property_config.get(door_number)
                        if room_lock_id:
                            print(f"🚪 Attempting room {door_number} code for {property_location}...")
                            result = multi_property_lock_codes.create_lock_code_simple(
                                room_lock_id, code, name, start_ms, end_ms, 
                                f"Room {door_number} ({property_location})", booking_id
                            )
                            if result:
                                print(f"✅ Room {door_number} code created successfully (Lock ID: {room_lock_id})")
                                any_success = True
                            else:
                                print(f"❌ Failed to create room {door_number} code (Lock ID: {room_lock_id})")
                        else:
                            print(f"⚠️ No lock configured for room {door_number} at {property_location}")
                        
                        # Summary for this booking
                        if any_success:
                            print(f"✅ Completed booking {booking_id} for {name} (at least one lock succeeded)")
                        else:
                            print(f"❌ Booking {booking_id} failed - no locks were successfully programmed")
                    
                    except Exception as e:
                        print(f"❌ Failed to create code for booking {booking_id}: {e}")
    
    except FileNotFoundError:
        print("⚠️ bookings.csv file not found")

if __name__ == "__main__":
    main()
