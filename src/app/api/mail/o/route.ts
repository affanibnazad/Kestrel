import { createClient } from "@supabase/supabase-js";
import { SUPABASE_KEY, SUPABASE_URL } from "@/lib/supabase/config";

// The open-tracking image (1×1 transparent GIF) in campaign emails, loaded from the team's own tracking domain.
// Each load is recorded as "opened" (an estimate: Gmail keeps the image after the first load; Apple Mail loads every image).
// Always answers with the image, so nothing breaks in the email even if recording fails.
const GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
const image = () => new Response(GIF, { headers: { "content-type": "image/gif", "cache-control": "no-store, no-cache, must-revalidate, private", "content-length": String(GIF.length) } });

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("t") || "", step = Number(url.searchParams.get("s"));
  if (/^[0-9a-f]{20,80}$/.test(token) && Number.isInteger(step) && step >= 0 && step < 10) {
    const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const agent = request.headers.get("user-agent") || "";
    const who = /GoogleImageProxy/i.test(agent) ? "Gmail" : /Mozilla\/5\.0$/.test(agent.trim()) ? "Apple Mail (may open by itself)" : /Outlook|Microsoft/i.test(agent) ? "Outlook" : "Other";
    await sb.rpc("mail_open", { token, step, host: url.hostname, agent: who }).then(() => null, () => null);
  }
  return image();
}
