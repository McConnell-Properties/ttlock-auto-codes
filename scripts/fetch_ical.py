import requests
import re
import csv
from datetime import datetime

OUTPUT_FILE = "automation-data/bookings.csv"

# ------------------------------------------------------------------------------------
# HELPERS
# ------------------------------------------------------------------------------------

def extract_value(block, field):
    """Extract simple iCal fields like SUMMARY: or DESCRIPTION:"""
    m = re.search(rf"{field}(?:;[^:]+)?:([^\r\n]+)", block)
    return m.group(1).strip() if m else ""

def extract_datetime(block, field):
    """Extract DTSTART/DTEND packets from VEVENT."""
    m = re.search(rf"{field}(?:;[^:]+)?:(\d{{8}}T?\d{{6}}|\d{{8}})", block)
    return m.group(1).strip() if m else ""

def parse_ical_date(dt):
    """Convert YYYYMMDD or YYYYMMDDTHHMMSS into ISO date: YYYY-MM-DD."""
    if not dt:
        return ""
    date_part = dt[:8]
    try:
        return datetime.strptime(date_part, "%Y%m%d").strftime("%Y-%m-%d")
    except:
        return ""

def extract_guest_details(description):
    """Extract guest name, email, phone from DESCRIPTION best-effort."""
    email_regex = r"([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})"
    phone_regex = r"(\+?\d[\d\s\-]{7,}\d)"

    email = ""
    phone = ""
    name = description.strip()

    m = re.search(email_regex, description)
    if m:
        email = m.group(1)
        name = name.replace(email, "").strip()

    m = re.search(phone_regex, description)
    if m:
        phone = re.sub(r"\s+", "", m.group(1))
        name = name.replace(m.group(1), "").strip()

    name = re.sub(r"\s+", " ", name).strip()
    if len(name) < 2:
        name = ""

    return name, email, phone


# ------------------------------------------------------------------------------------
# FULL ICS URL LIST (EXACT FROM GAS)
# ------------------------------------------------------------------------------------

ICAL_URLS = {
    "Streatham": {
        "Room 1":  "https://io.eviivo.com/pms/v2/open/property/StreathamRoomsCR4/rooms/c94e6a03-c88e-4288-80c4-6c6cab8d583d/ical.ics",
        "Room 2":  "https://io.eviivo.com/pms/v2/open/property/StreathamRoomsCR4/rooms/859bbdad-ed8b-401c-b1c6-15eadad7035f/ical.ics",
        "Room 3":  "https://io.eviivo.com/pms/v2/open/property/StreathamRoomsCR4/rooms/0484521e-b98b-46f8-b71a-50adeea7cc23/ical.ics",
        "Room 4":  "https://io.eviivo.com/pms/v2/open/property/StreathamRoomsCR4/rooms/9eb9d6aa-9a77-4788-a5c1-a7e6cbb4e13d/ical.ics",
        "Room 5":  "https://io.eviivo.com/pms/v2/open/property/StreathamRoomsCR4/rooms/880b9a67-fe17-4d6f-8c3e-bb194dcc1eeb/ical.ics",
        "Room 6":  "https://io.eviivo.com/pms/v2/open/property/StreathamRoomsCR4/rooms/b1c750b8-0c22-4fa1-b113-322fca48c20b/ical.ics",
        "Room 7":  "https://io.eviivo.com/pms/v2/open/property/StreathamRoomsCR4/rooms/e5b80ef1-5d72-4546-b6dc-62d3d5a426be/ical.ics",
        "Room 8":  "https://io.eviivo.com/pms/v2/open/property/StreathamRoomsCR4/rooms/3a838267-3f55-4883-8bd7-edcaeddc1c6c/ical.ics",
        "Room 9":  "https://io.eviivo.com/pms/v2/open/property/StreathamRoomsCR4/rooms/d772f9c8-f1d8-4bb4-9234-8c46c747400f/ical.ics",
        "Room 10": "https://io.eviivo.com/pms/v2/open/property/StreathamRoomsCR4/rooms/29fea56a-c6ba-42d9-9d89-e20094c8b2bb/ical.ics",
        "Room 11": "https://io.eviivo.com/pms/v2/open/property/StreathamRoomsCR4/rooms/cd990a37-0e27-4f1c-8664-ad3cad3fa845/ical.ics",
    },
    "Norwich": {
        "Room 1": "https://io.eviivo.com/pms/v2/open/property/SeamStaysNR2/rooms/25bcbb93-cab7-4b1a-9d1c-967f797fa034/ical.ics",
        "Room 2": "https://io.eviivo.com/pms/v2/open/property/SeamStaysNR2/rooms/9e8ac4e3-8965-4c9f-bea0-e592865ee7f1/ical.ics",
        "Room 3": "https://io.eviivo.com/pms/v2/open/property/SeamStaysNR2/rooms/f5bca5de-5b4b-49de-9b44-522c9f691e91/ical.ics",
        "Room 4": "https://io.eviivo.com/pms/v2/open/property/SeamStaysNR2/rooms/28fc46c9-2ba6-4bcf-9978-367c3b7f20e8/ical.ics",
        "Room 5": "https://io.eviivo.com/pms/v2/open/property/SeamStaysNR2/rooms/a8d9c366-8e93-467d-a421-e2b6da60bc3c/ical.ics",
    },
    "Tooting": {
        "Room 1": "https://io.eviivo.com/pms/v2/open/property/TooStaysSW17/rooms/7c131bbd-8e63-48bd-a60e-c466bdd5ea86/ical.ics",
        "Room 2": "https://io.eviivo.com/pms/v2/open/property/TooStaysSW17/rooms/85d5035f-18fa-4f44-a9ae-05a67e068a04/ical.ics",
        "Room 3": "https://io.eviivo.com/pms/v2/open/property/TooStaysSW17/rooms/365e28a8-b6a9-4497-b286-58b6eebf6cec/ical.ics",
        "Room 4": "https://io.eviivo.com/pms/v2/open/property/TooStaysSW17/rooms/231e6d4a-9d9f-4a3f-bd89-701fb017d52f/ical.ics",
        "Room 5": "https://io.eviivo.com/pms/v2/open/property/TooStaysSW17/rooms/a20cdff1-f242-4d2c-8b4c-30d891e95460/ical.ics",
        "Room 6": "https://io.eviivo.com/pms/v2/open/property/TooStaysSW17/rooms/7919787f-89bd-4e25-97aa-6147cf490fe9/ical.ics",
    }
}


# ------------------------------------------------------------------------------------
# MAIN
# ------------------------------------------------------------------------------------

def main():
    rows = []

    for location, rooms in ICAL_URLS.items():
        for room, url in rooms.items():
            print(f"📡 Fetching {location} – {room}…")

            try:
                resp = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=10)
                text = resp.text.replace("\n ", "").replace("\r ", "")
            except Exception as e:
                print(f"❌ Failed to fetch {location} – {room}: {e}")
                continue

            events = text.split("BEGIN:VEVENT")
            if len(events) <= 1:
                print(f"⚠️ No events for {location} – {room}")
                continue

            for ev in events[1:]:
                summary = extract_value(ev, "SUMMARY")
                description = extract_value(ev, "DESCRIPTION")

                reservation_code = summary.strip()

                dtstart = parse_ical_date(extract_datetime(ev, "DTSTART"))
                dtend   = parse_ical_date(extract_datetime(ev, "DTEND"))

                guest_name, guest_email, guest_phone = extract_guest_details(description)

                rows.append({
                    "reservation_code": reservation_code,
                    "property_location": location,
                    "door_number": room,
                    "check_in": dtstart,
                    "check_out": dtend,
                    "guest_name": guest_name,
                    "guest_email": guest_email,
                    "guest_phone": guest_phone,
                })

    # ALWAYS WRITE CSV (even if empty)
    with open(OUTPUT_FILE, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=[
            "reservation_code", "property_location", "door_number",
            "check_in", "check_out",
            "guest_name", "guest_email", "guest_phone"
        ])
        writer.writeheader()
        writer.writerows(rows)

    print(f"✅ Completed iCal fetch — {len(rows)} bookings written to {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
