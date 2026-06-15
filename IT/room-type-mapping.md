# Room Type Mapping — Expedia ↔ Booking.com

Purpose: when an Expedia cancellation email arrives, match its room name (Expedia column) to the BDC room type, then restore availability on the BDC calendar.

Key rule: Expedia cancellation emails contain the room **name only** (no usable ID), so matching is by exact name against the Expedia column. Verified against real cancellation email 2026-04-28 ("Double Room, Shared Bathroom (1)" → Tooting Room 2). Note: the email may suffix the physical room, e.g. "Double Room, Shared Bathroom (1) - Room 2" — match on the part before " - Room".

Inventory rule: several room types cover multiple physical rooms. When restoring availability, **read the current rooms-to-sell value and increment it** (`getRoomInventory` → value+1) — don't blindly set to 1.

## Streatham Rooms (BDC hotel_id 14715886, Expedia 124402141)

| Expedia room name | BDC room type | BDC room ID | Physical rooms |
|---|---|---|---|
| Executive House, Accessible, Ensuite | Triple Room with Private Bathroom | 1471588610 | 1, 4 |
| Quadruple Room, Shared Bathroom | Quad room, with Shared Bathroom | 1471588605 | 10, 11 |
| Executive House, Shared Bathroom | Superior King or Twin Room | 1471588612 | 5, 6 |
| Comfort Twin Room, Ensuite | Double or Twin Room with Private Bathroom | 1471588611 | 8 |
| Double Room, Ensuite | Double room-Ensuite | 1471588601 | 2, 3 |
| Luxury Apartment, Private Bathroom | Twin Room, with full private kitchen and ensuite | 1471588604 | 9 |
| Single Room, Shared Bathroom (Single Bed) | Basic Single Room with Shared Bathroom | 1471588609 | 7 |

## Gassiot House (BDC hotel_id 15676333, Expedia 124830615)

| Expedia room name | BDC room type | BDC room ID | Physical rooms |
|---|---|---|---|
| Superior Twin Room, Shared Bathroom | Superior King or Twin Room | 1567633306 | 1 |
| Business Double Room, Shared Bathroom | Double Room, Shared Bathroom | 1567633303 | 7 |
| Business Twin Room, Shared Bathroom | Twin or Super King Bed in Cozy Room (Shared Bath) | 1567633305 | 3 |
| Basic Double or Twin Room, Shared Bathroom | Budget Double Room with Shared Bathroom | 1567633308 | 6 |
| Basic Double Room, Shared Bathroom | Basic Double Room with Shared Bathroom | 1567633307 | 5 |
| Business Single Room, Shared Bathroom | Single Room, Shared bathroom | 1567633302 | 4 |
| Economy House, Shared Bathroom | Two Twin Beds or Super King, Vented, Shared bathroom | 1567633301 | 2 |

## Tooting Stays (BDC hotel_id 13576893, Expedia 114536696)

| Expedia room name | BDC room type | BDC room ID | Physical rooms |
|---|---|---|---|
| Double Room, Shared Bathroom | Room 1 | 1357689301 | 1 |
| Double Room, Shared Bathroom (1) | Room 2 | 1357689302 | 2 |
| Double Room, Shared Bathroom (2) | Room 3 | 1357689304 | 3 |
| Double Room, Shared Bathroom (3) | Room 4 | 1357689305 | 4 |
| Double Room, Shared Bathroom (4) | Room 5 | 1357689306 | 5 |
| Deluxe Double Room, Shared Bathroom | Room 6 | 1357689307 | 6 |

## Valnay Stays (BDC hotel_id 15779662, Expedia 124213592) — "Valnay Rooms" on BDC

| Expedia room name | BDC room type | BDC room ID | Physical rooms |
|---|---|---|---|
| Basic Twin Room, Shared Bathroom | Twin Room/ Super King Bed, with Shared Bathroom | 1577966206 | 4 |
| Basic Twin Room, Private Bathroom | Twin Room/ Super King Bed, with En-suite | 1577966204 | 5 |
| Business Double Room, Shared Bathroom | Business, Double Room, Shared Bathroom | 1577966205 | 1, 3, 6 |
| Basic Double Room, Shared Bathroom | Double Room, Shared Bathroom | 1577966203 | 2 |

## Seamless Stays (BDC hotel_id 12686318) — BDC only (not on Expedia)

BDC actually lists 5 single-room types (not 3 as previously mapped). Physical room
assignments for 2/3/4 are best guesses — TO CONFIRM with Charlie.

| BDC room type | BDC room ID | Physical rooms |
|---|---|---|
| Room 1 | 1268631801 | 1 |
| Double Room with Shared Bathroom | 1268631802 | 2 (?) |
| Large Double Room | 1268631803 | 3 (?) |
| Deluxe Double Room | 1268631805 | 4 (?) |
| Single Room with Shared Bathroom | 1268631804 | 5 |

## Notes
- All BDC hotel + room IDs captured 2026-06-12 from extranet Property Layout pages. Also loaded into the channel manager DB (IT/channel-manager).
- Tooting room IDs skip `...03` (Room 3 = 1357689304).
- Watch out: Valnay & Gassiot currently suspended on Expedia (payment default, June 4–5) — no new Expedia activity until resolved.
- TO CONFIRM: Seamless physical room numbers for rooms 2/3/4 (see above).


## Expedia room & rate-plan IDs (scraped from EPC 2026-06-12)

### Streatham (EPC htid 124402141)

| Expedia room name | Room ID | Rate plan ID (max occ) |
|---|---|---|
| Double Room, Ensuite | 327910457 | 406745860 (2) |
| Quadruple Room, Shared Bathroom | 327939022 | 406819859 (4) |
| Single Room, Shared Bathroom (Single Bed) | 327940739 | 406826037 (1) |
| Luxury Apartment, Private Bathroom | 327940744 | 406826041 (2) |
| Comfort Twin Room, Ensuite | 327940745 | 406826051 (2) |
| Executive House, Accessible, Ensuite | 328282146 | 408369639 + 408391232 (3) — 2 plans, identify standard before editing |
| Executive House, Shared Bathroom | 328282162 | 408367499 + 408391299 (2) — 2 plans |

### Tooting (EPC htid 114536696) — rate plan IDs TBD (scrape during first push)

| Expedia room name | Room ID |
|---|---|
| Double Room, Shared Bathroom | 326405063 |
| Double Room, Shared Bathroom (1) | 326405088 |
| Double Room, Shared Bathroom (2) | 326405102 |
| Double Room, Shared Bathroom (3) | 326405110 |
| Double Room, Shared Bathroom (4) | 326405142 |
| Deluxe Double Room, Shared Bathroom | 326405541 |
| Business Double Room, Shared Bathroom | 328083353 — NOT in mapping, TO CONFIRM with Charlie |

Gassiot / Valnay: suspended on Expedia — scrape IDs when reactivated.
Occupancy pricing note: observed 1-occupant rate = 2-occupant rate − £5 (confirm policy).
