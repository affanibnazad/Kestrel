#!/bin/bash
# One-time setup of Kestrel's own email verifier on Affan's VPS (Ubuntu 24.04). Run in the Mac's Terminal app:
#   bash /Users/affanibnazad/Documents/Database/quarry-cloud/scripts/setup-verifier.sh SERVER_IP yourverifierdomain.com
# It asks for the server's root password once (type it in Terminal, never in a chat). Steps:
#   1. checks that check.<domain> points to the server (DNS A record)  2. copies and installs the verifier (public/verifier/install.sh)
#   3. reads the secret from the server into .verifier-secret (never printed)  4. checks https  5. publishes Kestrel with it.
# Safe to run again (updates the program, keeps the secret).
set -euo pipefail
cd "$(dirname "$0")/.."
IP="${1:-}"; DOMAIN="${2:-}"
[[ "$IP" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || { echo "Usage: bash scripts/setup-verifier.sh SERVER_IP yourverifierdomain.com"; exit 1; }
DOMAIN="$(printf '%s' "$DOMAIN" | tr 'A-Z' 'a-z' | sed -E 's#^https?://##; s#/.*$##; s#^check\.##')"
[[ "$DOMAIN" =~ ^[a-z0-9-]+(\.[a-z0-9-]+)+$ ]] || { echo "The second value must be your extra domain, e.g. kestrelverify.site"; exit 1; }
HOST="check.$DOMAIN"

echo "1/5  DNS: does $HOST point to $IP?"
GOT="$(dig +short A "$HOST" @1.1.1.1 | tail -1)"
if [ "$GOT" != "$IP" ]; then
  echo "     Not yet (it points to: ${GOT:-nothing})."
  echo "     At Hostinger → Domains → $DOMAIN → DNS / Nameservers, add a record:  Type A · Name check · Points to $IP · TTL 300"
  echo "     Wait 5–10 minutes, then run this again."
  exit 1
fi
echo "     Yes."

CTL="$HOME/.ssh/kestrel-verifier-%r@%h:%p"; mkdir -p "$HOME/.ssh"
SSHO=(-o ControlMaster=auto -o "ControlPath=$CTL" -o ControlPersist=10m -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15)
cleanup() { ssh "${SSHO[@]}" -O exit "root@$IP" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "2/5  Installing on the server (it asks for the root password once)…"
scp -q "${SSHO[@]}" public/verifier/server.mjs "root@$IP:/root/server.mjs"
ssh "${SSHO[@]}" "root@$IP" "DOMAIN=$HOST bash -s" < public/verifier/install.sh

echo "3/5  Secret: server → .verifier-secret (not shown)…"
(umask 077; ssh "${SSHO[@]}" "root@$IP" cat /etc/kestrel-verifier/secret | tr -d '[:space:]' > .verifier-secret)
[ "$(wc -c < .verifier-secret | tr -d ' ')" -ge 32 ] || { echo "     Could not read the secret from the server."; exit 1; }
printf 'https://%s' "$HOST" > .verifier-url

echo "4/5  Waiting for https://$HOST (the certificate takes up to 2 minutes)…"
for i in $(seq 1 24); do
  if curl -fsS -m 5 "https://$HOST/health" >/dev/null 2>&1; then echo "     https works."; break; fi
  [ "$i" = 24 ] && { echo "     https did not answer. Check ports 80/443 are open at the provider, then run this again."; exit 1; }
  sleep 5
done
PTR="$(dig +short -x "$IP" @1.1.1.1 | sed 's/\.$//')"
[ "$PTR" = "$HOST" ] || echo "     Reminder: set reverse DNS (PTR) of $IP to $HOST in the VPS panel (now: ${PTR:-not set}). It helps mail servers trust the checks."

echo "5/5  Publishing Kestrel with the verifier…"
bash scripts/deploy-vercel.sh
echo
echo "Done. Kestrel's Verify emails now asks your own server first. Tell Claude it finished (never paste the secret)."
