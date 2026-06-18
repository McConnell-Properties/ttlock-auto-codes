"""
Beds24 messages fetcher — READ ONLY. Pulls OTA guest messages (Booking.com,
Expedia, and any other channel with a Beds24 direct-messaging integration) into
the messages table of data/beds24.db, and saves raw responses to ./raw.

Strategy (rate-limit friendly for frequent polling):
  1. Primary: GET /bookings with includeMessages=true over a "comms window"
     (current + near-future + recently-departed guests). One paginated call set
     returns each booking with its message thread embedded.
  2. Fallback: if no embedded messages are present, call GET /bookings/messages
     per booking in the window.

Message types per Beds24: guest | host | internalNote | system.
  - 'guest'  = inbound (from the guest)         -> counts for "unanswered"
  - 'host'   = outbound (you / your auto-replies)
  - internalNote / system are ignored for unanswered logic.

Run:  python messages_fetch.py                # default comms window
      python messages_fetch.py --days-back 30 --days-fwd 120
"""

import argparse
import datetime as dt
import json
import os
import sqlite3

from beds24_client import Beds24Client, Beds24Error, Beds24RateLimit

HERE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(HERE, "data", "beds24.db")
RAW_DIR = os.path.join(HERE, "raw")


def _g(d, *keys, default=None):
    for k in keys:
        if isinstance(d, dict) and k in d and d[k] not in (None, ""):
            return d[k]
    return default


def _iso(d):
    return d.strftime("%Y-%m-%d")


def init_messages_table(conn):
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,           -- stable id (or booking:index fallback)
            booking_id INTEGER,
            property_id INTEGER,
            channel TEXT,                  -- Booking.com / Expedia / ...
            time TEXT,                     -- ISO timestamp of the message
            mtype TEXT,                    -- guest | host | internalNote | system
            direction TEXT,                -- inbound | outbound | note | system
            read INTEGER,                  -- 1/0 if provided by API
            body TEXT,
            raw TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_msg_booking ON messages(booking_id);
        CREATE INDEX IF NOT EXISTS idx_msg_time ON messages(time);
        """
    )
    conn.commit()


def save_raw(name, payload):
    os.makedirs(RAW_DIR, exist_ok=True)
    with open(os.path.join(RAW_DIR, f"{name}.json"), "w") as f:
        json.dump(payload, f, indent=2)


def _direction(mtype):
    t = (mtype or "").strip().lower()
    if t == "guest":
        return "inbound"
    if t == "host":
        return "outbound"
    if t in ("internalnote", "note"):
        return "note"
    return "system"


def _store_message(conn, booking_id, property_id, channel, msg, idx):
    mid = _g(msg, "id", "messageId", "msgId")
    if mid is None:
        mid = f"{booking_id}:{idx}"  # synthesize a stable id
    mtype = str(_g(msg, "source", "type", "messageType", default="")).strip()
    body = _g(msg, "message", "text", "body", default="")
    time = _g(msg, "time", "date", "dateTime", "created", default=None)
    read = _g(msg, "read", "seen", default=None)
    conn.execute(
        """INSERT OR REPLACE INTO messages
           (id,booking_id,property_id,channel,time,mtype,direction,read,body,raw)
           VALUES (?,?,?,?,?,?,?,?,?,?)""",
        (
            str(mid), booking_id, property_id, channel, time, mtype,
            _direction(mtype),
            (1 if read in (True, 1, "1", "true") else (0 if read is not None else None)),
            body, json.dumps(msg),
        ),
    )


def _channel_for_booking(conn, booking_id, fallback=None):
    row = conn.execute(
        "SELECT referer, channel FROM bookings WHERE id=?", (booking_id,)
    ).fetchone()
    if row:
        return (row[0] or row[1] or fallback or "Other")
    return fallback or "Other"


def fetch_bulk(client, conn, max_age_days):
    """Primary, credit-cheap path: ONE account-wide call for recent messages.
    GET /bookings/messages?maxAge=<days>. Each message references its bookingId;
    channel is looked up from the bookings table."""
    rows = client.get_all_pages("/bookings/messages", params={"maxAge": max_age_days})
    save_raw("messages_bulk", {"count": len(rows), "data": rows[:50]})
    total = 0
    # group by booking for stable per-thread indexing
    by_booking = {}
    for m in rows:
        bid = _g(m, "bookingId", "bookId", "booking_id")
        by_booking.setdefault(bid, []).append(m)
    for bid, msgs in by_booking.items():
        pid_row = conn.execute("SELECT property_id FROM bookings WHERE id=?", (bid,)).fetchone()
        pid = pid_row[0] if pid_row else _g(msgs[0], "propertyId")
        channel = _channel_for_booking(conn, bid)
        for i, m in enumerate(msgs):
            _store_message(conn, bid, pid, channel, m, i)
            total += 1
    conn.commit()
    return total, len(by_booking), len(rows)


def fetch_deep(client, conn, days_back, days_fwd, max_queries=25):
    """Opt-in fallback (--deep): per-booking GET /bookings/messages, but HARD
    CAPPED and credit-aware so it can never blow the budget. Stops on 429."""
    today = dt.date.today()
    lo = (today - dt.timedelta(days=days_back)).isoformat()
    hi = (today + dt.timedelta(days=days_fwd)).isoformat()
    booking_ids = [r[0] for r in conn.execute(
        "SELECT id FROM bookings WHERE departure >= ? AND arrival <= ? ORDER BY arrival LIMIT ?",
        (lo, hi, max_queries)
    ).fetchall()]
    total = 0
    sample = []
    for bid in booking_ids:
        try:
            payload = client.get("/bookings/messages", params={"bookingId": bid})
        except Beds24RateLimit as e:
            print(f"  stopped early — rate limited after {total} messages ({e.resets_in}s to reset)")
            break
        except Beds24Error:
            continue
        data = payload.get("data", payload if isinstance(payload, list) else [])
        if data and len(sample) < 20:
            sample.append({"bookingId": bid, "data": data})
        pid_row = conn.execute("SELECT property_id FROM bookings WHERE id=?", (bid,)).fetchone()
        pid = pid_row[0] if pid_row else None
        channel = _channel_for_booking(conn, bid)
        for i, m in enumerate(data):
            _store_message(conn, bid, pid, channel, m, i)
            total += 1
    if sample:
        save_raw("messages_deep", sample)
    conn.commit()
    return total, len(booking_ids)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-age", type=int, default=120,
                    help="Pull messages from the last N days (bulk call)")
    ap.add_argument("--days-back", type=int, default=30)
    ap.add_argument("--days-fwd", type=int, default=120)
    ap.add_argument("--deep", action="store_true",
                    help="Also do a capped per-booking sweep (more API credits)")
    args = ap.parse_args()

    if not os.path.exists(DB_PATH):
        raise SystemExit("data/beds24.db not found — run fetch.py first to load bookings.")

    conn = sqlite3.connect(DB_PATH)
    init_messages_table(conn)
    client = Beds24Client()

    try:
        print(f"Fetching messages (bulk, last {args.max_age} days)...")
        n_msg, n_bk, n_rows = fetch_bulk(client, conn, args.max_age)
        print(f"  {n_rows} messages across {n_bk} bookings, stored {n_msg}")
        if args.deep:
            print("Deep sweep (capped)...")
            dn, dq = fetch_deep(client, conn, args.days_back, args.days_fwd)
            print(f"  deep: queried {dq} bookings, stored {dn} more")
    except Beds24RateLimit as e:
        print(f"RATE LIMITED — backing off. {e}")
        print(f"  credit remaining={e.remaining}, resets in {e.resets_in}s. "
              f"Try again after the window resets.")
        conn.close()
        return

    conn.execute(
        "INSERT OR REPLACE INTO meta (key,value) VALUES ('last_messages_fetch', ?)",
        (dt.datetime.now().isoformat(timespec="seconds"),),
    )
    conn.commit()
    conn.close()
    print("Done. Raw in ./raw, messages in data/beds24.db")


if __name__ == "__main__":
    main()
