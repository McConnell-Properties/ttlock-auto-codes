"""
Generate a mock beds24.db so the dashboard and metrics can be exercised WITHOUT
the live API (sandbox has no network access to beds24.com). Shapes mirror what
fetch.py writes. Run: python tests/make_mock.py
"""
import datetime as dt
import json
import os
import random
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from fetch import init_db  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(HERE, "mock.db")

PROPERTIES = [
    (101, "Streatham Apartment"),
    (102, "Tooting Studio"),
    (103, "Gassiot House"),
    (104, "Valnay Flat"),
]
CHANNELS = ["Booking.com", "Airbnb", "Direct", "Vrbo"]
random.seed(42)


def build(db_path=DB_PATH):
    if os.path.exists(db_path):
        os.remove(db_path)
    conn = sqlite3.connect(db_path)
    init_db(conn)

    for pid, name in PROPERTIES:
        conn.execute("INSERT INTO properties (id,name,currency,raw) VALUES (?,?,?,?)",
                     (pid, name, "£", json.dumps({"id": pid, "name": name})))
        # one room type per property, 1 unit each
        conn.execute("INSERT INTO rooms (id,property_id,name,qty,raw) VALUES (?,?,?,?,?)",
                     (pid * 10, pid, "Whole unit", 1, json.dumps({"qty": 1})))

    today = dt.date.today()
    bid = 1
    # generate bookings spanning last 365 days to +120 days
    for offset in range(-365, 120, 1):
        # ~45% of nights start a booking
        if random.random() > 0.45:
            continue
        pid, _ = random.choice(PROPERTIES)
        arrival = today + dt.timedelta(days=offset)
        nights = random.choice([1, 2, 2, 3, 3, 4, 5, 7])
        departure = arrival + dt.timedelta(days=nights)
        nightly = random.choice([85, 95, 110, 120, 140, 160])
        price = nightly * nights
        channel = random.choices(CHANNELS, weights=[45, 35, 12, 8])[0]
        status = random.choices(["confirmed", "new", "cancelled", "request"],
                                weights=[70, 18, 8, 4])[0]
        lead = random.choice([2, 5, 10, 20, 45, 80, 120])
        booking_time = arrival - dt.timedelta(days=lead)
        conn.execute(
            """INSERT INTO bookings (id,property_id,room_id,status,arrival,departure,
               num_nights,num_adult,num_child,price,channel,referer,first_name,last_name,
               booking_time,modified_time,raw) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (bid, pid, pid * 10, status, arrival.isoformat(), departure.isoformat(),
             nights, random.randint(1, 4), 0, price, channel, channel,
             random.choice(["Sam", "Alex", "Jo", "Pat", "Chris", "Robin"]),
             random.choice(["Lee", "Khan", "Patel", "Smith", "Jones", "Brown"]),
             booking_time.isoformat(), today.isoformat(),
             json.dumps({"id": bid})))
        bid += 1

    conn.execute("INSERT OR REPLACE INTO meta (key,value) VALUES ('last_fetch',?)",
                 (dt.datetime.now().isoformat(timespec="seconds"),))
    conn.commit()
    n = conn.execute("SELECT COUNT(*) FROM bookings").fetchone()[0]
    conn.close()
    print(f"Mock DB written: {db_path} ({n} bookings, {len(PROPERTIES)} properties)")
    return db_path


if __name__ == "__main__":
    build()
