# Build: Room-Switching Quote Tool

Build a Python CLI tool (`quote.py`) that, given a check-in and check-out date, finds every way a guest can stay at the property for the full date range — including plans that require switching rooms — and writes all plans to a CSV the user can sort.

## Usage

```
python quote.py 2026-06-19 2026-06-26
python quote.py 2026-06-19 2026-06-26 --sort price        # optional pre-sort
python quote.py 2026-06-19 2026-06-26 -o myquote.csv      # optional output name
```

- Two positional args: check-in date, check-out date (YYYY-MM-DD).
- Default output: `quotes_<checkin>_<checkout>.csv` in the current directory.
- `--sort` accepts: `switches` (fewest first), `price` (lowest first), `bathroom` (most private-bathroom nights first), `bathroom_kitchen` (most private bathroom+kitchen nights first). Default sort: fewest switches, then lowest price.

## Input data (in `data/`, all CSVs)

1. **`data/rooms.csv`** — columns: `Property, Room, Private bathroom, Private kitchen`. 11 rooms, values Yes/No. Room 9 is the only one with a private kitchen (it also has a private bathroom).

2. **`data/reservations.csv`** — columns: `Room, Check in, Check out`. Parsing rules:
   - Skip rows where all fields are empty.
   - Room values look like `Room 4`. Extract the number.
   - Some rows list multiple rooms in one quoted cell, e.g. `"Room 4, Room 10"` — that booking blocks ALL listed rooms.
   - A reservation occupies its room for nights `[check-in, check-out)` — checkout day is free for the next guest.
   - Rows with dates but an empty or `UNALLOCATED` room: do NOT block any room. Instead, if any such booking overlaps the requested date range, print a terminal warning and set the `warning` column (see output) — these are bookings that will eventually need a room.

3. **`data/pricing.csv`** — first column is the date, remaining columns are nightly rates for rooms 1–11 (header row: `Rooms,1,2,...,11`). Ignore trailing rows with empty dates / all-zero rates. If the requested range includes a date not present in the table, fail with a clear error.

4. **`data/discounts.csv`** — `nights,discount`: 2→20%, 3→26%, 5→32%, 7→35%. Apply the nearest tier at or below the segment length:
   - 1 night: 0%
   - 2 nights: 20%
   - 3–4 nights: 26%
   - 5–6 nights: 32%
   - 7+ nights: 35%

   Read tiers from the CSV (don't hardcode) so the user can edit them.

## Core logic

1. **Availability grid.** For each room and each night in `[check-in, check-out)`, the room is free that night iff no room-specific reservation covers it.

2. **Enumerate switching plans.** A plan is an ordered list of segments `(room, start_date, end_date)` covering the full range with no gaps, where each room is free for every night of its segment and consecutive segments use different rooms. Enumerate ALL such plans (DFS over segment start dates: at each position, for each room free that night, extend the segment night by night, branching a segment end at every possible point). No constraints on segment length or number of switches — show everything.
   - This explodes combinatorially for long stays. Safeguard: add `--max-plans N` (default 50,000). If the cap is hit, keep generation exhaustive per switch-count tier (generate 0-switch plans, then 1-switch, etc., stopping cleanly between tiers) and note in terminal output that the list was truncated at the cap.

3. **Pricing a plan.** For each segment: sum the nightly rates for the segment's room over its nights, then multiply by `(1 - discount)` where the discount is based on that segment's length only (NOT total stay length). Plan price = sum of segment prices. Round to 2 dp.

4. **Comfort metrics.** For each plan count: nights in a room with a private bathroom; nights in a room with both private bathroom AND private kitchen (per rooms.csv).

5. **Pareto filtering (display logic).** Generate all plans internally, then only output plans that represent a genuine trade-off:
   - The four criteria are: switches (lower better), total_price (lower better), nights_private_bathroom (higher better), nights_private_bath_and_kitchen (higher better).
   - Plan B is **dominated** if some plan A is at least as good as B on all four criteria and strictly better on at least one. Drop all dominated plans — only the Pareto frontier is written to the CSV.
   - **Tie collapsing:** if two surviving plans have identical values on all four criteria (e.g. same dates in Room 5 vs Room 6 at the same rate), output only one row and list the alternatives in an `equivalent_alternatives` column (e.g. `Room 6 (Jun 19–Jun 26)`).
   - Print to terminal: total plans generated, number dominated/removed, number shown.
   - The `--max-plans` cap remains purely an internal generation safeguard; the displayed list is the filtered frontier.

6. **Performance for long stays (replace brute-force enumeration).** A 56-night quote hits the 50,000-plan cap and takes ~10 minutes, and capped results are incomplete (only low switch-count tiers). Since only the Pareto frontier is displayed, full enumeration is wasted work. Rewrite the search as dominance-pruned dynamic programming over segments:
   - **State:** `(boundary_date, last_room)` — the guest has covered all nights up to `boundary_date`, having just finished a segment in `last_room`.
   - **Partial-plan vector:** `(switches, price_so_far, bath_nights, bath_kitchen_nights)` plus the segment list for reconstruction.
   - Process states in date order. From each state, branch every feasible next segment (each room ≠ last_room, each feasible segment end date), pricing the segment with its own length-based discount as before.
   - **Prune at each state:** among partial plans arriving at the same `(boundary_date, last_room)`, discard any whose vector is dominated (another partial at the same state is ≥ as good on all four criteria, strictly better on one). This is safe because the remaining stay is identical for everything at the same state — a dominated partial can never end up on the final frontier. Keep equal-vector partials grouped for the `equivalent_alternatives` column.
   - Final answer: merge all partials at states where `boundary_date = check-out`, run one last dominance pass across them, and output that frontier.
   - This makes the result exact (no cap, no truncation) and fast even for multi-month stays. Remove `--max-plans` or keep it only as an emergency memory guard with a very high default.
   - Verify: on a short range (e.g. 5 nights) run both the old brute-force and the DP and confirm identical frontiers; confirm the 56-night quote (2026-06-17 + 56 nights) completes in seconds and its frontier is at least as good on every criterion as the capped run's best plans (£3,393 cheapest / 3-switch £3,856 / etc.).

7. **Headline labels.** Add a `label` column. Mark the surviving plan that is best in each category: `cheapest`, `fewest switches`, `most private bathroom nights`, `most private bath+kitchen nights`. A plan best in several categories gets all labels (comma-separated, e.g. `cheapest, fewest switches`); ties on a category share the label; plans best in none get an empty label. Sort the CSV with labelled plans first (default sort still applies within).

## Output CSV columns

| column | meaning |
|---|---|
| `plan` | human-readable map, e.g. `Room 9 (Jun 19–Jun 22) → Room 2 (Jun 22–Jun 26)` (dates shown are the nights span; second date = switch/checkout day) |
| `switches` | number of room changes (single-room plan = 0) |
| `total_price` | discounted total, £ |
| `full_price` | undiscounted total (nice for showing guests the saving) |
| `nights_private_bathroom` | count |
| `nights_private_bath_and_kitchen` | count |
| `segment_detail` | per-segment breakdown: `Room 9: 3 nights × avg £70.00, 26% off = £155.40 \| Room 2: ...` |
| `label` | headline label(s): `cheapest`, `fewest switches`, `most private bathroom nights`, `most private bath+kitchen nights`, or empty |
| `equivalent_alternatives` | other plans identical on all four criteria, collapsed into this row; empty if none |
| `warning` | `UNALLOCATED bookings overlap this range (n)` or empty |

Also print a short terminal summary: number of plans found, best plan by each of the four sort criteria, and any unallocated-booking warning.

## Edge cases & validation

- Check-out must be after check-in; both must be valid dates.
- If NO plan covers the range (some night has zero free rooms), say so and report which nights are fully booked.
- Reservations entirely outside the requested range are irrelevant.
- The reservations file contains past bookings and far-future bookings — handle any date range the pricing table covers.
- Dedupe identical plans (the DFS as described shouldn't produce duplicates, but verify).

## UPDATE 2 — guest requirements, single preference, performance fixes (apply to existing quote.py)

`data/rooms.csv` has been replaced and now has two extra columns: `Max occupants` (int) and `Beds` (int). Reload it accordingly.

### A. Hard filters (applied BEFORE the search — these shrink the room set)

- `--guests N` (default 1): only rooms with `Max occupants >= N` are eligible. e.g. `--guests 2` removes Room 7 entirely.
- `--min-beds N` (optional): only rooms with `Beds >= N`. For groups wanting separate beds.
- If the filters leave no eligible rooms, say so clearly.

### B. Single preference replaces the two comfort dimensions

The 4-dimension frontier (switches, price, bath nights, bath+kitchen nights) produces too many incomparable plans and was a major cause of search blowup. Replace it with a 3-dimension frontier:

- `--prefer bathroom|kitchen|none` (default `bathroom`). The third frontier dimension is `preferred_nights`: nights spent in a room matching the preference (bathroom → `Private bathroom = Yes`; kitchen → `Private kitchen = Yes`; none → drop the dimension entirely, frontier is just switches + price).
- Dominance, tie-collapsing, labels, and DP state pruning all now use (switches, price, preferred_nights).
- Output CSV: replace `nights_private_bathroom` and `nights_private_bath_and_kitchen` with one `preferred_nights` column (header can note the preference used). Labels become: `cheapest`, `fewest switches`, `most preferred nights`.
- Print the active filters/preference at the top of the terminal summary and include them in the output filename, e.g. `quotes_2026-06-19_2026-06-26_g2_bathroom.csv`.

### C. Performance fixes (the 56-night run must finish in seconds, not minutes)

1. **Minimum segment length:** `--min-segment N`, default 3. Do not branch segments shorter than N nights, EXCEPT where forced: if at some boundary date no eligible room can cover N consecutive nights, allow the longest feasible shorter segment(s) at that point. (Short hops into nicer rooms were generating thousands of near-identical plans.)
2. **Prefix-sum pricing:** precompute cumulative nightly-rate arrays per room so any segment's undiscounted price is O(1) (two lookups), then apply the segment-length discount.
3. **Per-state frontier cap:** at each DP state `(boundary_date, last_room)` keep at most ~50 non-dominated partials (if more survive dominance, keep the 50 best by price). Backstop only — log when it triggers.
4. **Equivalent alternatives cap:** carry at most 3 equal-vector alternatives per partial; discard the rest.

### D. Verify Update 2

1. `--guests 2` never outputs Room 7; `--min-beds 3` only outputs rooms 1, 4, 10, 11, 5, 6, 9.
2. `--prefer kitchen`: preferred_nights counts only Room 9 nights.
3. The 56-night quote (`2026-06-17` + 56 nights, `--prefer bathroom`) completes in under ~10 seconds, uncapped/untruncated, and its cheapest plan is ≤ £3,393 (the old capped run's best).
4. A 5-night range: confirm the frontier with `--min-segment 1` is a superset of (or equal to) the `--min-segment 3` frontier, and that the min-segment exception kicks in when you artificially block all rooms except 1-2 night windows.

## UPDATE 3 — don't offer oversized rooms unless forced (apply to existing quote.py)

A solo guest shouldn't be offered a 4–6 person room while right-sized rooms are free, but an oversized room is still better than no quote at all. Implement as a soft constraint, same pattern as the min-segment forced exception:

- A room is **oversized** when `Max occupants > guests + headroom`. New flag `--headroom N`, default 2. (Default 2 deliberately keeps Room 9, capacity 3, available to 1 guest — it's the only private-kitchen room.)
- Oversized rooms are excluded from segment branching, EXCEPT: at a boundary date where no non-oversized eligible room is free for any feasible segment, allow oversized rooms for that segment (smallest capacity first).
- Plans containing an oversized segment get a note in the `warning` column, e.g. `uses oversized Room 10 (sleeps 6) — no smaller room free`.
- Print the oversized cutoff in the terminal summary alongside the other active filters.

### Verify Update 3

1. 1 guest, a range where rooms 7/2/3/8/5/6/9 have availability: rooms 1, 4, 10, 11 never appear.
2. 1 guest, a range where ONLY Room 10 is free for some nights: Room 10 appears for those nights with the warning set.
3. `--guests 2` (headroom 2): rooms 1/4 are normal options; 10/11 are last-resort only.
4. `--headroom 0` with 1 guest: only Room 7 is a normal option, everything else last-resort.

## UPDATE 4 — discount applies to the whole reservation, not per segment (apply to existing quote.py)

Change the pricing model. The discount tier is now chosen by the TOTAL length of stay and applied to the whole reservation. Room switches no longer affect the discount.

- `discount = get_discount(total_nights)` where `total_nights = (checkout - checkin).days`. Same tier mapping as before (1→0%, 2→20%, 3–4→26%, 5–6→32%, 7+→35%), still read from `data/discounts.csv`.
- `total_price = (sum of nightly rates across ALL segments) × (1 - discount)`, rounded to 2 dp at the end. `full_price` stays as the undiscounted sum.
- Remove all per-segment discounting: in the DP, track undiscounted price (the discount is the same constant for every plan of the same quote, so it changes nothing about dominance — apply it once when building output rows).
- `segment_detail` column: drop the per-segment discount; show `Room 9: 3 nights × avg £70.00 = £210.00 | ...` and let total_price reflect the single whole-stay discount. Print the applied discount in the terminal summary (e.g. `Stay discount: 35% (30 nights)`).
- Update the selftests: the "7-night vs 4+3 split is pricier" test is now obsolete — replace it with: a split plan and a single-room plan over the same dates both get the same discount rate, and total_price = full_price × (1 - rate) for any plan.

### Verify Update 4

1. Re-run a known quote (e.g. 2026-06-17 → 2026-07-17 --guests 2): every plan's total_price must equal its full_price × 0.65 (30 nights → 35%).
2. A 1-night quote gets 0% (total_price = full_price); a 2-night quote gets 20%.
3. Selftests all pass.

## Verify before finishing

Write a quick sanity test (can be a `--selftest` flag or separate test file):
1. Pick a range with known conflicts, e.g. 2026-06-19 → 2026-06-26 (rooms 4, 10, 11, 1, 7, 6, etc. have overlapping bookings there) and confirm blocked rooms never appear on their booked nights.
2. Hand-check one plan's price: e.g. a 3-night segment in Room 9 starting 2026-06-19 = (95+95+85) × 0.74.
3. Confirm a 7-night single-room plan gets 35% off, and the same week split 4+3 gets 26% on each segment (and is therefore pricier).
4. Confirm `"Room 4, Room 10"` multi-room rows block both rooms.
5. Verify Pareto filtering: construct two plans where one is worse on all four criteria and confirm it's removed; construct two incomparable plans (e.g. cheaper-but-more-switches vs pricier-but-zero-switches) and confirm both survive.
