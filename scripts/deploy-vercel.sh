#!/bin/bash
# Kestrel: publish the website to Vercel.
# Reads the Vercel token from .vercel-token and the two Supabase settings from .env.local.
# Nothing secret is printed. Run from anywhere: bash scripts/deploy-vercel.sh
set -euo pipefail
cd "$(dirname "$0")/.."
V="npx --yes vercel@65.4.0"

VERCEL_TOKEN="$(tr -d '[:space:]' < .vercel-token 2>/dev/null || true)"
if [ -z "$VERCEL_TOKEN" ]; then echo "The file .vercel-token is empty. Paste your Vercel token into it, save, and run this again."; exit 1; fi
export VERCEL_TOKEN

echo "1/4  Checking the Vercel sign-in..."
$V whoami || { echo "Vercel did not accept the token. Make a new one and paste it into .vercel-token."; exit 1; }

echo "2/4  Linking this folder to the Vercel project 'kestrel'..."
$V link --yes --project kestrel || { $V project add kestrel && $V link --yes --project kestrel; }

echo "3/4  Adding the two Supabase settings to Vercel (values are not shown)..."
get() { grep -E "^$1=" .env.local | tail -1 | cut -d= -f2- | tr -d '\r'; }
for NAME in NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY; do
  VALUE="$(get "$NAME")"
  if [ -z "$VALUE" ]; then echo "$NAME is missing in .env.local"; exit 1; fi
  for ENVIRONMENT in production; do
    $V env rm "$NAME" "$ENVIRONMENT" --yes >/dev/null 2>&1 || true
    printf '%s' "$VALUE" | $V env add "$NAME" "$ENVIRONMENT" >/dev/null
    echo "     $NAME added for $ENVIRONMENT"
  done
done

# Optional: contact form emails (Resend key and inbox), the mail server secret, and the Assistant's Claude key. Skipped when the files are empty.
for PAIR in "RESEND_API_KEY:.resend-key" "CONTACT_INBOX:.contact-inbox" "MAIL_SERVER_SECRET:.mail-secret" "ANTHROPIC_API_KEY:.anthropic-key" "VERIFIER_URL:.verifier-url" "VERIFIER_SECRET:.verifier-secret"; do
  NAME="${PAIR%%:*}"; FILE="${PAIR#*:}"
  VALUE=""; [ -f "$FILE" ] && VALUE="$(tr -d '[:space:]' < "$FILE")"
  if [ -n "$VALUE" ]; then
    $V env rm "$NAME" production --yes >/dev/null 2>&1 || true
    printf '%s' "$VALUE" | $V env add "$NAME" production >/dev/null
    echo "     $NAME added for production"
  fi
done

echo "4/4  Publishing (this takes about 2 minutes)..."
$V deploy --prod --yes --archive=tgz
echo ""
echo "Done. The address after 'Production:' above is your live Kestrel site."
