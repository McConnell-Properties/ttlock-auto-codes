"""
Beds24 API V2 client — READ ONLY.

Handles the token lifecycle:
  1. First run: exchange a one-time invite code -> long-life refresh token.
  2. Every run: use refresh token -> short-life access token (24h).
  3. Persists the refresh token locally (secrets.json, chmod 600).

This client ONLY issues GET requests. It has no methods that write to Beds24,
and the token you generated has read-only scopes, so a push is impossible by design.

Docs: https://wiki.beds24.com/index.php/Category:API_V2
"""

import json
import os
import sys
import time
import urllib.parse
import urllib.request
import urllib.error

API_BASE = "https://beds24.com/api/v2"
HERE = os.path.dirname(os.path.abspath(__file__))
SECRETS_PATH = os.path.join(HERE, "secrets.json")


class Beds24Error(RuntimeError):
    pass


class Beds24RateLimit(Beds24Error):
    """Raised on HTTP 429. Carries Beds24 credit headers so callers can back off."""
    def __init__(self, path, detail, headers):
        self.headers = {k.lower(): v for k, v in (headers or {}).items()}
        self.remaining = (self.headers.get("x-five-min-limit-remaining")
                          or self.headers.get("x-fivemincreditremaining"))
        self.limit = self.headers.get("x-fivemincreditlimit")
        self.resets_in = (self.headers.get("x-five-min-limit-resets-in")
                          or self.headers.get("retry-after"))
        super().__init__(
            f"HTTP 429 credit limit on {path}. remaining={self.remaining} "
            f"limit={self.limit} resets_in={self.resets_in}s. {detail}"
        )


def _load_secrets():
    if not os.path.exists(SECRETS_PATH):
        return {}
    with open(SECRETS_PATH) as f:
        return json.load(f)


def _save_secrets(secrets):
    with open(SECRETS_PATH, "w") as f:
        json.dump(secrets, f, indent=2)
    try:
        os.chmod(SECRETS_PATH, 0o600)
    except OSError:
        pass


def _http_get(path, headers=None, params=None):
    url = API_BASE + path
    if params:
        # drop None values; Beds24 wants lowercase true/false for booleans
        clean = {}
        for k, v in params.items():
            if v is None:
                continue
            if isinstance(v, bool):
                v = "true" if v else "false"
            clean[k] = v
        if clean:
            url += "?" + urllib.parse.urlencode(clean, doseq=True)
    req = urllib.request.Request(url, method="GET")
    req.add_header("accept", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = resp.read().decode("utf-8")
            return json.loads(body), dict(resp.headers)
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")
        if e.code == 429:
            raise Beds24RateLimit(path, detail, dict(e.headers or {})) from e
        raise Beds24Error(f"HTTP {e.code} on GET {path}: {detail}") from e
    except urllib.error.URLError as e:
        raise Beds24Error(f"Network error on GET {path}: {e.reason}") from e


class Beds24Client:
    def __init__(self):
        self.secrets = _load_secrets()
        # Reuse a cached access token across runs to avoid spending credits on
        # /authentication/token every single invocation.
        self._access_token = self.secrets.get("accessToken")
        self._access_expiry = float(self.secrets.get("accessExpiry") or 0)
        self.last_credit = {}  # populated from response headers after each call

    # ---- token lifecycle -------------------------------------------------
    def setup_from_invite_code(self, invite_code):
        """Exchange a one-time invite code for a permanent refresh token."""
        data, _ = _http_get("/authentication/setup", headers={"code": invite_code})
        if "refreshToken" not in data:
            raise Beds24Error(f"Setup did not return a refreshToken: {data}")
        self.secrets["refreshToken"] = data["refreshToken"]
        # keep the first access token too
        if "token" in data:
            self._access_token = data["token"]
            self._access_expiry = time.time() + int(data.get("expiresIn", 0)) - 60
        _save_secrets(self.secrets)
        return data["refreshToken"]

    def _refresh_access_token(self):
        rt = self.secrets.get("refreshToken")
        if not rt:
            raise Beds24Error(
                "No refresh token stored. Run first-time setup with your invite code "
                "(see README)."
            )
        data, _ = _http_get("/authentication/token", headers={"refreshToken": rt})
        if "token" not in data:
            raise Beds24Error(f"Token refresh failed: {data}")
        self._access_token = data["token"]
        self._access_expiry = time.time() + int(data.get("expiresIn", 86400)) - 120
        # persist so the next run/script reuses it instead of refreshing again
        self.secrets["accessToken"] = self._access_token
        self.secrets["accessExpiry"] = self._access_expiry
        _save_secrets(self.secrets)
        return self._access_token

    def _token(self):
        if not self._access_token or time.time() >= self._access_expiry:
            self._refresh_access_token()
        return self._access_token

    # Beds24 credit headers (per API V2 docs)
    CREDIT_HEADERS = (
        "x-five-min-limit-remaining",
        "x-five-min-limit-resets-in",
        "x-request-cost",
        # legacy / alt spellings, captured defensively
        "x-fivemincreditremaining",
        "x-fivemincreditlimit",
    )

    def _note_credit(self, headers):
        h = {k.lower(): v for k, v in (headers or {}).items()}
        for key in self.CREDIT_HEADERS:
            if key in h:
                self.last_credit[key] = h[key]

    # ---- generic GET with pagination ------------------------------------
    def get(self, path, params=None):
        headers = {"token": self._token()}
        data, resp_headers = _http_get(path, headers=headers, params=params)
        self._note_credit(resp_headers)
        return data

    def get_all_pages(self, path, params=None, page_size=100, max_pages=200):
        """Iterate Beds24's page-based pagination, returning the merged data list."""
        params = dict(params or {})
        results = []
        page = 1
        while page <= max_pages:
            params["page"] = page
            if "limit" not in params:
                params["limit"] = page_size
            payload = self.get(path, params=params)
            chunk = payload.get("data", payload if isinstance(payload, list) else [])
            if not chunk:
                break
            results.extend(chunk)
            # Beds24 returns pages info; stop when we've got the last page
            pages = (payload.get("pages") or {})
            next_page = pages.get("nextPageExists")
            if next_page is False:
                break
            if next_page is None and len(chunk) < params["limit"]:
                break
            page += 1
        return results


def first_time_setup(invite_code):
    client = Beds24Client()
    rt = client.setup_from_invite_code(invite_code)
    print("Refresh token stored in secrets.json. You will not need the invite code again.")
    print("Token (first/last 4 chars only):", rt[:4] + "..." + rt[-4:])
    return client


if __name__ == "__main__":
    # Usage: python beds24_client.py setup <INVITE_CODE>
    if len(sys.argv) >= 3 and sys.argv[1] == "setup":
        first_time_setup(sys.argv[2])
    elif len(sys.argv) >= 2 and sys.argv[1] == "test":
        c = Beds24Client()
        props = c.get("/properties")
        print(json.dumps(props, indent=2)[:2000])
    else:
        print("Usage:")
        print("  python beds24_client.py setup <INVITE_CODE>   # first-time token exchange")
        print("  python beds24_client.py test                  # smoke test /properties")
