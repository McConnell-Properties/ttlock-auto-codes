"""
Unit tests for inbox logic — unanswered detection, sorting, channel summary.
No network. Run: python tests/test_messages.py
"""
import datetime as dt
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import messages_inbox as MI  # noqa: E402

failures = []


def check(name, got, want):
    ok = got == want
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}: got={got} want={want}")
    if not ok:
        failures.append(name)


def msg(booking, t, direction, mtype, channel="Booking.com", body="x", read=None, pid=1):
    return {"booking_id": booking, "property_id": pid, "channel": channel, "time": t,
            "mtype": mtype, "direction": direction, "body": body, "read": read}


def test_unanswered_and_sorting():
    now = dt.datetime(2026, 6, 16, 12, 0, 0)
    messages = [
        # booking 1: guest messaged last -> UNANSWERED, waiting ~2h
        msg(1, "2026-06-16T10:00:00", "inbound", "guest", "Booking.com"),
        # booking 2: host replied last -> answered
        msg(2, "2026-06-15T09:00:00", "inbound", "guest", "Expedia"),
        msg(2, "2026-06-15T09:30:00", "outbound", "host", "Expedia"),
        # booking 3: guest messaged last, waiting longer (~26h) -> unanswered, should sort FIRST
        msg(3, "2026-06-15T10:00:00", "inbound", "guest", "Booking.com"),
        # internal note after guest msg must NOT count as a reply
        msg(1, "2026-06-16T10:05:00", "note", "internalNote", "Booking.com"),
    ]
    threads = MI.build_threads(messages, now=now)
    by = {t["booking_id"]: t for t in threads}
    check("b1 unanswered", by[1]["unanswered"], True)
    check("b2 answered", by[2]["unanswered"], False)
    check("b3 unanswered", by[3]["unanswered"], True)
    check("note_not_reply", by[1]["unanswered"], True)  # note didn't flip it
    # longest waiting (b3, 26h) sorts before b1 (2h); both before answered b2
    check("sort_order", [t["booking_id"] for t in threads], [3, 1, 2])

    s = MI.summarize(threads)
    check("total", s["total_threads"], 3)
    check("unanswered_count", s["unanswered"], 2)
    check("bdc_unanswered", s["by_channel"]["Booking.com"]["unanswered"], 2)
    check("expedia_threads", s["by_channel"]["Expedia"]["threads"], 1)


def test_wait_hours():
    now = dt.datetime(2026, 6, 16, 12, 0, 0)
    threads = MI.build_threads([msg(9, "2026-06-16T09:00:00", "inbound", "guest")], now=now)
    check("wait_hours", threads[0]["wait_hours"], 3.0)


if __name__ == "__main__":
    print("Running inbox unit tests...")
    test_unanswered_and_sorting()
    test_wait_hours()
    if failures:
        print(f"\n{len(failures)} FAILURE(S): {failures}")
        sys.exit(1)
    print("\nAll inbox tests passed.")
