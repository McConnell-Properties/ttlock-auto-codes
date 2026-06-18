"""
Beds24 fetcher — pulls properties, rooms, bookings and inventory into a local
SQLite DB, and saves raw JSON responses to ./raw for shape inspection.

READ ONLY: issues only GET requests.

Run:  python fetch.py            # default windows
      python fetch.py --days-back 365 --days-fwd 365
"""

import argparse
import datetime as dt
import json
import os
import sqlite3

from beds24_client import Beds24Client, Beds24Error

HERE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(HERE, "data", "beds24.db")
RAW_DIR = os.path.join(HERE, "raw")


def _today():
    return dt.date.today()


def _iso(d):
    return d.strftime("%Y-%m-%d")


def _g(d, *keys, default=None):
    """Tolerant getter: returns the first present key (handles field-name drift)."""
    for k in keys:
        if isinstance(d, dict) and k in d and d[k] not in (None, ""):
            return d[k]
    return default


def init_db(conn):
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS properties (
            id INTEGER PRIMARY KEY,
            name TEXT,
            currency TEXT,
            raw TEXT
        );
        CREATE TABLE IF NOT EXISTS rooms (
            id INTEGER PRIMARY KEY,
            property_id INTEGER,
            name TEXT,
            qty INTEGER,
            raw TEXT
        );
        CREATE TABLE IF NOT EXISTS bookings (
            id INTEGER PRIMARY KEY,
            property_id INTEGER,
            room_id INTEGER,
            status TEXT,
            arrival TEXT,
            departure TEXT,
            num_nights INTEGER,
            num_adult INTEGER,
            num_child INTEGER,
            price REAL,
            channel TEXT,
            referer TEXT,
            first_name TEXT,
            last_name TEXT,
            booking_time TEXT,
            modified_time TEXT,
            raw TEXT
        );
        CREATE TABLE IF NOT EXISTS availability (
            room_id INTEGER,
            date TEXT,
            num_available INTEGER,
            price REAL,
            PRIMARY KEY (room_id, date)
        );
        CREATE TABLE IF NOT EXISTS meta (
            key TEXT PRIMARY KEY,
            value TEXT
        );
        """
    )
    conn.commit()


def save_raw(name, payload):
    os.makedirs(RAW_DIR, exist_ok=True)
    with open(os.path.join(RAW_DIR, f"{name}.json"), "w") as f:
        json.dump(payload, f, indent=2)


def fetch_properties(client, conn):
    payload = client.get("/properties", params={"includeAllRooms": True})
    save_raw("properties", payload)
    data = payload.get("data", payload if isinstance(payload, list) else [])
    n_props = n_rooms = 0
    for p in data:
        pid = _g(p, "id", "propertyId", "propid")
        conn.execute(
            "INSERT OR REPLACE INTO properties (id,name,currency,raw) VALUES (?,?,?,?)",
            (pid, _g(p, "name"), _g(p, "currency"), json.dumps(p)),
        )
        n_props += 1
        rooms = _g(p, "roomTypes", "rooms", default=[]) or []
        for r in rooms:
            rid = _g(r, "id", "roomId", "roomTypeId")
            conn.execute(
                "INSERT OR REPLACE INTO rooms (id,property_id,name,qty,raw) VALUES (?,?,?,?,?)",
                (rid, pid, _g(r, "name"), _g(r, "qty", "units", "roomQty", default=1), json.dumps(r)),
            )
            n_rooms += 1
    conn.commit()
    return n_props, n_rooms


def fetch_bookings(client, conn, days_back, days_fwd):
    today = _today()
    start = _iso(today - dt.timedelta(days=days_back))
    end = _iso(today + dt.timedelta(days=days_fwd))
    # Pull anything that overlaps the window: arrivals up to `end`, departures from `start`.
    params = {
        "arrivalFrom": start,
        "arrivalTo": end,
        "includeInvoiceItems": False,
        "includeGuests": True,
    }
    rows = client.get_all_pages("/bookings", params=params)
    save_raw("bookings", {"count": len(rows), "data": rows})
    n = 0
    for b in rows:
        arrival = _g(b, "arrival", "firstNight")
        departure = _g(b, "departure", "lastNight")
        nights = None
        try:
            if arrival and departure:
                a = dt.date.fromisoformat(arrival[:10])
                d = dt.date.fromisoformat(departure[:10])
                nights = max((d - a).days, 0)
        except ValueError:
            pass
        conn.execute(
            """INSERT OR REPLACE INTO bookings
               (id,property_id,room_id,status,arrival,departure,num_nights,
                num_adult,num_child,price,channel,referer,first_name,last_name,
                booking_time,modified_time,raw)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                _g(b, "id", "bookId", "bookingId"),
                _g(b, "propertyId", "propId"),
                _g(b, "roomId", "roomTypeId"),
                str(_g(b, "status", default="")),
                arrival,
                departure,
                nights,
                _g(b, "numAdult", "adults", default=0),
                _g(b, "numChild", "children", default=0),
                float(_g(b, "price", "total", default=0) or 0),
                str(_g(b, "channel", "apiSource", "apiSourceId", default="")),
                str(_g(b, "referer", "source", default="")),
                _g(b, "firstName", "guestFirstName"),
                _g(b, "lastName", "guestName", "guestLastName"),
                _g(b, "bookingTime", "bookingDate"),
                _g(b, "modifiedTime", "modified"),
                json.dumps(b),
            ),
        )
        n += 1
    conn.commit()
    return n


def fetch_availability(client, conn, days_fwd):
    """Optional: per-room availability calendar for forward occupancy.
    Field names vary by account; we store best-effort and never hard-fail the run."""
    today = _today()
    start = _iso(today)
    end = _iso(today + dt.timedelta(days=days_fwd))
    room_ids = [r[0] for r in conn.execute("SELECT id FROM rooms").fetchall()]
    n = 0
    for rid in room_ids:
        try:
            payload = client.get(
                "/inventory/rooms/calendar",
                params={"roomId": rid, "startDate": start, "endDate": end},
            )
        except Beds24Error:
            continue
        data = payload.get("data", payload if isinstance(payload, list) else [])
        for entry in data:
            cal = _g(entry, "calendar", default=[entry]) or [entry]
            for day in cal:
                date = _g(day, "date", "from")
                if not date:
                    continue
                conn.execute(
                    "INSERT OR REPLACE INTO availability (room_id,date,num_available,price) VALUES (?,?,?,?)",
                    (
                        rid,
                        date[:10],
                        _g(day, "numAvail", "numAvailable", "inventory", default=None),
                        _g(day, "price1", "price", default=None),
                    ),
                )
                n += 1
    conn.commit()
    return n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days-back", type=int, default=365)
    ap.add_argument("--days-fwd", type=int, default=365)
    ap.add_argument("--skip-availability", action="store_true")
    args = ap.parse_args()

    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    init_db(conn)
    client = Beds24Client()

    print("Fetching properties & rooms...")
    np_, nr = fetch_properties(client, conn)
    print(f"  properties={np_} rooms={nr}")

    print("Fetching bookings...")
    nb = fetch_bookings(client, conn, args.days_back, args.days_fwd)
    print(f"  bookings={nb}")

    na = 0
    if not args.skip_availability:
        print("Fetching availability calendar (best-effort)...")
        na = fetch_availability(client, conn, args.days_fwd)
        print(f"  availability rows={na}")

    conn.execute(
        "INSERT OR REPLACE INTO meta (key,value) VALUES ('last_fetch', ?)",
        (dt.datetime.now().isoformat(timespec="seconds"),),
    )
    conn.commit()
    conn.close()
    print("Done. Raw responses in ./raw, parsed data in data/beds24.db")


if __name__ == "__main__":
    main()
