// A business's website icon for its avatar in the App (like the leading outreach tools show company logos).
// Fetched from Google's public favicon service on the server, so the visitor's browser never talks to Google, and
// cached for a week. Only plain domain names are accepted; anything else, or a site without its own icon, is a 404
// and the App shows the business's initials instead.

const DOMAIN = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;

export async function GET(req: Request) {
  const d = (new URL(req.url).searchParams.get("d") || "").trim().toLowerCase().replace(/^www\./, "");
  if (!DOMAIN.test(d) || d.endsWith(".test") || d.endsWith(".local") || d.endsWith(".localhost")) return new Response(null, { status: 404 });
  try {
    const r = await fetch(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(d)}&sz=64`, { redirect: "follow", signal: AbortSignal.timeout(4000) });
    const type = r.headers.get("content-type") || "";
    // Google answers 404 (with a grey globe) when the site has no icon of its own: treat that as "no logo".
    if (!r.ok || !/^image\//.test(type)) return new Response(null, { status: 404, headers: { "cache-control": "public, max-age=86400, s-maxage=86400" } });
    const body = await r.arrayBuffer();
    if (body.byteLength > 200_000) return new Response(null, { status: 404 });
    return new Response(body, { headers: { "content-type": type, "cache-control": "public, max-age=604800, s-maxage=604800, immutable", "x-content-type-options": "nosniff" } });
  } catch {
    return new Response(null, { status: 404 });
  }
}
