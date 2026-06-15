#!/bin/bash
# Sets all production env vars on the linked Vercel project.
# Reuses Stripe/Gmail values from your local .env; sets the new cloud values inline.
# Run AFTER `vercel link` from the channel-manager folder:  bash _vercel_env.sh
set -e
cd "$(dirname "$0")"
val(){ grep -E "^$1=" .env | head -1 | cut -d= -f2- | sed 's/^"//; s/"$//'; }
add(){ printf "%s" "$2" | vercel env add "$1" production --force; echo "  set $1"; }

add DATABASE_URL        "libsql://mcconnell-cm-mcconnell-properties.aws-eu-west-1.turso.io"
add DATABASE_AUTH_TOKEN "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODEzNDkyMTUsImlkIjoiMDE5ZWMwYWYtOTIwMS03ZDIyLTgwYzAtOGI4NmE3YjMyYjhmIiwicmlkIjoiNjI0OWI4MTMtMmVjNy00N2QyLWJlYjYtMTMzNTMyYTIzNDMxIn0.DfrobY3IX_X1scRr8pzhtrR6i_3iYFdKmyJfZjteTJ1IgmLbdX7goAF69aIldmOZ61X3YX9dqiCXIZJ4IJZrBw"
add ADMIN_PASSWORD      "ixDuPstSGgDIKemv"
add SESSION_SECRET      "xYrpiCGeNvH4QLCmaPYCEjNy0XqhM0f5whyzLxhxz7U"
add CM_API_KEY          "IdtiwhPgc-lh4fJkP7EJH8MjUzWRDgB8xCeqvJelb-8"
add STRIPE_SECRET_KEY   "$(val STRIPE_SECRET_KEY)"
add GMAIL_USER          "$(val GMAIL_USER)"
add GMAIL_APP_PASSWORD  "$(val GMAIL_APP_PASSWORD)"
echo "All env vars set."
