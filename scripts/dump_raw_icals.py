import os
import requests

# -----------------------------
# ICS URL MAP
# -----------------------------
ICAL_URLS = {
    "Streatham": {
        "Room 1":  "https://io.eviivo.com/pms/v2/open/property/StreathamRoomsCR4/rooms/913d99b1-2eef-4c92-878d-732407d458dd/ical.ics",
        "Room 2":  "https://io.eviivo.com/pms/v2/open/property/StreathamRoomsCR4/rooms/859bbdad-ed8b-401c-b1c6-15eadad7035f/ical.ics",
        "Room 3":  "https://io.eviivo.com/pms/v2/open/property/StreathamRoomsCR4/rooms/0484521e-b98b-46f8-b71a-50adeea7cc23/ical.ics",
        "Room 4":  "https://io.eviivo.com/pms/v2/open/property/StreathamRoomsCR4/rooms/e2e623fd-b7d4-4580-bb63-4a0f7ddeb1a5/ical.ics",
        "Room 5":  "https://io.eviivo.com/pms/v2/open/property/StreathamRoomsCR4/rooms/880b9a67-fe17-4d6f-8c3e-bb194dcc1eeb/ical.ics",
        "Room 6":  "https://io.eviivo.com/pms/v2/open/property/StreathamRoomsCR4/rooms/b1c750b8-0c22-4fa1-b113-322fca48c20b/ical.ics",
        "Room 7":  "https://io.eviivo.com/pms/v2/open/property/StreathamRoomsCR4/rooms/e5b80ef1-5d72-4546-b6dc-62d3d5a426be/ical.ics",
        "Room 8":  "https://io.eviivo.com/pms/v2/open/property/StreathamRoomsCR4/rooms/1102b319-9da1-4f75-aced-020129964a3e/ical.ics",
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

# -----------------------------
# MAIN RAW FETCH LOGIC
# -----------------------------
def main():
    outdir = "automation-data/raw-icals"
    os.makedirs(outdir, exist_ok=True)

    print("\n=== Fetching ALL raw iCal files ===")

    for location, rooms in ICAL_URLS.items():
        for room, url in rooms.items():
            print(f"\n📡 Fetching {location} – {room}...")
            try:
                resp = requests.get(url, timeout=15)
                resp.raise_for_status()

                data = resp.text
                filename = f"{location}_{room.replace(' ', '')}.ics"
                path = os.path.join(outdir, filename)

                with open(path, "w", encoding="utf-8") as f:
                    f.write(data)

                print(f"✅ Saved: {path} ({len(data)} chars)")
                print("First 5 lines:")
                print("\n".join(data.splitlines()[:5]))

            except Exception as e:
                print(f"❌ Error fetching {location} – {room}: {e}")

    print("\n=== Completed dumping all raw iCal files ===")


if __name__ == "__main__":
    main()
