"use client";

import { askConfirm, askText } from "@/components/dialog";
import { useCallback, useEffect, useState } from "react";
import { Tip } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/client";
import { INTRO } from "@/lib/plans";
import SideDrawer from "./side-drawer";

// Owner → Creators (Kestrel admins only, database 040): the people who recommend Kestrel, their code and link, the teams
// they brought, and the commission earned, held (30 days, for refunds), owed and paid. Affan pays creators himself
// (bank or PayPal) and clicks Mark paid. Applications from the /creators page are listed below.
type Creator = {
  id: string; name: string; email: string; code: string; rate: number; months: number; founding: boolean;
  status: "active" | "paused" | "ended"; notes: string | null; created_at: string;
  signups: number; paying: number; blocked: number; money: Money; teams?: Team[];
};
// Every team that came from the creator (database 041), so an admin can spot an own account or a fake team.
type Team = { id: string; created_at: string; source: "link" | "code"; status: "ok" | "blocked"; blocked_reason: string | null; team: string; owner_email: string | null; state: string };
// US cents. back = refunds of commission already paid out, taken off the next payout. test = test-mode commission (never paid).
type Money = { earned: number; held: number; owed: number; paid: number; back: number; revenue: number; test: number };
type Application = { id: string; name: string; email: string; link: string; audience: string | null; about: string | null; status: "new" | "approved" | "declined"; created_at: string };
type Draft = { id: string | null; name: string; email: string; code: string; rate: number; months: number; founding: boolean; status: Creator["status"]; notes: string };

const usd = (cents: number) => `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const EMPTY: Draft = { id: null, name: "", email: "", code: "", rate: 30, months: 12, founding: false, status: "active", notes: "" };
const STATUS = { active: "Active", paused: "Paused", ended: "Ended" } as const;

export default function CreatorsView({ toast }: { toast: (t: string) => void }) {
  const [creators, setCreators] = useState<Creator[] | null>(null);
  const [apps, setApps] = useState<Application[]>([]);
  const [msg, setMsg] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [teamsOf, setTeamsOf] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabaseBrowser().rpc("owner_creators");
    if (error) { setMsg(/owner_creators|schema cache/.test(error.message) ? "The creator program is not switched on yet (database 040)." : error.message); return; }
    const d = data as { creators: Creator[]; applications: Application[] } | null;
    if (!d) { setMsg("Only Kestrel admins can see this page."); return; }
    setCreators(d.creators); setApps(d.applications); setMsg("");
  }, []);
  useEffect(() => { Promise.resolve().then(load); }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    setBusy(true); setErr("");
    const { error } = await supabaseBrowser().rpc("owner_creator_save", {
      c_id: draft.id, c_name: draft.name, c_email: draft.email, c_code: draft.code, c_rate: draft.rate, c_months: draft.months,
      c_founding: draft.founding, c_status: draft.status, c_notes: draft.notes,
    });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    toast(draft.id ? `Saved ${draft.name}.` : `Added ${draft.name}. Now make the code ${draft.code.toUpperCase()} in Lemon Squeezy.`);
    setDraft(null); load();
  }
  async function markPaid(c: Creator) {
    if (!await askConfirm(`Mark ${usd(c.money.owed)} as paid to ${c.name}? Do this after you have sent the money.`)) return;
    const { data, error } = await supabaseBrowser().rpc("owner_creator_mark_paid", { c_id: c.id });
    if (error) { toast(error.message); return; }
    toast(`Marked ${usd(Number(data) || 0)} as paid to ${c.name}.`); load();
  }
  async function block(r: Team) {
    const why = await askText(`Block ${r.team} (${r.owner_email ?? "no email"})? Its commission is taken back. Reason:`, "Own account or fake team");
    if (why === null) return;
    const { error } = await supabaseBrowser().rpc("owner_referral_block", { r_id: r.id, reason: why });
    if (error) { toast(/owner_referral_block|schema cache/.test(error.message) ? "Blocking needs database 041." : error.message); return; }
    toast(`Blocked ${r.team}.`); load();
  }
  async function setApp(a: Application, status: Application["status"]) {
    const { error } = await supabaseBrowser().rpc("owner_application_set", { a_id: a.id, a_status: status });
    if (error) { toast(error.message); return; }
    if (status === "approved") setDraft({ ...EMPTY, name: a.name, email: a.email, code: a.name.replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 12), notes: a.link });
    load();
  }
  const link = (code: string) => `https://kestrelleads.com/?ref=${code}`;
  async function copy(text: string, what: string) { await navigator.clipboard.writeText(text); toast(`Copied ${what}.`); }

  const totals = (creators ?? []).reduce((t, c) => ({ owed: t.owed + c.money.owed, held: t.held + c.money.held, paid: t.paid + c.money.paid, paying: t.paying + c.paying, revenue: t.revenue + c.money.revenue }), { owed: 0, held: 0, paid: 0, paying: 0, revenue: 0 });
  const fresh = apps.filter((a) => a.status === "new");

  return (
    <>
      {msg ? <p className="plan-msg" role="alert">{msg}</p> : null}
      {creators ? (
        <>
          <div className="owner-tiles">
            <div className="owner-tile"><small>Creators</small><b>{creators.filter((c) => c.status === "active").length}</b><span>{creators.length} in all</span></div>
            <div className="owner-tile"><small>Paying teams from creators</small><b>{totals.paying}</b><span>Revenue from them so far: {usd(totals.revenue)}</span></div>
            <div className="owner-tile"><small>Owed now</small><b>{usd(totals.owed)}</b><span>Past the 30-day hold. Pay, then Mark paid.</span></div>
            <div className="owner-tile"><small>On hold</small><b>{usd(totals.held)}</b><span>Becomes owed 30 days after each payment (refunds take it back).</span></div>
            <div className="owner-tile"><small>Paid to creators</small><b>{usd(totals.paid)}</b><span>All time.</span></div>
          </div>
          <div className="owner-bar">
            <p className="plan-msg owner-note" style={{ margin: 0, flex: 1 }}>For each creator, also make the same code in Lemon Squeezy → Discounts ({INTRO.percent}% off, {INTRO.months} months), so their audience gets the discount at checkout.</p>
            <button className="btn small go" type="button" onClick={() => { setErr(""); setDraft({ ...EMPTY }); }}>Add creator</button>
          </div>
          <div className="table-card members">
            <table className="leads">
              <thead><tr><th>Creator</th><th>Code and link</th><th>Rate <Tip text="Share of each payment, for this many months from the team's first payment." /></th><th>Sign-ups</th><th>Paying</th><th>Earned</th><th>Owed <Tip text="Commission older than 30 days that is not paid yet." /></th><th /></tr></thead>
              <tbody>{creators.map((c) => (
                <tr key={c.id}>
                  <td><b>{c.name}{c.founding ? " · Founding" : ""}</b><small className="muted-line">{c.email} · {STATUS[c.status]}</small></td>
                  <td><b>{c.code}</b><small className="muted-line"><button type="button" className="link-btn" onClick={() => copy(link(c.code), "the link")}>Copy link</button></small></td>
                  <td>{c.rate}%<small className="muted-line">{c.months} months</small></td>
                  <td>{c.signups}<small className="muted-line">{c.teams ? <button type="button" className="link-btn" onClick={() => setTeamsOf(c.id)}>See teams</button> : null}{c.blocked ? ` · ${c.blocked} blocked` : ""}</small></td>
                  <td>{c.paying}</td>
                  <td>{usd(c.money.earned)}<small className="muted-line">{usd(c.money.held)} on hold · {usd(c.money.paid)} paid{c.money.test ? ` · ${usd(c.money.test)} test` : ""}</small></td>
                  <td>{usd(c.money.owed)}{c.money.back ? <small className="muted-line">{usd(c.money.back)} refunds to take off</small> : null}</td>
                  <td className="mb-act">
                    {c.money.owed > 0 ? <button type="button" className="btn small go" onClick={() => markPaid(c)}>Mark paid</button> : null}
                    <button type="button" className="link-btn" onClick={() => { setErr(""); setDraft({ id: c.id, name: c.name, email: c.email, code: c.code, rate: c.rate, months: c.months, founding: c.founding, status: c.status, notes: c.notes ?? "" }); }}>Edit</button>
                  </td>
                </tr>
              ))}</tbody>
            </table>
            {!creators.length ? <div className="empty"><div><b>No creators yet</b><Tip text="Click Add creator. Start with the founding 10 (40% for 12 months), then approve applications from kestrelleads.com/creators." /></div></div> : null}
          </div>

          <h2 className="owner-h2">Applications {fresh.length ? `(${fresh.length} new)` : ""}</h2>
          {apps.length ? (
            <div className="owner-msgs">{apps.map((a) => (
              <article className="join-card" key={a.id}>
                <div className="owner-msg-top"><b>{a.name}{a.audience ? ` · ${a.audience}` : ""}</b><span>{a.status === "new" ? "New" : a.status === "approved" ? "Approved" : "Declined"} · {new Date(a.created_at).toLocaleDateString()}</span></div>
                <p className="owner-msg"><a href={/^https?:\/\//i.test(a.link) ? a.link : `https://${a.link}`} target="_blank" rel="noreferrer noopener">{a.link}</a>{a.about ? <><br />{a.about}</> : null}</p>
                <div className="join-row">
                  <a className="btn small glass" href={`mailto:${a.email}?subject=${encodeURIComponent("Your Kestrel creator application")}`}>Reply to {a.email}</a>
                  {a.status !== "approved" ? <button type="button" className="btn small go" onClick={() => setApp(a, "approved")}>Approve and add</button> : null}
                  {a.status === "new" ? <button type="button" className="btn small glass" onClick={() => setApp(a, "declined")}>Decline</button> : null}
                </div>
              </article>
            ))}</div>
          ) : <p className="plan-msg">No applications yet. They come from kestrelleads.com/creators.</p>}
        </>
      ) : null}

      {teamsOf ? (() => {
        const c = creators?.find((x) => x.id === teamsOf);
        return (
          <SideDrawer label={`Teams from ${c?.name ?? "creator"}`} onClose={() => setTeamsOf(null)}>
            <header className="dr-head"><div><h2>Teams from {c?.name}</h2><p>Check for own accounts or fake teams</p></div><button type="button" className="dr-x" aria-label="Close" onClick={() => setTeamsOf(null)}>×</button></header>
            <div className="dr-block">
              {(c?.teams ?? []).length ? (c?.teams ?? []).map((r) => (
                <div className="cell creator-team" key={r.id}>
                  <div><b>{r.team}</b><small className="muted-line">{r.owner_email ?? "—"} · {new Date(r.created_at).toLocaleDateString()} · {r.source === "link" ? "link" : "code"} · {r.state}</small>
                    {r.status === "blocked" ? <small className="muted-line">Blocked: {r.blocked_reason}</small> : null}</div>
                  {r.status === "ok" ? <button type="button" className="btn small glass" onClick={() => block(r)}>Block</button> : null}
                </div>
              )) : <p className="plan-msg">No teams yet.</p>}
            </div>
          </SideDrawer>
        );
      })() : null}

      {draft ? (
        <SideDrawer label={draft.id ? "Edit creator" : "Add creator"} onClose={() => setDraft(null)}>
          <header className="dr-head"><div><h2>{draft.id ? "Edit creator" : "Add creator"}</h2><p>Their code works at sign-up and checkout</p></div><button type="button" className="dr-x" aria-label="Close" onClick={() => setDraft(null)}>×</button></header>
          <form className="dr-block prof-form" onSubmit={save}>
            <label className="in"><span>Name</span><input required maxLength={80} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
            <label className="in"><span>Email <Tip text="They see their numbers in the App when they sign in with this email." /></span><input required type="email" maxLength={200} value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} /></label>
            <label className="in"><span>Code</span><input required pattern="[A-Za-z0-9]{3,20}" maxLength={20} value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value.replace(/[^a-z0-9]/gi, "").toUpperCase() })} placeholder="ALEX" /></label>
            <div className="row2">
              <label className="in"><span>Commission %</span><input type="number" min={1} max={60} value={draft.rate} onChange={(e) => setDraft({ ...draft, rate: Number(e.target.value) })} /></label>
              <label className="in"><span>For months</span><input type="number" min={1} max={120} value={draft.months} onChange={(e) => setDraft({ ...draft, months: Number(e.target.value) })} /></label>
            </div>
            <label className="owner-check"><input type="checkbox" checked={draft.founding} onChange={(e) => setDraft({ ...draft, founding: e.target.checked, rate: e.target.checked && draft.rate === 30 ? 40 : draft.rate })} /> Founding creator (40%)</label>
            <label className="in"><span>Status</span><select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as Creator["status"] })}>
              <option value="active">Active</option><option value="paused">Paused (no new sign-ups, keeps earning)</option><option value="ended">Ended (stops earning)</option></select></label>
            <label className="in"><span>Notes <em>optional</em></span><textarea rows={3} maxLength={1000} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></label>
            {err ? <p className="login-note bad" role="alert">{err}</p> : null}
            <div className="join-row"><button className="btn go small" type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</button></div>
          </form>
        </SideDrawer>
      ) : null}
    </>
  );
}
