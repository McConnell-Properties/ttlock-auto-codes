import requests
import csv
import re
from datetime import datetime, timedelta
import os

OUTPUT_PATH = "automation-data/bookings.csv"

ICAL_SOURCES = {
    "Streatham": {
        "Room 1": "https://io.eviivo.com/pms/v2/open/property/StreathamRoomsCR4/rooms/913d99b1-2eef-4c92-878d-732407d458dd/ical.ics",
        "Room 2": "https://io.eviivo.com/pms/v2/open/property/StreathamRoomsCR4/rooms/859bbdad-ed8b-401c-b1c6-15eadad7035f/ical.ics",
        "Room 3": "https://io.eviivo.com/pms/v2/open/property/StreathamRoomsCR4/rooms/0484521e-b98b-46f8-b71a-50adeea7cc23/ical.ics",
        "Room 4": "https://io.eviivo.com/pms/v2/open/property/StreathamRoomsCR4/rooms/e2e623fd-b7d4-4580-bb63-4a0f7ddeb1a5/ical.ics",
        "Room 5": "https://io.eviivo.com/pms/v2/open/property/StreathamRoomsCR4/rooms/880b9a67-fe17-4d6f-8c3e-bb194dcc1eeb/ical.ics",
        "Room 6": "https://io.eviivo.com/pms/v2/open/property/StreathamRoomsCR4/rooms/b1c750b8-0c22-4fa1-b113-322fca48c20b/ical.ics",
        "Room 7": "https://io.eviivo.com/pms/v2/open/property/StreathamRoomsCR4/rooms/e5b80ef1-5d72-4546-b6dc-62d3d5a426be/ical.ics",
        "Room 8": "https://io.eviivo.com/pms/v2/open/property/StreathamRoomsCR4/rooms/1102b319-9da1-4f75-aced-020129964a3e/ical.ics",
        "Room 9": "https://io.eviivo.com/pms/v2/open/property/StreathamRoomsCR4/rooms/d772f9c8-f1d8-4bb4-9234-8c46c747400f/ical.ics",
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
    },
}

def extract(field, text):
    m = re.search(field + r"(?:;[^:]+)?:([^\r\n]+)", text)
    return m.group(1).strip() if m else ""

def extract_dt(field, text):
    m = re.search(field + r"(?:;[^:]+)?:(\d{8}T?\d{6})", text)
    return m.group(1).strip() if m else ""

def parse_date(dt):
    try:
        return datetime.strptime(dt[:8], "%Y%m%d")
    except:
        return None

def parse_detail(desc):
    email = ""
    personal = ""
    email_match = re.search(r"([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})", desc)
    if email_match:
        email = email_match.group(1)
        if "booking.com" not in email and "expedia" not in email:
            personal = email
    return email, personal

def main():
    rows = []
    today = datetime.now()
    max_ci = today + timedelta(days=30)

    for location, rooms in ICAL_SOURCES.items():
        for room, url in rooms.items():
            try:
                data = requests.get(url, timeout=15).text.replace("\n ", "")
            except:
                continue

            events = data.split("BEGIN:VEVENT")[1:]

            for ev in events:
                summary = extract("SUMMARY", ev)
                ref = re.search(r"(\d{3}-\d{3}-\d{3})", summary or "")
                if not ref:
                    continue
                ref = ref.group(1)

                dtstart = extract_dt("DTSTART", ev)
                dtend   = extract_dt("DTEND", ev)

                ci = parse_date(dtstart)
                co = parse_date(dtend)

                if not ci or not co:
                    continue

                if co < today:
                    continue
                if ci > max_ci:
                    continue

                desc = extract("DESCRIPTION", ev)
                email_channel, email_personal = parse_detail(desc)

                rows.append({
                    "reservation_code": ref,
                    "guest_name": extract("SUMMARY", ev),
                    "property_location": location,
                    "door_number": room,
                    "check_in": ci.strftime("%Y-%m-%d"),
                    "check_out": co.strftime("%Y-%m-%d"),
                    "channel_email": email_channel,
                    "personal_email": email_personal,
                })

    # Deduplicate by reservation_code (keep latest)
    final = {}
    for r in rows:
        final[r["reservation_code"]] = r

    os.makedirs("automation-data", exist_ok=True)

    with open(OUTPUT_PATH, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=final[next(iter(final))].keys())
        w.writeheader()
        w.writerows(final.values())

    print(f"✔ Wrote {len(final)} bookings to {OUTPUT_PATH}")

if __name__ == "__main__":
    main()
