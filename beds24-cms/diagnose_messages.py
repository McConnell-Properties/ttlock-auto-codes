"""
Diagnostic probe for the Beds24 messages API. Tries several endpoint/param
shapes against a few REAL recent bookings and prints exactly what comes back
(including errors — nothing is swallowed). Writes everything to
raw/messages_probe.json for inspection.

Run:  python diagnose_messages.py
"""
import json
import os
import sqlite3

from beds24_client import Beds24Client, Beds24Error

HERE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(HERE, "data", "beds24.db")
RAW = os.path.join(HERE, "raw", "messages_probe.json")


def recent_booking_ids(n=6):
    c = sqlite3.connect(DB_PATH)
    rows = c.execute(
        "SELECT id, referer, arrival FROM bookings ORDER BY arrival DESC LIMIT ?", (n,)
    ).fetchall()
    c.close()
    return rows


def try_call(client, label, path, params):
    print(f"\n### {label}\n    GET {path}  params={params}")
    rec = {"label": label, "path": path, "params": params}
    try:
        data = client.get(path, params=params)
        # summarise
        if isinstance(data, dict):
            keys = list(data.keys())
            payload = data.get("data", data)
            count = len(payload) if isinstance(payload, list) else "n/a"
            print(f"    OK. top-keys={keys} data_len={count}")
            rec["ok"] = True
            rec["top_keys"] = keys
            rec["sample"] = payload[:3] if isinstance(payload, list) else data
        else:
            print(f"    OK (list). len={len(data)}")
            rec["ok"] = True
            rec["sample"] = data[:3]
    except Beds24Error as e:
        print(f"    ERROR: {e}")
        rec["ok"] = False
        rec["error"] = str(e)
    return rec


def main():
    client = Beds24Client()
    bks = recent_booking_ids()
    print("Most recent bookings (id, channel, arrival):")
    for b in bks:
        print("  ", b)
    bid = bks[0][0] if bks else None

    out = {"bookings_probed": bks, "results": []}

    # 1) account-wide messages, recent
    out["results"].append(try_call(client, "all messages, maxAge=30", "/bookings/messages", {"maxAge": 30}))
    # 2) account-wide, no params
    out["results"].append(try_call(client, "all messages, no params", "/bookings/messages", None))
    # 3) per-booking via messages endpoint
    if bid:
        out["results"].append(try_call(client, f"messages for booking {bid}", "/bookings/messages", {"bookingId": bid}))
    # 4) booking with includeMessages (single id)
    if bid:
        out["results"].append(try_call(client, f"booking {bid} includeMessages", "/bookings", {"id": bid, "includeMessages": True}))
    # 5) booking with includeInfoItems (some accounts surface comms here)
    if bid:
        out["results"].append(try_call(client, f"booking {bid} includeInfoItems", "/bookings", {"id": bid, "includeInfoItems": True}))
    # 6) try each recent booking via messages endpoint to find ANY with messages
    print("\n### scanning recent bookings for any non-empty message thread")
    found = []
    for b in bks:
        try:
            d = client.get("/bookings/messages", params={"bookingId": b[0]})
            payload = d.get("data", d) if isinstance(d, dict) else d
            n = len(payload) if isinstance(payload, list) else 0
            print(f"    booking {b[0]} ({b[1]}): {n} messages")
            if n:
                found.append({"bookingId": b[0], "channel": b[1], "messages": payload})
        except Beds24Error as e:
            print(f"    booking {b[0]}: ERROR {e}")
    out["found_threads"] = found

    os.makedirs(os.path.dirname(RAW), exist_ok=True)
    with open(RAW, "w") as f:
        json.dump(out, f, indent=2, default=str)
    print(f"\nFull probe written to {RAW}")


if __name__ == "__main__":
    main()
