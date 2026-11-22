"use client";

import { askConfirm } from "@/components/dialog";
import { useCallback, useEffect, useState } from "react";
import { Tip } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/client";
import { planName, type PlanId } from "@/lib/plans";

// Access (admins only): give people free access for a limited time, with a code or an invitation link, and take it back.
type Code = { code: string; label: string; plan: PlanId; days: number; max_uses: number; used: number; claim_until: string | null; revoked_at: string | null; created_at: string };
type Grant = { id: string; team: string; owner: string | null; code: string | null; plan: PlanId; starts_at: string; ends_at: string; revoked_at: string | null };

const day = (s: string | null) => (s ? new Date(s).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "");
const linkFor = (code: string) => `${typeof window === "undefined" ? "https://kestrelleads.com" : location.origin}/redeem?code=${code}`;

export default function AccessView({ toast, embedded = false }: { toast: (t: string) => void; embedded?: boolean }) {
  const [codes, setCodes] = useState<Code[]>([]);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [form, setForm] = useState({ label: "", plan: "pro" as PlanId, days: "30", uses: "1", claim: "14" });
  const [msg, setMsg] = useState("");
  const [now] = useState(() => Date.now());

  const load = useCallback(async () => {
    const { data, error } = await supabaseBrowser().rpc("admin_access");
    if (error) { setMsg(/admin_access/.test(error.message) ? "Access codes are not switched on yet (database 009)." : error.message); return; }
    const d = data as { codes: Code[]; grants: Grant[] } | null;
    if (!d) { setMsg("Only Kestrel admins can see this page."); return; }
    setCodes(d.codes); setGrants(d.grants);
  }, []);
  useEffect(() => { Promise.resolve().then(load); }, [load]);

  async function make(e: React.FormEvent) {
    e.preventDefault(); setMsg("");
    const { data, error } = await supabaseBrowser().rpc("admin_new_code", { label: form.label.trim(), plan: form.plan, days: Number(form.days), max_uses: Number(form.uses), claim_days: Number(form.claim) || 0 });
    if (error) { setMsg(error.message); return; }
    await navigator.clipboard.writeText(linkFor(String(data))).catch(() => {});
    toast(`Made ${data}. Invitation link copied.`);
    setForm({ ...form, label: "" }); load();
  }
  async function run(fn: string, args: object, done: string, ask?: string) {
    if (ask && !await askConfirm(ask)) return;
    const { error } = await supabaseBrowser().rpc(fn, args);
    if (error) setMsg(error.message); else { toast(done); load(); }
  }
  const copy = async (text: string, what: string) => { await navigator.clipboard.writeText(text); toast(`${what} copied.`); };

  const live = (g: Grant) => !g.revoked_at && Date.parse(g.ends_at) > now;
  const codeState = (c: Code) => c.revoked_at ? "Switched off" : c.claim_until && Date.parse(c.claim_until) < now ? "Expired" : c.used >= c.max_uses ? "Used up" : "Open";

  return (
    <div className={embedded ? "" : "app-page"}>
      {embedded ? null : <header className="head"><div><h1>Access <Tip text="Give people free use of Kestrel for a limited time. Make a code, then send the code or its invitation link. The team owner claims it in the App (Plan and billing) and gets free access for the days you chose. Take it back at any time." /></h1>
        <span className="sub">{grants.filter(live).length} teams with free access now · {codes.filter((c) => codeState(c) === "Open").length} open codes</span></div></header>}

      <form className="join-card prof-form access-new" onSubmit={make}>
        <b>Make an access code</b>
        <div className="access-grid">
          <label className="in"><span>For (your note)</span><input value={form.label} maxLength={80} placeholder="Imtiaz, beta testers…" onChange={(e) => setForm({ ...form, label: e.target.value })} /></label>
          <label className="in"><span>Plan</span><select value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value as PlanId })}>{(["starter", "pro", "agency"] as PlanId[]).map((p) => <option key={p} value={p}>{planName(p)}</option>)}</select></label>
          <label className="in"><span>Free days</span><input type="number" min={1} max={366} required value={form.days} onChange={(e) => setForm({ ...form, days: e.target.value })} /></label>
          <label className="in"><span>How many teams <Tip text="How many different teams can use this code. 1 = a personal code." /></span><input type="number" min={1} max={1000} required value={form.uses} onChange={(e) => setForm({ ...form, uses: e.target.value })} /></label>
          <label className="in"><span>Claim within (days) <Tip text="After this many days the code can no longer be claimed. 0 = no limit. Access already claimed is not affected." /></span><input type="number" min={0} max={366} value={form.claim} onChange={(e) => setForm({ ...form, claim: e.target.value })} /></label>
        </div>
        <div className="join-row"><button className="btn go" type="submit">Make code and copy link</button></div>
      </form>

      {codes.length ? (
        <div className="table-card members">
          <table className="leads">
            <thead><tr><th>Code</th><th>For</th><th>Gives</th><th>Used</th><th>Status</th><th /></tr></thead>
            <tbody>{codes.map((c) => (
              <tr key={c.code}>
                <td><b className="mono">{c.code}</b></td><td>{c.label || "—"}</td><td>{planName(c.plan)}, {c.days} days</td><td>{c.used} of {c.max_uses}</td>
                <td>{codeState(c)}{c.claim_until && codeState(c) === "Open" ? <small className="muted-line">claim by {day(c.claim_until)}</small> : null}</td>
                <td className="row-acts">
                  {codeState(c) === "Open" ? <>
                    <button className="link-btn" type="button" onClick={() => copy(linkFor(c.code), "Invitation link")}>Copy link</button>
                    <button className="link-btn" type="button" onClick={() => copy(c.code, "Code")}>Copy code</button>
                  </> : null}
                  {!c.revoked_at ? <button className="link-btn bad" type="button" onClick={() => run("admin_revoke_code", { code: c.code }, `${c.code} switched off.`, `Switch off ${c.code}? Nobody can claim it any more, and every team that used it loses its free access now.`)}>Switch off</button> : null}
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : null}

      {grants.length ? (
        <div className="table-card members">
          <table className="leads">
            <thead><tr><th>Team</th><th>Owner</th><th>Access</th><th>Until</th><th /></tr></thead>
            <tbody>{grants.map((g) => (
              <tr key={g.id}>
                <td>{g.team}</td><td>{g.owner ?? "—"}</td><td>{planName(g.plan)}{g.code ? <small className="muted-line">{g.code}</small> : null}</td>
                <td>{live(g) ? day(g.ends_at) : g.revoked_at ? `Taken back ${day(g.revoked_at)}` : `Ended ${day(g.ends_at)}`}</td>
                <td className="row-acts">
                  <button className="link-btn" type="button" onClick={() => run("admin_extend_grant", { grant_id: g.id, days: 30 }, `${g.team}: 30 more days.`)}>+30 days</button>
                  {live(g) ? <button className="link-btn bad" type="button" onClick={() => run("admin_revoke_grant", { grant_id: g.id }, `Access taken back from ${g.team}.`, `Take free access back from ${g.team} now? Their trial or paid plan rules apply again at once.`)}>Take back</button> : null}
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : null}

      {msg ? <p className="plan-msg" role="alert">{msg}</p> : null}
    </div>
  );
}
