# Go-Live Runbook — streathamrooms.co.uk

Run these **on the Mac mini**, in Terminal. They need your Cloudflare account,
your domain registrar login, and `sudo`. I can't run them from here — they
require interactive browser logins and a terminal I can't type into.

**Already done for you (in the repo):**
- `booking-site/.env` → `NEXT_PUBLIC_SITE_URL=https://www.streathamrooms.co.uk`
- Channel manager pinned to port **3002** (`next start -p 3002`) so it matches
  `CHANNEL_MANAGER_URL` in `.env` — no more port auto-increment surprises.
- `deploy/config.yml` template ready to copy.

Decisions locked in: domain is single-use (safe full nameserver move), and
payments go **live** (real Stripe key stays). The first real booking is a real
charge — do the smoke test in step 8 carefully.

---

## 1. Install cloudflared
```bash
brew install cloudflared
cloudflared --version   # confirm it installed
```

## 2. Move the domain's DNS to Cloudflare
1. Sign in / sign up at https://dash.cloudflare.com (free plan is fine).
2. **Add a site** → enter `streathamrooms.co.uk` → choose **Free**.
3. Cloudflare scans existing DNS. Since the domain is only for this site,
   there's nothing else to preserve — but glance at the list and delete any
   stale A/CNAME records pointing at an old host.
4. Cloudflare shows **two nameservers** (e.g. `xxx.ns.cloudflare.com`).
5. Log in to your **domain registrar** and replace the current nameservers
   with those two. Save.
6. Wait for Cloudflare to show the domain as **Active** (minutes to a few
   hours). You can continue with steps 3–6 meanwhile, but the site won't
   resolve publicly until it's Active.

## 3. Authenticate the tunnel
```bash
cloudflared tunnel login
```
A browser opens — pick `streathamrooms.co.uk` and authorize. This drops a cert
into `~/.cloudflared/`.

## 4. Create the tunnel
```bash
cloudflared tunnel create streatham
```
Note the **Tunnel ID** it prints (a UUID) and the credentials file path
`~/.cloudflared/<TUNNEL_ID>.json`.

## 5. Install the config
```bash
cp "/Users/charliemcconnell/ttlock-auto-codes/IT/booking-site/deploy/config.yml" ~/.cloudflared/config.yml
# then edit ~/.cloudflared/config.yml and replace <TUNNEL_ID> with the UUID from step 4
```

## 6. Route the hostname to the tunnel
```bash
cloudflared tunnel route dns streatham www.streathamrooms.co.uk
```

## 7. Build and run BOTH apps (pinned ports)
```bash
# Channel manager — port 3002
cd "/Users/charliemcconnell/ttlock-auto-codes/IT/channel-manager"
npm install && npm run build

# Booking site — port 4100
cd "/Users/charliemcconnell/ttlock-auto-codes/IT/booking-site"
npm install && npm run import-photos && npm run build
```

Keep them alive across reboots with pm2:
```bash
npm i -g pm2
cd "/Users/charliemcconnell/ttlock-auto-codes/IT/channel-manager" && pm2 start npm --name cm   -- run start
cd "/Users/charliemcconnell/ttlock-auto-codes/IT/booking-site"     && pm2 start npm --name site -- run start
pm2 save
pm2 startup    # run the command it prints (uses sudo) so pm2 relaunches on reboot
```

Run the tunnel as a service so it also survives reboots:
```bash
sudo cloudflared service install
sudo launchctl list | grep cloudflared   # confirm it's loaded
```

## 8. Smoke test (LIVE payments — be deliberate)
1. Visit https://www.streathamrooms.co.uk — search returns live availability.
2. Confirm there is **no** test-mode banner (banner only shows when the Stripe
   key is empty; yours is live, so it should be gone).
3. Do ONE real booking for a cheap/short stay, pay, land on the success page,
   and confirm the reservation appears in the channel manager. **Refund that
   test charge** in the Stripe Dashboard afterward.
4. Check the guest portal: log in with the new booking ref + surname.

---

## Recommended next (not blocking launch)
- **Stripe webhook** — now that the public URL exists, add it in Stripe
  Dashboard → Developers → Webhooks: endpoint
  `https://www.streathamrooms.co.uk/api/stripe-webhook`, events
  `checkout.session.completed` + `checkout.session.expired`. Paste the signing
  secret into `.env` as `STRIPE_WEBHOOK_SECRET=…` and `pm2 restart site`.
  This confirms payments instantly even if a guest closes the tab.

## Rollback
- Stop public access fast: `sudo cloudflared service uninstall` (or
  `pm2 stop site`). The site goes offline; DNS stays put.
- Full revert: switch nameservers back at the registrar.

## Troubleshooting
- **502 / site won't load:** the tunnel is up but the app isn't — `pm2 status`,
  `pm2 logs site`. Make sure the site is actually on 4100.
- **Availability/bookings fail:** channel manager isn't reachable — confirm
  it's running on **3002** (`pm2 logs cm`) and `CHANNEL_MANAGER_URL` matches.
- **DNS not resolving:** domain not yet **Active** in Cloudflare, or
  nameservers not updated at the registrar. `dig www.streathamrooms.co.uk`.
