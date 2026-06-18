"""
Credit-SAFE messages probe. Makes at most 2 requests, prints the Beds24 credit
headers after each, and stops the moment it sees a 429. Use this (not
diagnose_messages.py) while we're near the credit limit.

Run:  python probe_messages_once.py
"""
import json
import os

from beds24_client import Beds24Client, Beds24Error, Beds24RateLimit

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "raw", "messages_probe_once.json")


def show_credit(client, tag):
    c = client.last_credit
    print(f"    credit[{tag}]: remaining={c.get('x-five-min-limit-remaining')} "
          f"cost={c.get('x-request-cost')} "
          f"resets_in={c.get('x-five-min-limit-resets-in')}s")


def one(client, path, params):
    print(f"\n### GET {path} params={params}")
    try:
        data = client.get(path, params=params)
        keys = list(data.keys()) if isinstance(data, dict) else "list"
        payload = data.get("data", data) if isinstance(data, dict) else data
        n = len(payload) if isinstance(payload, list) else "n/a"
        print(f"    OK top-keys={keys} data_len={n}")
        show_credit(client, "after")
        sample = payload[:3] if isinstance(payload, list) else data
        return {"path": path, "params": params, "ok": True, "top_keys": keys,
                "data_len": n, "sample": sample, "credit": client.last_credit.copy()}
    except Beds24RateLimit as e:
        print(f"    RATE-LIMITED: {e}")
        return {"path": path, "params": params, "rate_limited": True, "error": str(e)}
    except Beds24Error as e:
        print(f"    ERROR: {e}")
        return {"path": path, "params": params, "ok": False, "error": str(e)}


def main():
    client = Beds24Client()
    results = []

    # Call 1: account-wide recent messages (one request).
    r1 = one(client, "/bookings/messages", {"maxAge": 60})
    results.append(r1)

    # Only make a 2nd call if the first wasn't rate-limited.
    if not r1.get("rate_limited"):
        if r1.get("ok") and r1.get("data_len") in (0, "n/a"):
            # empty -> widen the window once
            results.append(one(client, "/bookings/messages", {"maxAge": 3650}))
        elif not r1.get("ok"):
            # the error message usually names the required parameter
            results.append(one(client, "/bookings/messages", None))

    os.makedirs(os.path.dirname(RAW), exist_ok=True)
    with open(RAW, "w") as f:
        json.dump(results, f, indent=2, default=str)
    print(f"\nSaved to {RAW}")
    print("If both calls were rate-limited, wait ~10-15 min and run again.")


if __name__ == "__main__":
    main()
