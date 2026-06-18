"""
Metrics engine — pure functions over the SQLite data produced by fetch.py.

All KPI maths live here so they can be unit-tested independently of the API:
  occupancy, ADR, RevPAR, channel mix, booking pace / pickup vs last year.

Definitions
-----------
available room-nights = sum over rooms of (qty * nights in period)
sold room-nights       = booked nights that fall inside the period (active bookings)
occupancy %            = sold / available
ADR (avg daily rate)   = room revenue / sold room-nights
RevPAR                 = room revenue / available room-nights  (= ADR * occupancy)

Active statuses (count toward revenue/occupancy) default to confirmed + new.
'cancelled' and 'black' (owner blocks) are excluded.
"""

import datetime as dt
import sqlite3
from collections import defaultdict

ACTIVE_STATUSES = {"confirmed", "new", "1"}  # lowercased


def _date(s):
    if not s:
        return None
    try:
        return dt.date.fromisoformat(str(s)[:10])
    except ValueError:
        return None


def _daterange(d0, d1):
    cur = d0
    while cur < d1:
        yield cur
        cur += dt.timedelta(days=1)


def _is_active(status):
    return str(status or "").strip().lower() in ACTIVE_STATUSES


def load_rows(db_path):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    rooms = [dict(r) for r in conn.execute("SELECT * FROM rooms").fetchall()]
    props = [dict(r) for r in conn.execute("SELECT * FROM properties").fetchall()]
    bookings = [dict(r) for r in conn.execute("SELECT * FROM bookings").fetchall()]
    meta = {r[0]: r[1] for r in conn.execute("SELECT key,value FROM meta").fetchall()}
    conn.close()
    return props, rooms, bookings, meta


def total_room_capacity(rooms):
    return sum(int(r.get("qty") or 1) for r in rooms)


def nights_in_period(booking, p_start, p_end):
    """Nights of this booking that fall within [p_start, p_end)."""
    a = _date(booking.get("arrival"))
    d = _date(booking.get("departure"))
    if not a or not d:
        return 0
    lo = max(a, p_start)
    hi = min(d, p_end)
    return max((hi - lo).days, 0)


def revenue_in_period(booking, p_start, p_end):
    """Pro-rate booking price across the nights inside the period."""
    a = _date(booking.get("arrival"))
    d = _date(booking.get("departure"))
    if not a or not d:
        return 0.0
    total_nights = max((d - a).days, 0)
    if total_nights == 0:
        return 0.0
    inside = nights_in_period(booking, p_start, p_end)
    price = float(booking.get("price") or 0)
    return price * inside / total_nights


def occupancy_block(bookings, rooms, p_start, p_end):
    capacity = total_room_capacity(rooms)
    days = (p_end - p_start).days
    available = capacity * days
    sold = 0
    revenue = 0.0
    for b in bookings:
        if not _is_active(b.get("status")):
            continue
        sold += nights_in_period(b, p_start, p_end)
        revenue += revenue_in_period(b, p_start, p_end)
    occ = (sold / available) if available else 0.0
    adr = (revenue / sold) if sold else 0.0
    revpar = (revenue / available) if available else 0.0
    return {
        "period_start": p_start.isoformat(),
        "period_end": p_end.isoformat(),
        "available_room_nights": available,
        "sold_room_nights": sold,
        "occupancy": round(occ, 4),
        "revenue": round(revenue, 2),
        "adr": round(adr, 2),
        "revpar": round(revpar, 2),
    }


def monthly_series(bookings, rooms, months_back=12, months_fwd=6, anchor=None):
    anchor = anchor or dt.date.today().replace(day=1)
    out = []
    # build month starts from months_back before to months_fwd after
    def add_months(d, n):
        y = d.year + (d.month - 1 + n) // 12
        m = (d.month - 1 + n) % 12 + 1
        return dt.date(y, m, 1)

    for i in range(-months_back, months_fwd + 1):
        m_start = add_months(anchor, i)
        m_end = add_months(m_start, 1)
        blk = occupancy_block(bookings, rooms, m_start, m_end)
        blk["label"] = m_start.strftime("%b %Y")
        blk["month"] = m_start.isoformat()
        out.append(blk)
    return out


def channel_mix(bookings, p_start, p_end):
    by = defaultdict(lambda: {"bookings": 0, "nights": 0, "revenue": 0.0})
    for b in bookings:
        if not _is_active(b.get("status")):
            continue
        n = nights_in_period(b, p_start, p_end)
        if n <= 0:
            continue
        key = (b.get("referer") or b.get("channel") or "Direct/Other").strip() or "Direct/Other"
        by[key]["bookings"] += 1
        by[key]["nights"] += n
        by[key]["revenue"] += revenue_in_period(b, p_start, p_end)
    rows = []
    for k, v in by.items():
        rows.append({"channel": k, "bookings": v["bookings"], "nights": v["nights"],
                     "revenue": round(v["revenue"], 2)})
    rows.sort(key=lambda r: r["revenue"], reverse=True)
    return rows


def pace_vs_last_year(bookings, rooms, window_days=90):
    """On-the-books comparison: arrivals in the next `window_days` this year vs the
    same calendar window one year ago."""
    today = dt.date.today()
    this_start, this_end = today, today + dt.timedelta(days=window_days)
    last_start = this_start.replace(year=this_start.year - 1)
    last_end = this_end.replace(year=this_end.year - 1)

    def window_stats(s, e):
        sold = rev = bk = 0
        rev = 0.0
        for b in bookings:
            if not _is_active(b.get("status")):
                continue
            a = _date(b.get("arrival"))
            if a and s <= a < e:
                bk += 1
                sold += nights_in_period(b, s, e)
                rev += revenue_in_period(b, s, e)
        return {"bookings": bk, "sold_room_nights": sold, "revenue": round(rev, 2)}

    this_yr = window_stats(this_start, this_end)
    last_yr = window_stats(last_start, last_end)
    delta_rev = this_yr["revenue"] - last_yr["revenue"]
    pct = (delta_rev / last_yr["revenue"] * 100) if last_yr["revenue"] else None
    return {
        "window_days": window_days,
        "this_year": this_yr,
        "last_year": last_yr,
        "revenue_delta": round(delta_rev, 2),
        "revenue_delta_pct": round(pct, 1) if pct is not None else None,
    }


def lead_time_buckets(bookings):
    """Distribution of booking lead time (arrival - booking_time), active bookings."""
    buckets = {"0-7d": 0, "8-30d": 0, "31-90d": 0, "91d+": 0, "unknown": 0}
    for b in bookings:
        if not _is_active(b.get("status")):
            continue
        a = _date(b.get("arrival"))
        bt = _date(b.get("booking_time"))
        if not a or not bt:
            buckets["unknown"] += 1
            continue
        lead = (a - bt).days
        if lead <= 7:
            buckets["0-7d"] += 1
        elif lead <= 30:
            buckets["8-30d"] += 1
        elif lead <= 90:
            buckets["31-90d"] += 1
        else:
            buckets["91d+"] += 1
    return buckets


def upcoming_feed(bookings, limit=50):
    """Upcoming + recent bookings sorted by arrival, for the bookings feed view."""
    today = dt.date.today()
    rows = []
    for b in bookings:
        a = _date(b.get("arrival"))
        if not a:
            continue
        rows.append({
            "id": b.get("id"),
            "guest": " ".join(x for x in [b.get("first_name"), b.get("last_name")] if x) or "—",
            "property_id": b.get("property_id"),
            "arrival": b.get("arrival"),
            "departure": b.get("departure"),
            "nights": b.get("num_nights"),
            "price": round(float(b.get("price") or 0), 2),
            "channel": b.get("referer") or b.get("channel") or "Direct/Other",
            "status": b.get("status"),
            "days_until": (a - today).days,
        })
    rows.sort(key=lambda r: r["arrival"])
    # keep from 14 days ago onward
    rows = [r for r in rows if r["days_until"] >= -14]
    return rows[:limit]


def build_summary(db_path):
    """Top-level object the dashboard consumes."""
    props, rooms, bookings, meta = load_rows(db_path)
    today = dt.date.today()
    month_start = today.replace(day=1)
    next_month = (month_start.replace(year=month_start.year + 1, month=1)
                  if month_start.month == 12
                  else month_start.replace(month=month_start.month + 1))
    next_30 = today + dt.timedelta(days=30)
    next_90 = today + dt.timedelta(days=90)

    prop_names = {p["id"]: p.get("name") for p in props}
    feed = upcoming_feed(bookings)
    for r in feed:
        r["property"] = prop_names.get(r["property_id"], r["property_id"])

    return {
        "generated_at": dt.datetime.now().isoformat(timespec="seconds"),
        "last_fetch": meta.get("last_fetch"),
        "currency": (props[0]["currency"] if props and props[0].get("currency") else ""),
        "properties": [{"id": p["id"], "name": p.get("name")} for p in props],
        "room_capacity": total_room_capacity(rooms),
        "kpi_this_month": occupancy_block(bookings, rooms, month_start, next_month),
        "kpi_next_30": occupancy_block(bookings, rooms, today, next_30),
        "kpi_next_90": occupancy_block(bookings, rooms, today, next_90),
        "monthly": monthly_series(bookings, rooms),
        "channel_mix": channel_mix(bookings, today.replace(month=1, day=1),
                                   today.replace(month=12, day=31)),
        "pace": pace_vs_last_year(bookings, rooms),
        "lead_time": lead_time_buckets(bookings),
        "feed": feed,
        "counts": {"properties": len(props), "rooms": len(rooms), "bookings": len(bookings)},
    }
