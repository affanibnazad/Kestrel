import "server-only";

// Lemon Squeezy API (https://docs.lemonsqueezy.com/api), only what Owner → Offers needs: find the store, and create or
// delete discount codes. The key comes from Vault (database 046) and is never returned to the browser.
// Kestrel stays in Lemon Squeezy test mode until Affan says live; a test-mode key makes test-mode discounts.
const API = "https://api.lemonsqueezy.com/v1";
export type LsDiscount = {
  name: string; code: string; amount_type: "percent" | "fixed"; amount: number; duration: "once" | "repeating" | "forever"; months: number | null;
  variantIds: string[]; maxUses: number | null; startsAt: string | null; endsAt: string | null; testMode?: boolean;
};

async function call(key: string, path: string, init: { method?: string; body?: unknown } = {}) {
  const res = await fetch(`${API}/${path}`, {
    method: init.method ?? "GET", redirect: "error", signal: AbortSignal.timeout(15_000), cache: "no-store",
    headers: { accept: "application/vnd.api+json", "content-type": "application/vnd.api+json", authorization: `Bearer ${key}` },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const json = res.status === 204 ? {} : await res.json().catch(() => ({})) as Record<string, unknown>;
  return { status: res.status, ok: res.ok, json: json as { data?: unknown; errors?: { detail?: string; title?: string }[] } };
}
const why = (r: { status: number; json: { errors?: { detail?: string; title?: string }[] } }) =>
  `Lemon Squeezy ${r.status}: ${r.json.errors?.map((e) => e.detail || e.title).filter(Boolean).join("; ") || "no details"}`.slice(0, 280);

// The first store of this key, and whether the key is a test-mode key.
export async function lemonStore(key: string): Promise<{ ok: true; storeId: string; name: string; testMode: boolean | null } | { ok: false; note: string }> {
  const r = await call(key, "stores");
  if (r.status === 401) return { ok: false, note: "Lemon Squeezy did not accept this key. Make a new one in Settings → API." };
  if (!r.ok) return { ok: false, note: why(r) };
  const store = (r.json.data as { id: string; attributes?: { name?: string } }[] | undefined)?.[0];
  if (!store) return { ok: false, note: "This key has no store." };
  const me = await call(key, "users/me");
  const testMode = (me.json as { meta?: { test_mode?: boolean } }).meta?.test_mode ?? null;
  return { ok: true, storeId: String(store.id), name: String(store.attributes?.name ?? ""), testMode };
}

export async function createDiscount(key: string, storeId: string, d: LsDiscount): Promise<{ id: string } | { error: string }> {
  const attributes: Record<string, unknown> = {
    name: d.name.slice(0, 80), code: d.code, amount: d.amount, amount_type: d.amount_type, duration: d.duration,
    ...(d.duration === "repeating" ? { duration_in_months: d.months ?? 1 } : {}),
    is_limited_to_products: d.variantIds.length > 0,
    is_limited_redemptions: Boolean(d.maxUses), ...(d.maxUses ? { max_redemptions: d.maxUses } : {}),
    ...(d.startsAt ? { starts_at: d.startsAt } : {}), ...(d.endsAt ? { expires_at: d.endsAt } : {}),
    ...(d.testMode ? { test_mode: true } : {}),
  };
  const r = await call(key, "discounts", { method: "POST", body: { data: { type: "discounts", attributes, relationships: {
    store: { data: { type: "stores", id: storeId } },
    ...(d.variantIds.length ? { variants: { data: d.variantIds.map((id) => ({ type: "variants", id })) } } : {}),
  } } } });
  if (!r.ok) return { error: r.status === 422 && /code/i.test(why(r)) ? `A discount with the code ${d.code} already exists in Lemon Squeezy. Delete it there (Store → Discounts), then sync again.` : why(r) };
  const id = (r.json.data as { id?: string } | undefined)?.id;
  return id ? { id: String(id) } : { error: "Lemon Squeezy did not return the discount." };
}

export async function deleteDiscount(key: string, id: string): Promise<{ ok: boolean; error?: string }> {
  const r = await call(key, `discounts/${encodeURIComponent(id)}`, { method: "DELETE" });
  return r.ok || r.status === 404 ? { ok: true } : { ok: false, error: why(r) };
}
