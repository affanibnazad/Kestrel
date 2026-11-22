// Answers "kestrel-ok": the tracking-domain check loads this through the team's own domain to prove it reaches Kestrel.
export function GET() {
  return new Response("kestrel-ok", { headers: { "content-type": "text/plain", "cache-control": "no-store" } });
}
