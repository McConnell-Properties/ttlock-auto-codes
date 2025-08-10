#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Multi-Property Lock Code Generator
===================================
Generates TTLock codes for all upcoming bookings across
Tooting, Streatham, and Norwich properties from their iCal URLs.

Rule: Uses the last 4 digits of the guest's phone number (if found).
"""

import requests
import re
import pytz
from datetime import datetime
from icalendar import Calendar
import csv
from io import BytesIO

# ------------------------------------
# TTLock credentials (from your account)
# ------------------------------------
CLIENT_ID = "686b92b325e946119564197052907858"
ACCESS_TOKEN = "0505ac2fc9c21e7e3c6ed5a85fd18717"

# ------------------------------------
# ICAL URLs by property & room
# ------------------------------------
PROPERTIES = {
    "Tooting": {
        'Room 1': "https://io.eviivo.com/pms/v2/open/property/StreathamRoomsCR4/rooms/913d99b1-2eef-4c92-878d-732407d458dd/ical.ics",
        'Room 2': "https://io.eviivo.com/pms/v2/open/property/StreathamRoomsCR4/rooms/859bbdad-ed8b-401c-b1c6-15eadad7035f/ical.ics",
        'Room 3': "https://io.eviivo.com/pms/v2/open/property/StreathamRoomsCR4/rooms/0484521e-b98b-46f8-b71a-50adeea7cc23/ical.ics",
        'Room 4': "https://io.eviivo.com/pms/v2/open/property/StreathamRoomsCR4/rooms/e2e623fd-b7d4-4580-bb63-4a0f7ddeb1a5/ical.ics",
        'Room 5': "https://io.eviivo.com/pms/v2/open/property/StreathamRoomsCR4/rooms/880b9a67-fe17-4d6f-8c3e-bb194dcc1eeb/ical.ics",
        'Room 6': "https://io.eviivo.com/pms/v2/open/property/StreathamRoomsCR4/rooms/b1c750b8-0c22-4fa1-b113-322fca48c20b/ical.ics",
        'Room 7': "https://io.eviivo.com/pms/v2/open/property/StreathamRoomsCR4/rooms/e5b80ef1-5d72-4546-b6dc-62d3d5a426be/ical.ics",
        'Room 8': "https://io.eviivo.com/pms/v2/open/property/StreathamRoomsCR4/rooms/1102b319-9da1-4f75-aced-020129964a3e/ical.ics",
        'Room 9': "https://io.eviivo.com/pms/v2/open/property/StreathamRoomsCR4/rooms/d772f9c8-f1d8-4bb4-9234-8c46c747400f/ical.ics",
        'Room 10': "https://io.eviivo.com/pms/v2/open/property/StreathamRoomsCR4/rooms/29fea56a-c6ba-42d9-9d89-e20094c8b2bb/ical.ics",
        'Room 11': "https://io.eviivo.com/pms/v2/open/property/StreathamRoomsCR4/rooms/cd990a37-0e27-4f1c-8664-ad3cad3fa845/ical.ics"
    },
    "Norwich": {
        'Room 1': "https://io.eviivo.com/pms/v2/open/property/SeamStaysNR2/rooms/25bcbb93-cab7-4b1a-9d1c-967f797fa034/ical.ics",
        'Room 2': "https://io.eviivo.com/pms/v2/open/property/SeamStaysNR2/rooms/9e8ac4e3-8965-4c9f-bea0-e592865ee7f1/ical.ics",
        'Room 3': "https://io.eviivo.com/pms/v2/open/property/SeamStaysNR2/rooms/f5bca5de-5b4b-49de-9b44-522c9f691e91/ical.ics",
        'Room 4': "https://io.eviivo.com/pms/v2/open/property/SeamStaysNR2/rooms/28fc46c9-2ba6-4bcf-9978-367c3b7f20e8/ical.ics",
        'Room 5': "https://io.eviivo.com/pms/v2/open/property/SeamStaysNR2/rooms/a8d9c366-8e93-467d-a421-e2b6da60bc3c/ical.ics"
    }
}

# ------------------------------------
# Lock IDs
# ------------------------------------
LOCKS = {
    "Tooting": {
        "Front Door": None,  # not yet available
        "Room 1": 24719576,
        "Room 2": 24641840,
        "Room 3": 24719570,
        "Room 4": None,
        "Room 5": 24717236,
        "Room 6": 24717242,
        "Room 7": None,
        "Room 8": None,
        "Room 9": 24692300,
        "Room 10": 24717964,
        "Room 11": None
    },
    "Norwich": {
        "Front Door": 17503964
    }
}

# ------------------------------------
# Helpers
# ------------------------------------
def extract_phone_number(text):
    matches = re.findall(r"\+?\d[\d\s]{7,}\d", text)
    if matches:
        return re.sub(r"\D", "", matches[0])
    return None

def fetch_ical_events(url):
    try:
        r = requests.get(url)
        r.raise_for_status()
        cal = Calendar.from_ical(r.content)
        events = []
        for component in cal.walk():
            if component.name == "VEVENT":
                start = component.get("DTSTART").dt
                end = component.get("DTEND").dt
                desc = str(component.get("DESCRIPTION") or "")
                summary = str(component.get("SUMMARY") or "")
                events.append({
                    "start": start,
                    "end": end,
                    "desc": desc,
                    "summary": summary
                })
        return events
    except Exception as e:
        print(f"❌ Error fetching {url}: {e}")
        return []

def create_code(lock_id, code, start_ts, end_ts):
    url = "https://euapi.ttlock.com/v3/keyboardPwd/add"
    params = {
        "clientId": CLIENT_ID,
        "accessToken": ACCESS_TOKEN,
        "lockId": lock_id,
        "keyboardPwd": code,
        "startDate": start_ts,
        "endDate": end_ts,
        "keyboardPwdName": "AutoCode"
    }
    try:
        r = requests.post(url, params=params)
        r.raise_for_status()
        data = r.json()
        if data.get("errcode") == 0:
            print(f"✅ Code {code} created for lock {lock_id}")
        else:
            print(f"❌ Failed to create code {code} on lock {lock_id}: {data}")
    except Exception as e:
        print(f"❌ HTTP error creating code {code} for lock {lock_id}: {e}")

# ------------------------------------
# Main loop
# ------------------------------------
all_rows = []
today = datetime.now(pytz.UTC)

for property_name, rooms in PROPERTIES.items():
    print(f"\n🏨 Processing property: {property_name}")
    for room_name, ical_url in rooms.items():
        print(f"📅 Fetching bookings for {room_name}...")
        events = fetch_ical_events(ical_url)
        for ev in events:
            if isinstance(ev["start"], datetime) and ev["start"] >= today:
                phone = extract_phone_number(ev["desc"])
                if phone:
                    code = phone[-4:]
                    start_ts = int(ev["start"].timestamp() * 1000)
                    end_ts = int(ev["end"].timestamp() * 1000)
                    lock_id = LOCKS.get(property_name, {}).get(room_name) or LOCKS.get(property_name, {}).get("Front Door")
                    if lock_id:
                        create_code(lock_id, code, start_ts, end_ts)
                    else:
                        print(f"⚠️ No lock ID for {room_name} in {property_name}")
                    all_rows.append([property_name, room_name, ev["start"], ev["end"], code])
                else:
                    print(f"❌ No phone number for booking in {room_name}")

# Save CSV report
with open("lock_code_report.csv", "w", newline="") as f:
    writer = csv.writer(f)
    writer.writerow(["Property", "Room", "Start", "End", "Code"])
    writer.writerows(all_rows)

print("\n📊 Report saved to lock_code_report.csv")
