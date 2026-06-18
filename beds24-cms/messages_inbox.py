"""
Inbox builder — turns the flat messages table into guest threads with
unanswered detection. Pure functions so the logic is unit-testable.

A thread is "unanswered" when, ignoring internal notes and system messages, the
most recent message is from the guest (inbound) — i.e. you haven't replied yet.
"""

import datetime as dt
import sqlite3


def _dt(s):
    if not s:
        return None
    s = str(s)
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return dt.datetime.strptime(s[:19], fmt)
        except ValueError:
            continue
    try:
        return dt.datetime.fromisoformat(s[:19])
    except ValueError:
        return None


def build_threads(messages, now=None):
    """messages: list of dicts with keys booking_id, channel, property_id, time,
    mtype, direction, body, read. Returns thread list + summary."""
    now = now or dt.datetime.now()
    by_booking = {}
    for m in messages:
        by_booking.setdefault(m["booking_id"], []).append(m)

    threads = []
    for bid, msgs in by_booking.items():
        msgs_sorted = sorted(msgs, key=lambda x: (_dt(x.get("time")) or dt.datetime.min))
        # conversation = guest/host only (exclude internal notes & system)
        convo = [m for m in msgs_sorted if (m.get("direction") in ("inbound", "outbound"))]
        if not convo:
            convo = msgs_sorted
        last = convo[-1]
        unanswered = last.get("direction") == "inbound"
        # waiting time = since the last inbound that has no later outbound
        wait_hours = None
        if unanswered:
            t = _dt(last.get("time"))
            if t:
                wait_hours = round((now - t).total_seconds() / 3600, 1)
        unread = sum(1 for m in convo if m.get("direction") == "inbound" and m.get("read") == 0)
        threads.append({
            "booking_id": bid,
            "property_id": last.get("property_id"),
            "channel": last.get("channel") or "Other",
            "unanswered": unanswered,
            "wait_hours": wait_hours,
            "unread": unread,
            "last_time": last.get("time"),
            "last_type": last.get("mtype"),
            "message_count": len(convo),
            "preview": (last.get("body") or "")[:160],
            "messages": [
                {
                    "time": m.get("time"),
                    "direction": m.get("direction"),
                    "type": m.get("mtype"),
                    "body": m.get("body") or "",
                }
                for m in msgs_sorted
            ],
        })

    # sort: unanswered first, longest-waiting first; then answered by most recent
    def sort_key(t):
        if t["unanswered"]:
            return (0, -(t["wait_hours"] or 0))
        last = _dt(t["last_time"]) or dt.datetime.min
        return (1, -last.timestamp())

    threads.sort(key=sort_key)
    return threads


def summarize(threads):
    by_channel = {}
    unanswered = 0
    for t in threads:
        c = t["channel"]
        d = by_channel.setdefault(c, {"threads": 0, "unanswered": 0})
        d["threads"] += 1
        if t["unanswered"]:
            d["unanswered"] += 1
            unanswered += 1
    return {
        "total_threads": len(threads),
        "unanswered": unanswered,
        "by_channel": by_channel,
    }


def build_inbox(db_path):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        rows = [dict(r) for r in conn.execute("SELECT * FROM messages").fetchall()]
    except sqlite3.OperationalError:
        rows = []
    prop_names = {}
    try:
        for r in conn.execute("SELECT id,name FROM properties").fetchall():
            prop_names[r[0]] = r[1]
    except sqlite3.OperationalError:
        pass
    meta = {}
    try:
        meta = {r[0]: r[1] for r in conn.execute("SELECT key,value FROM meta").fetchall()}
    except sqlite3.OperationalError:
        pass
    conn.close()

    threads = build_threads(rows)
    for t in threads:
        t["property"] = prop_names.get(t["property_id"], t["property_id"])
    return {
        "generated_at": dt.datetime.now().isoformat(timespec="seconds"),
        "last_messages_fetch": meta.get("last_messages_fetch"),
        "summary": summarize(threads),
        "threads": threads,
    }
