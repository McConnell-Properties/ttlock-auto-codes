#!/bin/bash
# Writes a clean cloudflared config (no copy-paste corruption) and restarts the tunnel.
set -e

HOST="$(printf '%s%s%s' 'www' '.streathamrooms' '.co.uk')"
CONF="$HOME/.cloudflared/config.yml"

cat > "$CONF" <<EOF
tunnel: streatham
credentials-file: $HOME/.cloudflared/607f81df-a9ff-41ef-ad41-e92d902e740c.json
ingress:
  - hostname: $HOST
    service: http://localhost:4100
  - service: http_status:404
EOF

echo "--- config written: ---"
cat "$CONF"
echo "-----------------------"

echo "Restarting tunnel service (asks for your Mac password)..."
sudo launchctl kickstart -k system/com.cloudflare.cloudflared
echo "Done. Tunnel restarted with clean config."
