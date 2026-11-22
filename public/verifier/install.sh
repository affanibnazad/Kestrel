#!/bin/bash
# Installs the Kestrel email verifier on a fresh Ubuntu 22.04 / 24.04 VPS, as root. The easy way: Kestrel → Owner →
# Email verifier shows the exact line to paste on the server, e.g.
#   curl -fsSL https://kestrelleads.com/verifier/install.sh | DOMAIN=check.yourdomain.com SECRET=<from Kestrel> bash
# (or from the Mac: bash quarry-cloud/scripts/setup-verifier.sh IP DOMAIN, which makes its own secret).
# Safe to run again: updates the program; a new SECRET replaces the old one, otherwise the old one is kept.
set -euo pipefail
: "${DOMAIN:?Set DOMAIN, e.g. DOMAIN=check.yourverifierdomain.com}"
SECRET="${SECRET:-}"
if [ -n "$SECRET" ] && ! [[ "$SECRET" =~ ^[a-f0-9]{64}$ ]]; then echo "SECRET must be the 64-character code from Kestrel → Owner → Email verifier."; exit 1; fi
export DEBIAN_FRONTEND=noninteractive

echo "1/6  Packages (Node.js, Caddy for https, firewall)…"
apt-get update -qq
apt-get install -y -qq nodejs curl ufw dnsutils openssl debian-keyring debian-archive-keyring apt-transport-https gnupg >/dev/null
if ! command -v caddy >/dev/null; then
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq && apt-get install -y -qq caddy >/dev/null
fi
node -e 'if (+process.versions.node.split(".")[0] < 18) { console.error("Node 18+ needed"); process.exit(1) }'

echo "2/6  Server name ($DOMAIN) for mail servers to see…"
hostnamectl set-hostname "$DOMAIN"

echo "3/6  Program and secret…"
id kestrel-verifier >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin kestrel-verifier
install -d -m 755 /opt/kestrel-verifier
if [ -f /root/server.mjs ]; then install -m 644 /root/server.mjs /opt/kestrel-verifier/server.mjs
else curl -fsSL https://kestrelleads.com/verifier/server.mjs -o /opt/kestrel-verifier/server.mjs && chmod 644 /opt/kestrel-verifier/server.mjs; fi
node --check /opt/kestrel-verifier/server.mjs
install -d -m 750 -o root -g kestrel-verifier /etc/kestrel-verifier
if [ -n "$SECRET" ]; then (umask 077; printf '%s' "$SECRET" > /etc/kestrel-verifier/secret)
else [ -s /etc/kestrel-verifier/secret ] || (umask 077; openssl rand -hex 32 > /etc/kestrel-verifier/secret); fi
chown root:kestrel-verifier /etc/kestrel-verifier/secret && chmod 640 /etc/kestrel-verifier/secret
cat > /etc/kestrel-verifier/env <<EOF
HELO_HOST=$DOMAIN
PROBE_FROM=verify@$DOMAIN
PORT=8080
EOF

echo "4/6  Background service…"
cat > /etc/systemd/system/kestrel-verifier.service <<'EOF'
[Unit]
Description=Kestrel email verifier
After=network-online.target
[Service]
User=kestrel-verifier
EnvironmentFile=/etc/kestrel-verifier/env
ExecStart=/bin/sh -c 'VERIFIER_SECRET="$(cat /etc/kestrel-verifier/secret)" exec /usr/bin/node /opt/kestrel-verifier/server.mjs'
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload && systemctl enable --now kestrel-verifier >/dev/null && systemctl restart kestrel-verifier

echo "5/6  https (Caddy gets the certificate by itself)…"
cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
  reverse_proxy 127.0.0.1:8080
}
EOF
systemctl reload caddy || systemctl restart caddy

echo "6/6  Firewall (only SSH and https in)…"
ufw allow OpenSSH >/dev/null && ufw allow 80/tcp >/dev/null && ufw allow 443/tcp >/dev/null && ufw --force enable >/dev/null

sleep 3
echo
echo "Checks:"
curl -s -m 5 http://127.0.0.1:8080/health && echo "  ← program running"
(timeout 8 bash -c 'exec 3<>/dev/tcp/gmail-smtp-in.l.google.com/25 && head -c 60 <&3' && echo "  ← port 25 open") || echo "  ✗ Port 25 is BLOCKED by the provider: ask them to open outbound port 25."
echo "Reverse DNS of this IP should be $DOMAIN (set it in the provider's panel): $(dig +short -x "$(curl -s -4 ifconfig.me)" 2>/dev/null || echo unknown)"
echo "Done. Next: Kestrel → Owner → Email verifier → Test."
