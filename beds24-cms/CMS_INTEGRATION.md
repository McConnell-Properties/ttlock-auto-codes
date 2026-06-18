# Beds24 Dashboards — CMS Integration Guide (for the developer)

There are **two** read-only pages to surface in the CMS. Both are single,
self-contained HTML files (no build step, no external dependencies) that the Mac
mini regenerates on a schedule. Your job is to host them behind authentication and
keep them refreshed.

| Page | File | Rebuilt | Refresh need |
|------|------|---------|--------------|
| **Reports dashboard** | `dashboard-embed.html` | daily (06:30) by `run.sh` | low |
| **Guest message inbox** | `messages-dashboard.html` | every 5 min by `run_messages.sh` | high (near-live) |

- `dashboard-embed.html` has Chart.js inlined; `messages-dashboard.html` is plain
  inline JS/CSS. Both are ~self-contained single files — **nothing else to ship**.
- Neither file contains credentials. The Beds24 token lives only in `secrets.json`
  on the Mac mini and is never embedded.

## Security — read first

Both pages contain **guest personal data** — the inbox especially (guest names +
full message content). Treat them as internal-only:

1. Serve **only behind the CMS's existing authentication.** Never on a public URL.
2. If iframing, the parent CMS page must itself be auth-gated.
3. Set `Cache-Control: private, no-store` so shared proxies/CDNs don't cache them.
4. No secrets are in the files, so there's nothing to leak credential-wise — the
   concern is purely the guest data.

## Integration patterns — pick one

### A. Two menu items / routes (simplest)
Add two authenticated pages (or nav links) — "Performance" → `dashboard-embed.html`,
"Guest Inbox" → `messages-dashboard.html`. Each is a complete page on its own.

### B. iframe into existing CMS pages
Each file's CSS is fully scoped, so it won't collide with CMS styles:

```html
<iframe src="/internal/beds24-dashboard.html"
        style="width:100%;height:100vh;border:0" title="Beds24 Reports"></iframe>
```

### C. One combined page with tabs
If you want both behind a single nav item, a thin wrapper that tabs between two
iframes works (adapt the `src` paths to wherever you host the files):

```html
<!doctype html><meta charset="utf-8">
<style>
  .tabbar{display:flex;gap:4px;background:#0f1419;padding:8px}
  .tabbar button{padding:8px 16px;border:0;border-radius:8px;cursor:pointer;
    background:#1a2029;color:#8b98a5;font:inherit}
  .tabbar button.active{background:#4f9cf9;color:#fff}
  iframe{width:100%;height:calc(100vh - 52px);border:0;display:none}
  iframe.active{display:block}
</style>
<div class="tabbar">
  <button class="active" data-t="rep">Performance</button>
  <button data-t="inbox">Guest Inbox</button>
</div>
<iframe id="rep"   class="active" src="/internal/beds24/dashboard-embed.html"></iframe>
<iframe id="inbox"               src="/internal/beds24/messages-dashboard.html"></iframe>
<script>
  document.querySelectorAll('.tabbar button').forEach(b=>b.onclick=()=>{
    document.querySelectorAll('.tabbar button').forEach(x=>x.classList.remove('active'));
    document.querySelectorAll('iframe').forEach(x=>x.classList.remove('active'));
    b.classList.add('active'); document.getElementById(b.dataset.t).classList.add('active');
  });
</script>
```

This wrapper is also saved as `cms-embed-example.html` in the project folder.

## Getting the rebuilt files to the CMS

Both run scripts have a deploy hook — set an env var and they push after each build.

### Same Mac / local network
Point the web root (or symlinks) at the two files, or copy them in via the hooks.

### Remote / cloud CMS
```bash
# in the launchd env or a wrapper:
export DEPLOY_CMD='scp -q dashboard-embed.html deploy@cms:/var/www/app/private/beds24-reports.html'
export MESSAGES_DEPLOY_CMD='scp -q messages-dashboard.html deploy@cms:/var/www/app/private/beds24-inbox.html'
```
`run.sh` uses `DEPLOY_CMD` (daily); `run_messages.sh` uses `MESSAGES_DEPLOY_CMD`
(every 5 min). rsync / git / `aws s3 cp` work equally — just swap the command.

## Caching — they refresh at different rates

- **Reports** change once a day → `Cache-Control: no-cache` or cache-bust `?v=YYYYMMDD`.
- **Inbox** changes every 5 minutes → serve with `no-store` (or a <5-min TTL) so staff
  always see the latest unanswered threads. If you cache-bust, update the token each
  deploy, e.g. `beds24-inbox.html?v=<unix-min>`.

## Alternative: render natively from JSON

If you'd rather the CMS render its own UI (native styling, live filtering) instead of
embedding our HTML, both builders can emit a `*.json` data file alongside the HTML for
your front end to consume — a small change on our side. Ask if you want that.

## Handoff checklist

- [ ] Host **both** files behind existing CMS auth (never public).
- [ ] Pick a pattern: two menu items, two iframes, or the combined tab wrapper.
- [ ] Wire delivery: local symlink/copy, or `DEPLOY_CMD` + `MESSAGES_DEPLOY_CMD`.
- [ ] Cache: reports `no-cache`; inbox `no-store` (it updates every 5 min).
- [ ] Confirm both launchd jobs are loaded (daily reports + 5-min messages).
- [ ] Verify both pages load and render after login.

Data/build questions (token, fields, metrics, messages) → see `README.md`.
