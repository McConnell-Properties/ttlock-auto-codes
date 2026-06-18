"""
One-shot health check for guest messaging. Makes a SINGLE API call and reports
how many messages Beds24 currently holds, plus your credit usage.

Use this to confirm the moment Beds24 enables message collection — when the count
goes above 0, run_messages.sh will populate the inbox on its next poll.

Run:  python check_messages.py
"""
from beds24_client import Beds24Client, Beds24Error, Beds24RateLimit


def main():
    client = Beds24Client()
    try:
        data = client.get("/bookings/messages", params={"maxAge": 3650})
    except Beds24RateLimit as e:
        print(f"Rate limited — wait {e.resets_in}s. (remaining={e.remaining})")
        return
    except Beds24Error as e:
        print(f"API error: {e}")
        return

    msgs = data.get("data", []) if isinstance(data, dict) else (data or [])
    c = client.last_credit
    n = len(msgs)
    print(f"Messages available via API (last 10y): {n}")
    print(f"Credit: remaining={c.get('x-five-min-limit-remaining')} "
          f"cost={c.get('x-request-cost')} resets_in={c.get('x-five-min-limit-resets-in')}s")
    if n == 0:
        print("\n=> Still 0. Beds24 isn't collecting guest messages yet.")
        print("   This is a Beds24/Booking.com settings step, not a code issue —")
        print("   see the support-ticket text in our notes / README.")
    else:
        print(f"\n=> Messages are flowing! Run ./run_messages.sh to build the inbox.")
        ch = {}
        for m in msgs:
            bid = m.get("bookingId")
            ch[bid] = ch.get(bid, 0) + 1
        print(f"   Across {len(ch)} bookings.")


if __name__ == "__main__":
    main()
