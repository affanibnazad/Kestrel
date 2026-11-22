"use client";

import { askConfirm } from "@/components/dialog";
import { useMemo, useRef, useState } from "react";
import { Tip } from "@/components/ui";
import { dncBlocks, dncIndex, dncMatchCounts, normalizeDnc, parseDncList, type DncRow } from "@/lib/dnc";
import type { LeadRow } from "@/lib/leads";
import SideDrawer from "./side-drawer";
import { csvCell } from "@/lib/csv-cell";

// The team's Do-not-contact list (a "blocklist" in the leading tools): emails and whole domains, shared with every
// connected extension. Laid out like Email accounts and Campaigns: header buttons, search and filter, one flat table,
// and "Add new" in a side panel.
type Show = "all" | "email" | "domain";
const HELP = "People who said no, bounced or unsubscribed. A whole domain (company.com) blocks every email and website on it. Leads that match are marked, never exported, never emailed and never get AI drafts, here and in every connected extension.";

export default function DncView({ rows, leads, canBlock, canRemove, add, remove }: {
  rows: DncRow[]; leads: LeadRow[]; canBlock: boolean; canRemove: boolean;
  add: (items: { entry: string; reason?: string }[]) => Promise<number>; remove: (entry: string) => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [one, setOne] = useState("");
  const [why, setWhy] = useState("");
  const [many, setMany] = useState("");
  const [query, setQuery] = useState("");
  const [show, setShow] = useState<Show>("all");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const matched = useMemo(() => { const idx = dncIndex(rows); return leads.filter((l) => dncBlocks(l, idx)).length; }, [rows, leads]);
  const counts = useMemo(() => dncMatchCounts(rows, leads), [rows, leads]);
  const domains = rows.filter((r) => !r.entry.includes("@")).length;
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => (show === "all" || (show === "email") === r.entry.includes("@"))
      && (!q || r.entry.includes(q) || (r.reason ?? "").toLowerCase().includes(q)));
  }, [rows, query, show]);
  const said = (n: number, total: number) => n ? `Added ${n.toLocaleString()} to Do-not-contact.${total > n ? ` ${(total - n).toLocaleString()} ${total - n === 1 ? "was" : "were"} already listed.` : ""}` : total ? "Already on the list." : "";

  async function addOne(e: React.FormEvent) {
    e.preventDefault();
    const entry = normalizeDnc(one);
    if (!entry) { setMsg("Type an email (name@company.com) or a website (company.com)."); return; }
    setBusy(true); setMsg(said(await add([{ entry, reason: why }]), 1)); setBusy(false);
    setOne(""); setWhy("");
  }
  async function addMany(text: string) {
    const list = parseDncList(text);
    if (!list.length) { setMsg("No emails or websites found. Put one per line, or use a CSV with an email or domain column."); return; }
    setBusy(true); setMsg(said(await add(list), list.length)); setBusy(false); setMany("");
  }
  async function readFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; e.target.value = "";
    if (f) await addMany(await f.text());
  }
  function saveCsv() {
    const cell = csvCell;
    const text = "﻿" + [["email_or_domain", "reason", "date_added"], ...rows.map((r) => [r.entry, r.reason ?? "", r.created_at.slice(0, 10)])].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
    a.download = `kestrel-do-not-contact-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  return (
    <div className="app-page">
      <header className="head">
        <div>
          <h1>Do-not-contact <Tip text={HELP} /></h1>
          <span className="sub">{rows.length.toLocaleString()} blocked · {domains.toLocaleString()} {domains === 1 ? "domain" : "domains"} · {matched.toLocaleString()} {matched === 1 ? "lead matches" : "leads match"}</span>
        </div>
        <div className="head-actions">
          <button type="button" className="btn glass small" disabled={!rows.length} onClick={saveCsv}>Export CSV</button>
          {canBlock ? (
            <>
              <input ref={fileInput} type="file" accept=".csv,.txt,text/csv,text/plain" hidden onChange={readFile} />
              <button type="button" className="btn glass small" disabled={busy} title="A CSV with an email, domain or entry column, or one per line" onClick={() => fileInput.current?.click()}>Import CSV</button>
              <button type="button" className="btn go small" onClick={() => { setMsg(""); setAdding(true); }}>Add new</button>
            </>
          ) : null}
        </div>
      </header>
      {msg && !adding ? <p className="plan-msg" role="status">{msg}</p> : null}
      {!canBlock ? <p className="plan-msg">Viewers can see the list but not change it.</p> : null}

      <div className="acct-bar">
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search the list" aria-label="Search the Do-not-contact list" />
        <div className="seg" role="group" aria-label="Show">
          {([["all", "All"], ["email", "Emails"], ["domain", "Domains"]] as [Show, string][]).map(([id, name]) => (
            <button key={id} type="button" className={show === id ? "on" : ""} aria-pressed={show === id} onClick={() => setShow(id)}>{name}</button>
          ))}
        </div>
      </div>

      <div className="table-card members acct-table">
        <table className="leads">
          <thead><tr><th>Email or domain</th><th>Type</th><th>Reason</th><th>Leads matched <Tip text="How many of your leads this entry blocks. A domain blocks every email and website on it, subdomains included." /></th><th>Added</th><th /></tr></thead>
          <tbody>{shown.slice(0, 1000).map((r) => {
            const isMail = r.entry.includes("@"), n = counts.get(r.entry) ?? 0;
            return (
              <tr key={r.entry}>
                <td><b>{r.entry}</b></td>
                <td><em className="pill">{isMail ? "Email" : "Domain"}</em></td>
                <td>{r.reason || <span className="muted-line">—</span>}</td>
                <td>{n.toLocaleString()}</td>
                <td>{new Date(r.created_at).toLocaleDateString()}</td>
                <td className="mb-act">{canRemove ? <button type="button" className="link-btn" onClick={async () => { if (await askConfirm(`Take ${r.entry} off the Do-not-contact list? Kestrel may then export and email it again.`)) remove(r.entry); }}>Remove</button> : null}</td>
              </tr>
            );
          })}</tbody>
        </table>
        {!shown.length ? <div className="empty"><div><b>{rows.length ? "Nothing matches" : "Nobody on the list yet"}</b>{rows.length ? null : <Tip text="Click Add new to block one email or a whole domain, or Import CSV for a list. People who unsubscribe, reply “remove me” or bounce are added by themselves." />}</div></div> : null}
        {shown.length > 1000 ? <p className="plan-msg" style={{ margin: "12px 16px" }}>Showing the newest 1,000. Search to find others, or export the whole list.</p> : null}
      </div>

      {adding ? (
        <SideDrawer label="Add to Do-not-contact" onClose={() => setAdding(false)}>
          <header className="dr-head"><div><h2>Add to Do-not-contact</h2><p>For the whole team</p></div><button type="button" className="dr-x" aria-label="Close" onClick={() => setAdding(false)}>×</button></header>
          <form className="dr-block prof-form" onSubmit={addOne}>
            <h3>One email or domain</h3>
            <label className="in"><span>Email or website</span><input autoFocus value={one} onChange={(e) => setOne(e.target.value)} placeholder="name@company.com or company.com" disabled={busy} autoComplete="off" /></label>
            <label className="in"><span>Reason <em>optional</em></span><input value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Said no, bounced, unsubscribed…" maxLength={200} disabled={busy} /></label>
            <div className="join-row"><button className="btn go small" type="submit" disabled={busy || !one.trim()}>Add</button></div>
          </form>
          <section className="dr-block prof-form">
            <h3>Many at once <Tip text="Paste one email or website per line. Or use Import CSV in the page header for a file with a column named email, domain or entry (and an optional reason column)." /></h3>
            <label className="in"><span>Paste a list</span><textarea className="dnc-paste" rows={6} value={many} onChange={(e) => setMany(e.target.value)} placeholder={"name@company.com\nothercompany.com"} disabled={busy} /></label>
            <div className="join-row"><button className="btn go small" type="button" disabled={busy || !many.trim()} onClick={() => addMany(many)}>Add list</button></div>
          </section>
          {msg ? <p className="plan-msg" role="status" style={{ margin: 0 }}>{msg}</p> : null}
        </SideDrawer>
      ) : null}
    </div>
  );
}
