// The extension's live page rules (see lib/ext-rules.ts). Public, read-only, the same for everyone; no user data.
// Fixed at publish time; browsers and Vercel may keep it for 5 minutes.
import { EXT_RULES } from "@/lib/ext-rules";

export function GET() {
  return Response.json(EXT_RULES, {
    headers: { "cache-control": "public, max-age=300, s-maxage=300", "x-content-type-options": "nosniff" },
  });
}
