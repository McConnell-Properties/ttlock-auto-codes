#!/usr/bin/env python3
"""Refresh data/reservations.csv from the LATEST reservation_status export.

Pulls every non-cancelled Streatham reservation from the TTLock pipeline's
reservation_status.csv so quote.py always quotes against current data.

Usage:
    python3 refresh_reservations.py                # default source path
    python3 refresh_reservations.py /path/to/reservation_status.csv

Run this before quote.py (or let the booking site do it — it reads the same
file automatically).
"""
import csv
import os
import stat
import sys
from datetime import date
from pathlib import Path

DEFAULT_SOURCE = (
    "/Users/charliemcconnell/Documents/Career/McConnell Enterprises/IT/"
    "ttlock-auto-codes/automation-data/reservation_status.csv"
)
OUT = Path(__file__).parent / "data" / "reservations.csv"


def iso(d: str) -> str:
    d = (d or "").strip()
    if len(d) == 10 and d[2] == "/" and d[5] == "/":  # DD/MM/YYYY
        dd, mm, yyyy = d.split("/")
        return f"{yyyy}-{mm}-{dd}"
    return d if len(d) == 10 and d[4] == "-" and d[7] == "-" else ""


def write_csv(rows_out) -> None:
    """Write data/reservations.csv, coping with a read-only/locked target.

    Strategy: try direct write → add user-write permission and retry →
    write a temp file and atomically replace (only needs write access to
    the directory, not the file).
    """
    def _write(p: Path) -> None:
        with open(p, "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(["Room", "Check in", "Check out"])
            w.writerows(rows_out)

    try:
        _write(OUT)
        return
    except PermissionError:
        pass

    try:  # clear read-only permission bits and retry
        os.chmod(OUT, os.stat(OUT).st_mode | stat.S_IWUSR)
        _write(OUT)
        return
    except (PermissionError, OSError):
        pass

    tmp = OUT.with_name(OUT.name + ".tmp")
    try:  # atomic replace — works when the dir is writable but the file isn't
        _write(tmp)
        os.replace(tmp, OUT)
        return
    except (PermissionError, OSError) as e:
        if tmp.exists():
            tmp.unlink(missing_ok=True)
        sys.exit(
            f"Cannot write {OUT}: {e}\n"
            "The file appears locked. Fix it with:\n"
            f'  chmod u+w "{OUT}"\n'
            f'  chflags nouchg "{OUT}"   # if Finder shows it as Locked\n'
            "then re-run this script."
        )


def main() -> None:
    source = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(DEFAULT_SOURCE)
    if not source.exists():
        sys.exit(f"source not found: {source}")

    rows_out = []
    skipped = cancelled = unallocated = 0
    with open(source, newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if (r.get("Property name") or "").strip() != "Streatham Rooms":
                continue
            status = (r.get("Status") or "").strip().lower()
            if status == "cancelled":
                cancelled += 1
                continue
            ci, co = iso(r.get("Check in date", "")), iso(r.get("Check out date", ""))
            if not ci or not co or co <= ci:
                skipped += 1
                continue
            rooms = (r.get("Rooms") or "").strip()
            if not rooms or rooms.upper() == "UNALLOCATED":
                rooms = "UNALLOCATED"
                unallocated += 1
            rows_out.append((rooms, ci, co))

    rows_out.sort(key=lambda x: (x[1], x[2], x[0]))
    write_csv(rows_out)

    future = sum(1 for _, _, co in rows_out if co >= date.today().isoformat())
    print(f"Wrote {len(rows_out)} reservations → {OUT}")
    print(f"  ({future} current/future, {unallocated} unallocated, "
          f"{cancelled} cancelled excluded, {skipped} skipped bad dates)")
    print(f"  source: {source}")


if __name__ == "__main__":
    main()
