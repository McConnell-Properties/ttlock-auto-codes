"""
Pull ALL guest messages, unattended.

Strategy:
  1. CHEAP: GET /bookings with includeMessages=true (paginated) — if messages come
     back embedded, parse them all in a handful of calls.
  2. THOROUGH: if nothing is embedded, sweep EVERY booking via
     GET /bookings/messages?bookingId=X, automatically throttling around the
     Beds24 5-minute credit limit (pauses when low, resumes after reset).

Then rebuilds messages-dashboard.html.

Run:  python pull_all_messages.py
"""
import datetime as dt
import json
import os
import sqlite3
import time

from beds24_client import Beds24Client, Beds24Error, Beds24RateLimit
from messages_fetch import init_messages_table, _store_message, _channel_for_booking, _g, save_raw

HERE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(HERE, "data", "beds24.db")

CREDIT_FLOOR = 4          # pause when remaining dips below this
DEFAULT_SLEEP = 60        # fallback pause if header missing


def credit_remaining(client):
    v = client.last_credit.get("x-five-min-limit-remaining")
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def credit_resets_in(client):
    v = client.last_credit.get("x-five-min-limit-resets-in")
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return DEFAULT_SLEEP


def throttle(client):
    """Sleep if we're about to hit the credit limit."""
    rem = credit_remaining(client)
    if rem is not None and rem < CREDIT_FLOOR:
        wait = credit_resets_in(client) + 3
        print(f"   ...credit low ({rem}); pausing {wait}s for the window to reset")
        time.sleep(wait)


def try_bulk(client, conn):
    print("Step 1: trying cheap bulk pull (GET /bookings includeMessages)...")
    try:
        rows = client.get_all_pages("/bookings", params={"includeMessages": True})
    except Beds24RateLimit as e:
        print(f"   rate limited: {e}; falling through to sweep")
        return 0
    save_raw("all_bookings_includeMessages", {"count": len(rows), "data": rows[:30]})
    total = 0
    for b in rows:
        msgs = _g(b, "messages", "messageList", default=None)
        if not msgs:
            continue
        bid = _g(b, "id", "bookId", "bookingId")
        pid = _g(b, "propertyId", "propId")
        channel = _g(b, "referer", "channel", "apiSource", default="Other")
        for i, m in enumerate(msgs):
            _store_message(conn, bid, pid, channel, m, i)
            total += 1
    conn.commit()
    print(f"   embedded messages found: {total}")
    return total


def sweep_all(client, conn):
    print("Step 2: sweeping every booking for messages (throttled)...")
    # Check bookings NEAREST TO TODAY first — current/recent guests are the ones
    # with messages; far-future bookings rarely have any. This finds real threads
    # in the first handful of calls instead of wasting credits on 2027 bookings.
    ids = [r[0] for r in conn.execute(
        "SELECT id FROM bookings ORDER BY ABS(julianday(arrival) - julianday('now')) ASC"
    ).fetchall()]
    print(f"   {len(ids)} bookings to check (nearest-to-today first)")
    total = 0
    with_msgs = 0
    sample = []
    for n, bid in enumerate(ids, 1):
        throttle(client)
        try:
            payload = client.get("/bookings/messages", params={"bookingId": bid})
        except Beds24RateLimit:
            wait = credit_resets_in(client) + 3
            print(f"   hit limit at booking {n}/{len(ids)}; pausing {wait}s")
            time.sleep(wait)
            try:
                payload = client.get("/bookings/messages", params={"bookingId": bid})
            except Beds24Error:
                continue
        except Beds24Error:
            continue
        data = payload.get("data", payload if isinstance(payload, list) else [])
        if data:
            with_msgs += 1
            if len(sample) < 25:
                sample.append({"bookingId": bid, "data": data})
            pid_row = conn.execute("SELECT property_id FROM bookings WHERE id=?", (bid,)).fetchone()
            pid = pid_row[0] if pid_row else None
            channel = _channel_for_booking(conn, bid)
            for i, m in enumerate(data):
                _store_message(conn, bid, pid, channel, m, i)
                total += 1
        if n % 25 == 0:
            print(f"   ...{n}/{len(ids)} checked, {total} messages so far "
                  f"(credit remaining={credit_remaining(client)})")
    if sample:
        save_raw("sweep_messages", sample)
    conn.commit()
    print(f"   sweep done: {total} messages across {with_msgs} bookings")
    return total


def main():
    if not os.path.exists(DB_PATH):
        raise SystemExit("data/beds24.db not found — run fetch.py first.")
    conn = sqlite3.connect(DB_PATH)
    init_messages_table(conn)
    client = Beds24Client()

    total = try_bulk(client, conn)
    if total == 0:
        total = sweep_all(client, conn)

    conn.execute("INSERT OR REPLACE INTO meta (key,value) VALUES ('last_messages_fetch', ?)",
                 (dt.datetime.now().isoformat(timespec="seconds"),))
    conn.commit()
    conn.close()

    print(f"\nTotal messages stored: {total}")
    # rebuild the inbox
    try:
        from build_messages_dashboard import build
        path, inbox = build()
        s = inbox["summary"]
        print(f"Inbox rebuilt: {path}")
        print(f"  threads={s['total_threads']} unanswered={s['unanswered']} channels={list(s['by_channel'])}")
    except Exception as e:
        print(f"(inbox build skipped: {e})")


if __name__ == "__main__":
    main()
