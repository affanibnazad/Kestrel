import { NextResponse } from "next/server";
import { currentUser, supabaseServer } from "@/lib/supabase/server";
import { createDiscount, deleteDiscount, lemonStore, type LsDiscount } from "@/lib/lemon";

// Owner → Offers (database 046, Kestrel admins only). Saves an offer and makes the matching discount code in Lemon
// Squeezy, deletes one, makes every creator's code, or tests the Lemon Squeezy key. The key is read from Vault on this
// server (server secret + admin) and never sent to the browser. Lemon Squeezy has no "edit discount", so a changed offer
// gets its old discount deleted and a new one made with the same code.
export const maxDuration = 60;

type Offer = { id: string; name: string; code: string | null; kind: "everyone" | "code" | "creators"; amount_type: "percent" | "fixed"; amount: number;
  duration: "once" | "repeating" | "forever"; months: number | null; plans: string[]; starts_at: string | null; ends_at: string | null; max_uses: number | null;
  active: boolean; ls_discount_id: string | null };
type Creator = { id: string; name: string; code: string; status: string; ls_discount_id: string | null };
type Admin = { offers: Offer[]; creators: Creator[]; variants: Record<string, string>; lemon: { store_id: string | null; test_mode: boolean | null } | null };
type Body = { action?: string; id?: string; offer?: Partial<Offer> & { plans?: string[] }; all?: boolean };

const plain = (e: { message: string } | null | undefined) => e?.message || "Something went wrong.";

export async function POST(req: Request) {
  if (!(await currentUser())) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const sb = await supabaseServer();
  const { data: admin } = await sb.rpc("is_admin");
  if (admin !== true) return NextResponse.json({ error: "Only Kestrel admins can change offers." }, { status: 403 });
  const ms = process.env.MAIL_SERVER_SECRET || "";
  const body = await req.json().catch(() => ({})) as Body;

  const state = async () => {
    const { data, error } = await sb.rpc("offers_admin");
    if (error) throw new Error(/offers_admin|schema cache/i.test(error.message) ? "Offers need database 046." : error.message);
    return data as Admin;
  };
  const lemon = async () => {
    if (ms.length < 32) return { error: "The server secret is missing on Vercel (MAIL_SERVER_SECRET)." };
    const { data, error } = await sb.rpc("lemon_for_server", { server_secret: ms });
    const c = data as { key: string | null; store_id: string | null } | null;
    if (error || !c?.key) return { error: "Add your Lemon Squeezy API key first (top of this page)." };
    let store = c.store_id;
    if (!store) {
      const s = await lemonStore(c.key);
      if (!s.ok) return { error: s.note };
      store = s.storeId;
      await sb.rpc("record_lemon_check", { ok: true, note: `Connected to ${s.name}${s.testMode ? " (test mode)" : ""}.`, store, test: s.testMode });
    }
    return { key: c.key, store };
  };
  const discountFor = (o: Pick<Offer, "name" | "amount_type" | "amount" | "duration" | "months" | "plans" | "max_uses" | "starts_at" | "ends_at">, code: string, a: Admin): LsDiscount => ({
    name: o.name, code, amount_type: o.amount_type, amount: o.amount, duration: o.duration, months: o.months,
    variantIds: (o.plans ?? []).map((p) => a.variants[p]).filter(Boolean), maxUses: o.max_uses, startsAt: o.starts_at, endsAt: o.ends_at,
    testMode: a.lemon?.test_mode === true,
  });

  // Make (or remake) the Lemon Squeezy discount of one offer.
  const syncOffer = async (id: string) => {
    const a = await state();
    const o = a.offers.find((x) => x.id === id);
    if (!o || o.kind === "creators" || !o.code) return { ok: true, note: "" };
    const l = await lemon();
    if ("error" in l) { await sb.rpc("offer_mark_synced", { o_id: id, ls_id: o.ls_discount_id ?? "", err: l.error }); return { ok: false, note: l.error }; }
    if (o.ls_discount_id) {
      const d = await deleteDiscount(l.key!, o.ls_discount_id);
      if (!d.ok) { await sb.rpc("offer_mark_synced", { o_id: id, ls_id: o.ls_discount_id, err: d.error }); return { ok: false, note: d.error ?? "" }; }
    }
    if (!o.active) { await sb.rpc("offer_mark_synced", { o_id: id, ls_id: "", err: "" }); return { ok: true, note: "Switched off: its Lemon Squeezy code was removed." }; }
    // The old code is gone by now. A plan-limited offer must never become an any-plan discount because a plan has no
    // Lemon Squeezy product: then no new code is made.
    const noVariant = (o.plans ?? []).filter((p) => !a.variants[p]);
    if (noVariant.length) {
      const err = `No Lemon Squeezy product is set for ${noVariant.join(", ")} (run setup-payments first), so this plan-limited code was not made.`;
      await sb.rpc("offer_mark_synced", { o_id: id, ls_id: "", err });
      return { ok: false, note: err };
    }
    const r = await createDiscount(l.key!, l.store!, discountFor(o, o.code, a));
    await sb.rpc("offer_mark_synced", { o_id: id, ls_id: "id" in r ? r.id : "", err: "error" in r ? r.error : "" });
    return "error" in r ? { ok: false, note: r.error } : { ok: true, note: `Code ${o.code} is ready in Lemon Squeezy.` };
  };

  try {
    if (body.action === "lemon_test") {
      const { data } = await sb.rpc("lemon_for_server", { server_secret: ms });
      const key = (data as { key?: string } | null)?.key;
      if (!key) return NextResponse.json({ error: "Add the key first." }, { status: 400 });
      const s = await lemonStore(key);
      const note = s.ok ? `Connected to ${s.name}${s.testMode ? " (test mode)" : s.testMode === false ? " (LIVE mode)" : ""}.` : s.note;
      await sb.rpc("record_lemon_check", { ok: s.ok, note, store: s.ok ? s.storeId : "", test: s.ok ? s.testMode : null });
      return NextResponse.json({ ok: s.ok, note });
    }

    if (body.action === "save" && body.offer) {
      const o = body.offer;
      const { data: id, error } = await sb.rpc("offer_save", {
        o_id: o.id ?? null, o_name: String(o.name ?? "").slice(0, 80), o_code: o.code ?? null, o_kind: o.kind, o_amount_type: o.amount_type,
        o_amount: Math.round(Number(o.amount) || 0), o_duration: o.duration, o_months: o.months ?? null,
        o_plans: (o.plans ?? []).filter((p) => ["starter", "pro", "agency"].includes(p)),
        o_starts_at: o.starts_at || null, o_ends_at: o.ends_at || null, o_max_uses: o.max_uses ?? null, o_active: o.active !== false,
      });
      if (error) return NextResponse.json({ error: plain(error) }, { status: 400 });
      if (o.kind === "creators") return NextResponse.json({ ok: true, note: "Saved. Click “Make creator codes” to update every creator's code in Lemon Squeezy." });
      const s = await syncOffer(String(id));
      return NextResponse.json({ ok: true, note: s.ok ? `Saved. ${s.note}` : `Saved in Kestrel, but not in Lemon Squeezy: ${s.note}` });
    }

    if (body.action === "sync" && body.id) {
      const s = await syncOffer(body.id);
      return NextResponse.json(s.ok ? { ok: true, note: s.note } : { error: s.note }, { status: s.ok ? 200 : 400 });
    }

    // Delete in Lemon Squeezy first: if that fails the offer stays in Kestrel (so the code is never left working there unseen).
    if (body.action === "delete" && body.id) {
      const a = await state();
      const o = a.offers.find((x) => x.id === body.id);
      if (!o || o.kind === "creators") return NextResponse.json({ error: "Offer not found (the creator offer cannot be deleted, only changed)." }, { status: 400 });
      if (o.ls_discount_id) {
        const l = await lemon();
        if ("error" in l) return NextResponse.json({ error: `Not deleted: ${l.error}` }, { status: 400 });
        const d = await deleteDiscount(l.key!, o.ls_discount_id);
        if (!d.ok) return NextResponse.json({ error: `Not deleted, Lemon Squeezy refused: ${d.error}` }, { status: 400 });
      }
      const { error } = await sb.rpc("offer_delete", { o_id: body.id });
      if (error) return NextResponse.json({ error: plain(error) }, { status: 400 });
      return NextResponse.json({ ok: true, note: "Offer deleted, also in Lemon Squeezy." });
    }

    // Every active creator's code as a Lemon Squeezy discount with the creator offer (all: remake the ones already there too).
    if (body.action === "sync_creators") {
      const a = await state();
      const co = a.offers.find((x) => x.kind === "creators");
      if (!co) return NextResponse.json({ error: "The creator offer is missing (database 046)." }, { status: 400 });
      const l = await lemon();
      if ("error" in l) return NextResponse.json({ error: l.error }, { status: 400 });
      let made = 0, failed = 0, last = "";
      const started = Date.now();
      for (const c of a.creators) {
        if (Date.now() - started > 45_000) break;
        const remake = body.all || !c.ls_discount_id;
        if (!remake && c.status === "active") continue;
        if (c.ls_discount_id) await deleteDiscount(l.key!, c.ls_discount_id);
        if (c.status !== "active" || !co.active) { await sb.rpc("creator_mark_synced", { c_id: c.id, ls_id: "", err: "" }); continue; }
        const r = await createDiscount(l.key!, l.store!, discountFor({ ...co, name: `Creator ${c.name}` }, c.code, a));
        await sb.rpc("creator_mark_synced", { c_id: c.id, ls_id: "id" in r ? r.id : "", err: "error" in r ? r.error : "" });
        if ("error" in r) { failed++; last = r.error; } else made++;
      }
      return NextResponse.json({ ok: failed === 0, note: `${made} creator ${made === 1 ? "code" : "codes"} made in Lemon Squeezy${failed ? `, ${failed} failed: ${last}` : "."}` });
    }
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
