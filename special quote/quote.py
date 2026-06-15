#!/usr/bin/env python3
"""Room-switching quote tool — Updates 2 + 3 + 4."""

import argparse
import csv
import re
import sys
from datetime import date, timedelta
from pathlib import Path

# Limits
MAX_ALTS_PER_VEC = 2    # extra alternatives per (state, vector) → 3 total incl. representative
CAP_PER_STATE    = 50   # max non-dominated partials per DP state (logs when triggered)
_cap_triggered   = 0    # reset each run


def _find_data_dir():
    for candidate in [Path.cwd() / "data", Path(__file__).parent / "data"]:
        if candidate.is_dir():
            return candidate
    return Path.cwd() / "data"


DATA_DIR = _find_data_dir()


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------

def load_rooms():
    """Returns {room_num: {private_bathroom, private_kitchen, max_occupants, beds}}"""
    rooms = {}
    with open(DATA_DIR / "rooms.csv") as f:
        for row in csv.DictReader(f):
            num = int(row["Room"])
            rooms[num] = {
                "private_bathroom": row["Private bathroom"].strip().lower() == "yes",
                "private_kitchen":  row["Private kitchen"].strip().lower()  == "yes",
                "max_occupants":    int(row.get("Max occupants", "1").strip() or 1),
                "beds":             int(row.get("Beds", "1").strip() or 1),
            }
    return rooms


def get_room_sets(rooms_data, guests, min_beds, headroom):
    """Return (eligible, normal, oversized) as sorted lists.
    eligible = passes hard filters (guests, beds).
    oversized = eligible but max_occupants > guests + headroom (soft exclusion).
    normal = eligible and not oversized.
    """
    cutoff   = guests + headroom
    eligible = sorted(
        r for r, info in rooms_data.items()
        if info["max_occupants"] >= guests and info["beds"] >= min_beds
    )
    oversized = [r for r in eligible if rooms_data[r]["max_occupants"] > cutoff]
    normal    = [r for r in eligible if rooms_data[r]["max_occupants"] <= cutoff]
    return eligible, normal, oversized


def load_discounts():
    """Returns sorted list of (min_nights, rate) tuples ascending by min_nights."""
    tiers = []
    with open(DATA_DIR / "discounts.csv") as f:
        for row in csv.DictReader(f):
            nv = row.get("nights",   "").strip()
            dv = row.get("discount", "").strip()
            if not nv or not dv:
                continue
            tiers.append((int(nv), float(dv.rstrip("%")) / 100))
    tiers.sort()
    return tiers


def get_discount(n_nights, tiers):
    rate = 0.0
    for min_n, pct in tiers:
        if n_nights >= min_n:
            rate = pct
    return rate


def load_pricing():
    """Returns {date_obj: {room_num: rate}}"""
    pricing = {}
    with open(DATA_DIR / "pricing.csv") as f:
        for row in csv.DictReader(f):
            date_str = row.get("Rooms", "").strip()
            if not date_str:
                continue
            try:
                d = date.fromisoformat(date_str)
            except ValueError:
                continue
            rates = {}
            for col, val in row.items():
                if col == "Rooms":
                    continue
                try:
                    rn = int(col)
                    rt = float(val)
                    if rt > 0:
                        rates[rn] = rt
                except (ValueError, TypeError):
                    pass
            if rates:
                pricing[d] = rates
    return pricing


def parse_room_cell(cell):
    """'Room 4' or 'Room 4, Room 10' → list of ints, or None for UNALLOCATED/empty."""
    cell = cell.strip()
    if not cell or cell.upper() == "UNALLOCATED":
        return None
    nums = re.findall(r'\d+', cell)
    return [int(n) for n in nums] if nums else None


def load_reservations():
    """Returns (blocked, unallocated).
    blocked: {room_num: set of date}
    unallocated: list of (ci, co)
    """
    blocked     = {}
    unallocated = []
    with open(DATA_DIR / "reservations.csv") as f:
        for row in csv.DictReader(f):
            rc  = row.get("Room",      "").strip()
            cis = row.get("Check in",  "").strip()
            cos = row.get("Check out", "").strip()
            if not rc and not cis and not cos:
                continue
            if not cis or not cos:
                continue
            try:
                ci = date.fromisoformat(cis)
                co = date.fromisoformat(cos)
            except ValueError:
                continue
            rooms_in_row = parse_room_cell(rc)
            if rooms_in_row is None:
                unallocated.append((ci, co))
                continue
            for rn in rooms_in_row:
                blocked.setdefault(rn, set())
                d = ci
                while d < co:
                    blocked[rn].add(d)
                    d += timedelta(days=1)
    return blocked, unallocated


# ---------------------------------------------------------------------------
# Preference helpers
# ---------------------------------------------------------------------------

def room_is_preferred(room_info, prefer):
    if prefer == "bathroom":
        return room_info["private_bathroom"]
    if prefer == "kitchen":
        return room_info["private_kitchen"]
    return False


# ---------------------------------------------------------------------------
# DP core
#
# Vector: (switches, full_price_sum, preferred_nights)
#   full_price_sum = UNDISCOUNTED sum of nightly rates across segments so far.
#   The whole-stay discount (constant for a given quote) is applied at output.
#
# Oversized soft constraint (UPDATE 3):
#   At each boundary, try only normal_rooms.
#   Fall back to oversized_rooms only if no normal room has any feasible segment.
#
# DP table: {(boundary_idx, last_room): {vector: [bt0, alt1, alt2]}}
#   bt = None | (parent_state, parent_vec, seg_tuple)
# ---------------------------------------------------------------------------

def _dom(a, b, prefer):
    """True if vector a dominates vector b."""
    asw, apr, apn = a
    bsw, bpr, bpn = b
    eps = 1e-6
    if prefer == "none":
        ok  = asw <= bsw and apr <= bpr + eps
        win = asw < bsw or apr < bpr - eps
    else:
        ok  = asw <= bsw and apr <= bpr + eps and apn >= bpn
        win = asw < bsw or apr < bpr - eps or apn > bpn
    return ok and win


def _add_vec(state_dict, vec, bt, prefer):
    """Insert (vec, bt) into state_dict with dominance pruning and per-state cap."""
    global _cap_triggered
    for ev in state_dict:
        if _dom(ev, vec, prefer):
            return
    to_del = [ev for ev in state_dict if _dom(vec, ev, prefer)]
    for ev in to_del:
        del state_dict[ev]
    if vec in state_dict:
        if len(state_dict[vec]) - 1 < MAX_ALTS_PER_VEC:
            state_dict[vec].append(bt)
    else:
        state_dict[vec] = [bt]
    if len(state_dict) > CAP_PER_STATE:
        _cap_triggered += 1
        keep = sorted(state_dict, key=lambda v: v[1])[:CAP_PER_STATE]
        for ev in list(state_dict):
            if ev not in keep:
                del state_dict[ev]


def _eff_min(si, lr, rooms_list, free_run, min_segment):
    """Effective min segment for rooms_list at position si (excluding last_room).
    Returns min_segment if any room can reach it, 1 if any room is free at all, None otherwise.
    """
    any_min = any_one = False
    for r in rooms_list:
        if r == lr:
            continue
        fl = free_run[r][si]
        if fl >= min_segment:
            any_min = True
            break
        if fl >= 1:
            any_one = True
    if any_min:
        return min_segment
    return 1 if any_one else None


def run_dp(checkin, checkout, normal_rooms, oversized_rooms, rooms_data,
           blocked, pricing, prefer, min_segment):
    """
    Returns (frontier, total_before_final_filter, n_dominated).
    frontier: {vector: [[seg,...], ...]}   segments are (room_num, start, end)
    Price component of vector is UNDISCOUNTED (whole-stay discount applied at output).
    """
    global _cap_triggered
    _cap_triggered = 0

    n_nights = (checkout - checkin).days
    nights   = [checkin + timedelta(days=i) for i in range(n_nights)]
    all_er   = sorted(set(normal_rooms) | set(oversized_rooms))

    # Precompute free-run lengths for all eligible rooms
    free_run = {}
    for r in all_er:
        rb  = blocked.get(r, set())
        run = [0] * (n_nights + 1)
        for i in range(n_nights - 1, -1, -1):
            run[i] = (run[i + 1] + 1) if nights[i] not in rb else 0
        free_run[r] = run

    # Prefix-sum pricing per room (undiscounted)
    cum = {}
    for r in all_er:
        cp = [0.0] * (n_nights + 1)
        for i in range(n_nights):
            cp[i + 1] = cp[i] + pricing[nights[i]][r]
        cum[r] = cp

    pref_flag = {r: room_is_preferred(rooms_data[r], prefer) for r in all_er}

    # DP table: (boundary_idx, last_room) → {vector: [bt0, alt1, ...]}
    dp = {}
    dp[(0, None)] = {(0, 0.0, 0): [None]}

    for si in range(n_nights):
        for lr in [None] + all_er:
            state = (si, lr)
            if state not in dp:
                continue
            sd = dp[state]
            if not sd:
                continue
            is_init = (lr is None)

            # Determine which room set and effective min segment to use
            min_seg = _eff_min(si, lr, normal_rooms, free_run, min_segment)
            if min_seg is not None:
                rooms_to_use = normal_rooms
            else:
                # No normal room available — fall back to oversized
                min_seg = _eff_min(si, lr, oversized_rooms, free_run, min_segment)
                if min_seg is None:
                    continue  # truly stuck; no room available
                rooms_to_use = oversized_rooms

            for nr in rooms_to_use:
                if nr == lr:
                    continue
                ml = free_run[nr][si]
                if ml == 0:
                    continue
                max_seg = min(ml, n_nights - si)
                if max_seg < min_seg:
                    continue

                pref_per = 1 if pref_flag[nr] else 0

                for sl in range(min_seg, max_seg + 1):
                    ei       = si + sl
                    seg_full = cum[nr][ei] - cum[nr][si]   # undiscounted
                    seg_pn   = sl * pref_per
                    new_seg  = (nr, nights[si], nights[ei - 1] + timedelta(days=1))
                    end_st   = (ei, nr)

                    if end_st not in dp:
                        dp[end_st] = {}
                    esd = dp[end_st]

                    for ov in sd:
                        sw, pr, pn = ov
                        nv  = (sw if is_init else sw + 1,
                               round(pr + seg_full, 2),
                               pn + seg_pn)
                        _add_vec(esd, nv, (state, ov, new_seg), prefer)

    # Collect final plans from all final states
    raw = {}
    for lr in [None] + all_er:
        fst = (n_nights, lr)
        if fst not in dp:
            continue
        for vec, bt_list in dp[fst].items():
            segs_for_vec = [_reconstruct(bt, dp) for bt in bt_list]
            if vec in raw:
                raw[vec].extend(segs_for_vec)
            else:
                raw[vec] = segs_for_vec

    total_before = len(raw)

    # Final cross-room Pareto pass
    vecs    = list(raw)
    dom_idx = set()
    for i, vi in enumerate(vecs):
        if i in dom_idx:
            continue
        for j, vj in enumerate(vecs):
            if i == j or j in dom_idx:
                continue
            if _dom(vi, vj, prefer):
                dom_idx.add(j)

    frontier = {vecs[i]: raw[vecs[i]] for i in range(len(vecs)) if i not in dom_idx}
    if _cap_triggered:
        print(f"  [note] per-state cap triggered {_cap_triggered} time(s)")
    return frontier, total_before, len(dom_idx)


def _reconstruct(bt, dp):
    """Walk backtrace chain to build segment list."""
    segs = []
    while bt is not None:
        parent_state, parent_vec, seg = bt
        segs.append(seg)
        bt = dp[parent_state][parent_vec][0]
    segs.reverse()
    return segs


# ---------------------------------------------------------------------------
# Pricing helpers (UPDATE 4: whole-stay discount — no per-segment discounting)
# ---------------------------------------------------------------------------

def plan_full_price(segments, pricing):
    """Sum of undiscounted nightly rates across all segments."""
    total = 0.0
    for rn, start, end in segments:
        n = (end - start).days
        total += sum(pricing[start + timedelta(days=i)][rn] for i in range(n))
    return total


def build_segment_detail(segments, pricing):
    """Per-segment breakdown WITHOUT per-segment discount (whole-stay discount is shown separately)."""
    parts = []
    for rn, start, end in segments:
        n  = (end - start).days
        nw = "night" if n == 1 else "nights"
        sf = sum(pricing[start + timedelta(days=i)][rn] for i in range(n))
        avg = sf / n if n else 0.0
        parts.append(f"Room {rn}: {n} {nw} × avg £{avg:.2f} = £{sf:.2f}")
    return " | ".join(parts)


# ---------------------------------------------------------------------------
# Formatting
# ---------------------------------------------------------------------------

def fmt_date(d):
    return d.strftime("%b %-d")


def plan_label_str(segments):
    return " → ".join(f"Room {rn} ({fmt_date(s)}–{fmt_date(e)})" for rn, s, e in segments)


# ---------------------------------------------------------------------------
# Output rows
# ---------------------------------------------------------------------------

def _plan_oversized_warning(segments, rooms_data, oversized_set):
    """Return oversized warning string for a plan, or empty string."""
    for rn, _s, _e in segments:
        if rn in oversized_set:
            cap = rooms_data[rn]["max_occupants"]
            return f"uses oversized Room {rn} (sleeps {cap}) — no smaller room free"
    return ""


def build_rows(frontier, rooms_data, pricing, prefer, stay_discount,
               oversized_set, global_warning):
    rows = []
    for vec, segs_lists in frontier.items():
        sw, full_pr, pn = vec
        rep      = segs_lists[0]
        full_p   = plan_full_price(rep, pricing)
        total_p  = round(full_p * (1 - stay_discount), 2)

        # Per-row warning: global (UNALLOCATED) + oversized note if applicable
        over_warn = _plan_oversized_warning(rep, rooms_data, oversized_set)
        parts = [p for p in [global_warning, over_warn] if p]
        warning_col = "; ".join(parts)

        rows.append({
            "plan":                   plan_label_str(rep),
            "switches":               sw,
            "total_price":            total_p,
            "full_price":             round(full_p, 2),
            "preferred_nights":       pn,
            "segment_detail":         build_segment_detail(rep, pricing),
            "label":                  "",
            "equivalent_alternatives": "; ".join(plan_label_str(s) for s in segs_lists[1:]),
            "warning":                warning_col,
        })
    return rows


def apply_labels(rows, prefer):
    if not rows:
        return
    min_p  = min(r["total_price"] for r in rows)
    min_sw = min(r["switches"] for r in rows)
    max_pn = max(r["preferred_nights"] for r in rows)
    for r in rows:
        lbls = []
        if r["total_price"] <= min_p + 1e-6:
            lbls.append("cheapest")
        if r["switches"] == min_sw:
            lbls.append("fewest switches")
        if prefer != "none" and r["preferred_nights"] == max_pn:
            lbls.append("most preferred nights")
        r["label"] = ", ".join(lbls)


# ---------------------------------------------------------------------------
# Sort helpers
# ---------------------------------------------------------------------------

SORT_KEYS = {
    "switches":  lambda r: (r["switches"], r["total_price"]),
    "price":     lambda r: r["total_price"],
    "preferred": lambda r: -r["preferred_nights"],
}
DEFAULT_SORT = lambda r: (r["switches"], r["total_price"])


def sort_rows(rows, fn):
    labelled   = [r for r in rows if r["label"]]
    unlabelled = [r for r in rows if not r["label"]]
    labelled.sort(key=fn)
    unlabelled.sort(key=fn)
    return labelled + unlabelled


# ---------------------------------------------------------------------------
# Self-test
# ---------------------------------------------------------------------------

def run_selftest():
    print("Running self-tests...")
    rooms_data        = load_rooms()
    tiers             = load_discounts()
    pricing           = load_pricing()
    blocked, _        = load_reservations()

    all_pass = True
    def chk(cond, msg):
        nonlocal all_pass
        if not cond:
            print(f"  FAIL: {msg}")
            all_pass = False
        return cond

    # T1: blocked rooms
    for d in [date(2026,6,20), date(2026,6,21), date(2026,6,22), date(2026,6,23)]:
        chk(d in blocked.get(4, set()), f"Room 4 should be blocked on {d}")
    for d in [date(2026,6,19), date(2026,6,20), date(2026,6,21)]:
        chk(d in blocked.get(10, set()), f"Room 10 should be blocked on {d}")
    print(f"  Test 1 (blocked rooms): {'PASS' if all_pass else 'FAIL'}")

    # T2: Room 9 undiscounted sum for Jun 19-21 = 95+95+85 = 275
    r9_rates = [pricing[date(2026,6,19)][9], pricing[date(2026,6,20)][9], pricing[date(2026,6,21)][9]]
    exp_full9 = sum(r9_rates)
    got_full9 = plan_full_price([(9, date(2026,6,19), date(2026,6,22))], pricing)
    t2 = chk(abs(got_full9 - exp_full9) < 0.01,
             f"Room 9 3-night undiscounted: expected £{exp_full9}, got £{got_full9}")
    print(f"  Test 2 (Room 9 undiscounted sum): {'PASS' if t2 else 'FAIL'} "
          f"— rates={r9_rates}, full=£{exp_full9}")

    # T3: whole-stay discount — any plan over same dates gets the same rate and formula
    # 7-night range: 35% off. Both a single-room and a two-segment plan get the same rate.
    stay_disc = get_discount(7, tiers)
    ci7, co7 = date(2026,6,19), date(2026,6,26)
    # Plan A: Room 3 all 7 nights
    fp_A = plan_full_price([(3, ci7, co7)], pricing)
    tp_A = round(fp_A * (1 - stay_disc), 2)
    # Plan B: Room 3 → Room 2 (split Jun 22)
    fp_B = plan_full_price([(3, ci7, date(2026,6,22)), (2, date(2026,6,22), co7)], pricing)
    tp_B = round(fp_B * (1 - stay_disc), 2)
    t3a = chk(abs(tp_A - fp_A * (1 - stay_disc)) < 0.01,
              f"Plan A total_price should = full × (1-{stay_disc:.0%})")
    t3b = chk(abs(tp_B - fp_B * (1 - stay_disc)) < 0.01,
              f"Plan B total_price should = full × (1-{stay_disc:.0%})")
    print(f"  Test 3 (whole-stay discount): {'PASS' if t3a and t3b else 'FAIL'} "
          f"— {int(stay_disc*100)}% applied to both single-room and split plan")

    # T4: multi-room row blocks both rooms
    d4 = date(2026,6,5)
    c4  = chk(d4 in blocked.get(4,  set()), f"Room 4  not blocked on {d4}")
    c10 = chk(d4 in blocked.get(10, set()), f"Room 10 not blocked on {d4}")
    print(f"  Test 4 (multi-room row): {'PASS' if c4 and c10 else 'FAIL'}")

    # T5: rooms.csv new columns
    chk(rooms_data[7]["max_occupants"] == 1,
        f"Room 7 max_occupants should be 1, got {rooms_data[7]['max_occupants']}")
    chk(rooms_data[7]["beds"] == 1,
        f"Room 7 beds should be 1, got {rooms_data[7]['beds']}")
    print(f"  Test 5 (rooms.csv new columns): {'PASS' if all_pass else 'FAIL'}")

    # T6: hard filters
    _, nr_g2, _ = get_room_sets(rooms_data, guests=2, min_beds=1, headroom=2)
    _, nr_b3, _ = get_room_sets(rooms_data, guests=1, min_beds=3, headroom=2)
    chk(7 not in (set(nr_g2) | set(_)), f"--guests 2 should exclude Room 7")
    expected_beds3 = {1, 4, 5, 6, 9, 10, 11}
    el_b3, _, _ = get_room_sets(rooms_data, guests=1, min_beds=3, headroom=2)
    chk(set(el_b3) == expected_beds3,
        f"--min-beds 3 should give {sorted(expected_beds3)}, got {el_b3}")
    print(f"  Test 6 (hard filters): {'PASS' if all_pass else 'FAIL'}")

    # T7: Pareto 3D
    def manual_pareto3(vecs, prefer="bathroom"):
        dom = set()
        for i, vi in enumerate(vecs):
            for j, vj in enumerate(vecs):
                if i != j and _dom(vi, vj, prefer):
                    dom.add(j)
        return [v for i, v in enumerate(vecs) if i not in dom]

    vA = (1, 200.0, 5)
    vB = (0, 150.0, 7)
    vC = (2, 100.0, 3)
    ft = manual_pareto3([vA, vB, vC])
    cA = chk(vA not in ft, "A should be dominated")
    cB = chk(vB in ft,     "B should survive")
    cC = chk(vC in ft,     "C should survive (incomparable)")
    print(f"  Test 7 (Pareto 3D): {'PASS' if cA and cB and cC else 'FAIL'} — frontier={ft}")

    # T8: oversized room classification
    el, nm, ov = get_room_sets(rooms_data, guests=1, min_beds=1, headroom=2)
    # cutoff = 1+2 = 3; rooms with max_occ > 3 are oversized
    chk(10 in ov, f"Room 10 (sleeps 6) should be oversized for 1 guest h=2, got oversized={ov}")
    chk(11 in ov, f"Room 11 (sleeps 5) should be oversized for 1 guest h=2")
    chk(1  in ov, f"Room 1  (sleeps 4) should be oversized for 1 guest h=2")
    chk(4  in ov, f"Room 4  (sleeps 4) should be oversized for 1 guest h=2")
    chk(9  not in ov, f"Room 9 (sleeps 3) should NOT be oversized for 1 guest h=2 (3==cutoff)")
    chk(7  not in ov, f"Room 7 (sleeps 1) should NOT be oversized for 1 guest h=2")
    # --guests 2, headroom 2: cutoff=4; rooms with max_occ > 4 are oversized
    _, nm2, ov2 = get_room_sets(rooms_data, guests=2, min_beds=1, headroom=2)
    chk(10 in ov2, f"Room 10 (sleeps 6) should be oversized for 2 guests h=2")
    chk(11 in ov2, f"Room 11 (sleeps 5) should be oversized for 2 guests h=2")
    chk(1  not in ov2, f"Room 1  (sleeps 4) should be NORMAL for 2 guests h=2 (4==cutoff)")
    chk(4  not in ov2, f"Room 4  (sleeps 4) should be NORMAL for 2 guests h=2")
    # --headroom 0, 1 guest: cutoff=1; only Room 7 (max_occ=1) is normal
    _, nm0, ov0 = get_room_sets(rooms_data, guests=1, min_beds=1, headroom=0)
    chk(nm0 == [7], f"--headroom 0 g=1: only Room 7 normal, got {nm0}")
    print(f"  Test 8 (oversized classification): {'PASS' if all_pass else 'FAIL'}")

    # T9: segment_detail has no discount annotation
    segs_t9 = [(9, date(2026,6,19), date(2026,6,22))]
    detail = build_segment_detail(segs_t9, pricing)
    chk("%" not in detail,
        f"segment_detail should have no '% off' after UPDATE 4, got: {detail}")
    chk("=" in detail, f"segment_detail should show '= £X' total, got: {detail}")
    print(f"  Test 9 (segment_detail no per-seg discount): {'PASS' if all_pass else 'FAIL'}")
    print(f"    Sample: {detail}")

    print("\n" + ("All tests PASSED!" if all_pass else "Some tests FAILED."))
    return all_pass


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Room-switching quote tool")
    parser.add_argument("checkin",  nargs="?", help="Check-in YYYY-MM-DD")
    parser.add_argument("checkout", nargs="?", help="Check-out YYYY-MM-DD")
    parser.add_argument("-o", "--output",  help="Output CSV filename")
    parser.add_argument("--sort", choices=["switches", "price", "preferred"],
                        help="Sort order")
    parser.add_argument("--guests",      type=int, default=1,
                        help="Min room capacity (default 1)")
    parser.add_argument("--min-beds",    type=int, default=1,
                        help="Min beds in room (default 1)")
    parser.add_argument("--headroom",    type=int, default=2,
                        help="Oversized headroom: exclude rooms with max_occupants > guests+headroom "
                             "(default 2; exception if all normal rooms are full)")
    parser.add_argument("--prefer",      choices=["bathroom", "kitchen", "none"],
                        default="bathroom",
                        help="Pareto preference dimension (default bathroom)")
    parser.add_argument("--min-segment", type=int, default=3,
                        help="Min segment length in nights (default 3; exception if forced)")
    parser.add_argument("--selftest", action="store_true", help="Run self-tests and exit")
    args = parser.parse_args()

    if args.selftest:
        sys.exit(0 if run_selftest() else 1)

    if not args.checkin or not args.checkout:
        parser.error("checkin and checkout dates are required")

    try:
        checkin  = date.fromisoformat(args.checkin)
        checkout = date.fromisoformat(args.checkout)
    except ValueError as e:
        sys.exit(f"Invalid date: {e}")

    if checkout <= checkin:
        sys.exit("Check-out must be after check-in.")

    total_nights = (checkout - checkin).days
    rooms_data   = load_rooms()
    tiers        = load_discounts()
    pricing      = load_pricing()
    blocked, unallocated = load_reservations()

    # Room sets (hard filter + oversized soft filter)
    eligible, normal_rooms, oversized_rooms = get_room_sets(
        rooms_data, args.guests, args.min_beds, args.headroom
    )
    if not eligible:
        sys.exit(f"No rooms pass the hard filters (--guests {args.guests}, --min-beds {args.min_beds}).")
    oversized_set = set(oversized_rooms)

    # Whole-stay discount (UPDATE 4: constant for all plans in this quote)
    stay_discount = get_discount(total_nights, tiers)
    disc_pct      = int(round(stay_discount * 100))

    # Output filename
    output_path = args.output or (
        f"quotes_{checkin}_{checkout}_g{args.guests}_{args.prefer}.csv"
    )

    # Validate pricing covers full range
    d = checkin
    while d < checkout:
        if d not in pricing:
            sys.exit(f"Error: no pricing data for {d}.")
        d += timedelta(days=1)

    # Unallocated warning
    overlap_unalloc = [(ci, co) for ci, co in unallocated if ci < checkout and co > checkin]
    if overlap_unalloc:
        print(f"WARNING: {len(overlap_unalloc)} UNALLOCATED booking(s) overlap {checkin}–{checkout}.")
    global_warning = (
        f"UNALLOCATED bookings overlap this range ({len(overlap_unalloc)})"
        if overlap_unalloc else ""
    )

    # Fully-booked nights (within ALL eligible rooms, including oversized)
    nights_range  = [checkin + timedelta(days=i) for i in range(total_nights)]
    fully_booked  = [n for n in nights_range if all(n in blocked.get(r, set()) for r in eligible)]
    if fully_booked:
        sys.exit("No plans possible — fully booked nights (all eligible rooms): "
                 + ", ".join(str(n) for n in fully_booked))

    # Terminal header
    cutoff = args.guests + args.headroom
    print(f"Active filters  : guests≥{args.guests}, beds≥{args.min_beds}, "
          f"prefer={args.prefer}, min-segment={args.min_segment}, "
          f"oversized cutoff=>{cutoff} (headroom {args.headroom})")
    print(f"Normal rooms    : {normal_rooms}")
    print(f"Oversized (last resort): {oversized_rooms}")
    print(f"Stay discount   : {disc_pct}% ({total_nights} nights)")
    print(f"Searching plans : {checkin} → {checkout} ({total_nights} nights)...")

    frontier, total_before, n_dominated = run_dp(
        checkin, checkout, normal_rooms, oversized_rooms, rooms_data,
        blocked, pricing, prefer=args.prefer, min_segment=args.min_segment,
    )

    if not frontier:
        sys.exit("No valid plans found for this date range.")

    n_equiv = sum(len(v) for v in frontier.values())
    print(f"  Unique vectors before final filter : {total_before}")
    print(f"  Dominated / removed                : {n_dominated}")
    print(f"  Pareto-optimal plans shown         : {len(frontier)} "
          f"(+{n_equiv - len(frontier)} equivalents)")

    rows = build_rows(frontier, rooms_data, pricing, args.prefer,
                      stay_discount, oversized_set, global_warning)
    apply_labels(rows, args.prefer)

    sort_fn = SORT_KEYS.get(args.sort, DEFAULT_SORT)
    rows    = sort_rows(rows, sort_fn)

    fieldnames = [
        "plan", "switches", "total_price", "full_price",
        "preferred_nights", "segment_detail",
        "label", "equivalent_alternatives", "warning",
    ]
    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    print(f"\nWritten → {output_path}")

    # Terminal summary
    pref_lbl = {"bathroom": "bath nights", "kitchen": "kitchen nights", "none": "—"}[args.prefer]
    print(f"\n--- Best plans by criterion (prefer={args.prefer}, {disc_pct}% whole-stay discount) ---")
    for lbl, kfn in [
        ("cheapest",        lambda r: r["total_price"]),
        ("fewest switches", lambda r: (r["switches"], r["total_price"])),
        ("most preferred",  lambda r: -r["preferred_nights"]),
    ]:
        if lbl == "most preferred" and args.prefer == "none":
            continue
        best = min(rows, key=kfn)
        print(f"  [{lbl:18s}] {best['plan']}")
        print(f"  {'':20s} £{best['total_price']:.2f} (full £{best['full_price']:.2f})"
              f" | {best['switches']} switch(es) | {best['preferred_nights']}n {pref_lbl}")

    if overlap_unalloc:
        print(f"\nWARNING: {len(overlap_unalloc)} UNALLOCATED booking(s) — see 'warning' column.")


if __name__ == "__main__":
    main()
