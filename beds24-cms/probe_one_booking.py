"""
Probe ONE specific booking for messages — point it at a booking you can SEE has
messages in the Beds24 UI, and it dumps exactly what the API returns.

Usage:  python probe_one_booking.py <BOOKING_ID>
        (BOOKING_ID is the number shown on the booking in Beds24)
"""
import json
import os
import sys

from beds24_client import Beds24Client, Beds24Error, Beds24RateLimit

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "raw", "one_booking_probe.json")


def call(client, label, path, params):
    print(f"\n### {label}\n    GET {path} params={params}")
    try:
        d = client.get(path, params=params)
        payload = d.get("data", d) if isinstance(d, dict) else d
        n = len(payload) if isinstance(payload, list) else "n/a"
        print(f"    OK data_len={n}")
        # show the full thing so we can see the real shape
        print(json.dumps(d, indent=2, default=str)[:2500])
        return {"label": label, "path": path, "params": params, "raw": d}
    except Beds24RateLimit as e:
        print(f"    RATE LIMITED: {e}")
        return {"label": label, "rate_limited": True, "error": str(e)}
    except Beds24Error as e:
        print(f"    ERROR: {e}")
        return {"label": label, "error": str(e)}


def main():
    if len(sys.argv) < 2:
        print("Usage: python probe_one_booking.py <BOOKING_ID>")
        sys.exit(1)
    bid = sys.argv[1].strip()
    client = Beds24Client()
    out = {"booking_id": bid, "results": []}

    out["results"].append(call(client, "messages by bookingId",
                               "/bookings/messages", {"bookingId": bid}))
    out["results"].append(call(client, "booking with includeMessages",
                               "/bookings", {"id": bid, "includeMessages": True}))
    out["results"].append(call(client, "messages, filter[bookingId]",
                               "/bookings/messages", {"filter": "bookingId", "value": bid}))

    os.makedirs(os.path.dirname(RAW), exist_ok=True)
    with open(RAW, "w") as f:
        json.dump(out, f, indent=2, default=str)
    print(f"\nSaved full output to {RAW}")


if __name__ == "__main__":
    main()
