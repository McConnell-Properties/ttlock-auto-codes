# Deploying the channel manager (+ booking site)

Code-side prep is **done** (auth middleware, login page, Stripe webhook,
remote-DB support). What remains needs accounts/signups from you.

## Recommended stack

- **Turso** (libsql) for the database — drop-in for the current SQLite setup,
  one env var change. (Supabase/Postgres would mean rewriting `lib/data.ts` SQL.)
- **Vercel** for both Next.js apps (channel-manager + booking-site).

## Steps

1. **Sign up**: https://turso.tech and https://vercel.com (GitHub login is easiest).
2. **Create the DB and import the data** (Claude can run these with you):
   ```bash
   brew install tursodatabase/tap/turso
   turso auth login
   turso db create mcconnell-cm --from-file db/dev.db
   turso db show mcconnell-cm --url        # → DATABASE_URL
   turso db tokens create mcconnell-cm     # → DATABASE_AUTH_TOKEN
   ```
3. **Deploy channel-manager on Vercel** with env vars:
   | var | value |
   |---|---|
   | `DATABASE_URL` | `libsql://…` from step 2 |
   | `DATABASE_AUTH_TOKEN` | token from step 2 |
   | `ADMIN_PASSWORD` | pick one — enables the login wall |
   | `SESSION_SECRET` | any long random string |
   | `CM_API_KEY` | any long random string — booking site uses it |
   | `STRIPE_SECRET_KEY` | live key |
   | `STRIPE_WEBHOOK_SECRET` | from step 5 |
   | `GMAIL_USER` / `GMAIL_APP_PASSWORD` | as in local .env |
4. **Deploy booking-site** with `CHANNEL_MANAGER_URL` = the Vercel URL and the
   same `CM_API_KEY` (sent as `Authorization: Bearer …` — small change in
   `lib/cm.ts` to add the header).
5. **Stripe webhook**: Dashboard → Developers → Webhooks → add
   `https://<cm-domain>/api/stripe/webhook`, events
   `checkout.session.completed` + `checkout.session.expired`; copy the signing
   secret into `STRIPE_WEBHOOK_SECRET`. Real-time payment status — no more polling.

## What changes for the local Mac jobs

The launchd jobs (`automation/`) keep running locally — they feed data only the
Mac can see (pipeline CSVs, extras file). Point them at the cloud DB by setting
`DATABASE_URL` + `DATABASE_AUTH_TOKEN` in the local `.env`.

**Caveat (small follow-up task):** the `db/*.mjs` scripts create their client
with the URL only — they need the same one-line `authToken` tweak as `lib/db.ts`
before they can talk to Turso. Also `db:backup` copies the local file; with
Turso use `turso db shell mcconnell-cm .dump` or its built-in backups instead.

## Notes

- Auth is off until `ADMIN_PASSWORD` is set, so local dev is unaffected.
- `/api/*` accepts either the admin cookie or `Bearer CM_API_KEY`.
- `/api/stripe/webhook` is public but verifies Stripe's signature itself.
- The booking-site portal also reads local pipeline files (door codes); until
  the pipeline output is synced somewhere the site can reach, deploy the
  channel-manager first and keep the booking site local (Cloudflare tunnel,
  as per its README) — or accept "code follows separately" emails.
