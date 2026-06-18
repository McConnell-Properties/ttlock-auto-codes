"""
Targeted messages probe — looks at CURRENT and RECENT guests (the ones likely to
have messaged), not far-future bookings. Credit-aware: stops on 429.

Run:  python diagnose_messages2.py
"""
import datetime as dt
import json
import os
import sqlite3

from beds24_client import Beds24Client, Beds24Error, Beds24RateLimit

HERE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(HERE, "data", "beds24.db")
RAW = os.path.join(HERE, "raw", "messages_probe2.json")


def pick_bookings():
    today = dt.date.today().isoformat()
    c = sqlite3.connect(DB_PATH)
    q = c.execute(
        """
        SELECT id, referer, arrival, departure,
          CASE
            WHEN arrival <= ? AND departure >= ? THEN 'in-house'
            WHEN arrival > ? THEN 'arriving-soon'
            ELSE 'recent-past'
          END AS bucket
        FROM bookings
        WHERE date(arrival) BETWEEN date(?, '-45 days') AND date(?, '+10 days')
        ORDER BY ABS(julianday(arrival) - julianday(?)) ASC
        LIMIT 12
        """,
        (today, today, today, today, today, today),
    ).fetchall()
    c.close()
    return q


def show_credit(client):
    c = client.last_credit
    return (f"remaining={c.get('x-five-min-limit-remaining')} "
            f"cost={c.get('x-request-cost')} resets_in={c.get('x-five-min-limit-resets-in')}s")


def call(client, path, params):
    try:
        d = client.get(path, params=params)
        payload = d.get("data", d) if isinstance(d, dict) else d
        n = len(payload) if isinstance(payload, list) else "n/a"
        print(f"    OK data_len={n}  [{show_credit(client)}]")
        return {"path": path, "params": params, "ok": True, "data_len": n,
                "sample": payload[:5] if isinstance(payload, list) else d}
    except Beds24RateLimit as e:
        print(f"    RATE LIMITED: {e}")
        return {"path": path, "params": params, "rate_limited": True}
    except Beds24Error as e:
        print(f"    ERROR: {e}")
        return {"path": path, "params": params, "ok": False, "error": str(e)}


def main():
    client = Beds24Client()
    out = {"results": []}

    print("Account-wide messages, widening window:")
    for ma in (90, 365, 3650):
        print(f"  maxAge={ma}")
        r = call(client, "/bookings/messages", {"maxAge": ma})
        out["results"].append(r)
        if r.get("rate_limited"):
            break

    bks = pick_bookings()
    print(f"\nCurrent/recent bookings ({len(bks)}):")
    for b in bks:
        print("  ", b)
    out["bookings"] = bks

    print("\nPer-booking message check:")
    for b in bks:
        print(f"  booking {b[0]} ({b[1]}, {b[4]}):")
        r = call(client, "/bookings/messages", {"bookingId": b[0]})
        r["booking"] = b
        out["results"].append(r)
        if r.get("rate_limited"):
            break

    os.makedirs(os.path.dirname(RAW), exist_ok=True)
    with open(RAW, "w") as f:
        json.dump(out, f, indent=2, default=str)
    print(f"\nSaved to {RAW}")


if __name__ == "__main__":
    main()
