"""
Unit tests for the metric maths — known inputs, known answers. No network needed.
Run: python tests/test_metrics.py   (exits non-zero on failure)
"""
import datetime as dt
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import metrics as M  # noqa: E402

failures = []


def check(name, got, want, tol=1e-6):
    ok = abs(got - want) <= tol if isinstance(want, float) else got == want
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}: got={got} want={want}")
    if not ok:
        failures.append(name)


def test_occupancy_and_rates():
    # 2 rooms, 10-day period => 20 available room-nights.
    rooms = [{"qty": 1}, {"qty": 1}]
    p_start = dt.date(2026, 1, 1)
    p_end = dt.date(2026, 1, 11)  # 10 days
    bookings = [
        # 4-night confirmed stay fully inside, price 400 => 100/night
        {"status": "confirmed", "arrival": "2026-01-02", "departure": "2026-01-06", "price": 400},
        # 2-night new stay inside, price 240 => 120/night
        {"status": "new", "arrival": "2026-01-05", "departure": "2026-01-07", "price": 240},
        # cancelled - must be ignored
        {"status": "cancelled", "arrival": "2026-01-03", "departure": "2026-01-08", "price": 999},
    ]
    blk = M.occupancy_block(bookings, rooms, p_start, p_end)
    check("available_room_nights", blk["available_room_nights"], 20)
    check("sold_room_nights", blk["sold_room_nights"], 6)              # 4 + 2
    check("revenue", blk["revenue"], 640.0)                            # 400 + 240
    check("occupancy", blk["occupancy"], round(6 / 20, 4))            # 0.30
    check("adr", blk["adr"], round(640.0 / 6, 2))                      # 106.67
    check("revpar", blk["revpar"], round(640.0 / 20, 2))             # 32.0


def test_proration_across_boundary():
    # 1 room, period is Jan; a stay that straddles the end of Jan into Feb.
    rooms = [{"qty": 1}]
    p_start = dt.date(2026, 1, 30)
    p_end = dt.date(2026, 2, 2)  # 3 days: Jan30, Jan31, Feb1
    # 4-night stay Jan30->Feb3, price 400 => 100/night; 3 nights fall in period
    bookings = [{"status": "confirmed", "arrival": "2026-01-30", "departure": "2026-02-03", "price": 400}]
    blk = M.occupancy_block(bookings, rooms, p_start, p_end)
    check("boundary_sold_nights", blk["sold_room_nights"], 3)
    check("boundary_revenue", blk["revenue"], 300.0)  # 3 of 4 nights * 100


def test_channel_mix():
    p_start = dt.date(2026, 1, 1)
    p_end = dt.date(2026, 2, 1)
    bookings = [
        {"status": "confirmed", "arrival": "2026-01-01", "departure": "2026-01-03",
         "price": 200, "referer": "Booking.com"},
        {"status": "confirmed", "arrival": "2026-01-05", "departure": "2026-01-06",
         "price": 90, "referer": "Airbnb"},
        {"status": "cancelled", "arrival": "2026-01-07", "departure": "2026-01-10",
         "price": 999, "referer": "Airbnb"},
    ]
    rows = M.channel_mix(bookings, p_start, p_end)
    by = {r["channel"]: r for r in rows}
    check("bdc_revenue", by["Booking.com"]["revenue"], 200.0)
    check("airbnb_nights", by["Airbnb"]["nights"], 1)
    check("airbnb_count", by["Airbnb"]["bookings"], 1)  # cancelled excluded


def test_lead_time():
    bookings = [
        {"status": "confirmed", "arrival": "2026-06-10", "booking_time": "2026-06-08"},  # 2d
        {"status": "confirmed", "arrival": "2026-06-30", "booking_time": "2026-06-10"},  # 20d
        {"status": "confirmed", "arrival": "2026-09-01", "booking_time": "2026-06-01"},  # 92d
        {"status": "cancelled", "arrival": "2026-06-10", "booking_time": "2026-06-01"},  # excluded
    ]
    lt = M.lead_time_buckets(bookings)
    check("lead_0_7", lt["0-7d"], 1)
    check("lead_8_30", lt["8-30d"], 1)
    check("lead_91plus", lt["91d+"], 1)


if __name__ == "__main__":
    print("Running metric unit tests...")
    test_occupancy_and_rates()
    test_proration_across_boundary()
    test_channel_mix()
    test_lead_time()
    if failures:
        print(f"\n{len(failures)} FAILURE(S): {failures}")
        sys.exit(1)
    print("\nAll metric tests passed.")
