"use client";

import { useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Tip } from "@/components/ui";
import { FIELDS, MAX_ROWS, csvLeads, guessMapping, parseCsv, type Field } from "@/lib/csv-import";
import { toRow } from "@/lib/leads";
import { dncBlocks, dncIndex, type DncRow } from "@/lib/dnc";

// Import and examples → Import a CSV file: leads from Apollo, Google Sheets, Excel or another tool. Kestrel matches the
// columns by their names; you can change any match before importing. Duplicates are merged; Do-not-contact rows are skipped.
type Acct = { team_id: string; role: string } | null;

export default function CsvImport({ account, dnc, demo, onDone }: { account: Acct; dnc: DncRow[]; demo: boolean; onDone: () => void }) {
  const [file, setFile] = useState<{ name: string; rows: string[][] } | null>(null);
  const [map, setMap] = useState<Record<Field, number> | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const canEdit = Boolean(account && account.role !== "viewer") || demo;

  async function choose(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; e.target.value = "";
    if (!f) return;
    if (f.size > 25 * 1024 * 1024) { setMsg("That file is over 25 MB. Split it into smaller files."); return; }
    const rows = parseCsv(await f.text());
    if (rows.length < 2) { setMsg("That file has no rows under the header."); return; }
    setFile({ name: f.name, rows }); setMap(guessMapping(rows[0])); setMsg("");
  }

  const header = file?.rows[0] ?? [];
  const body = useMemo(() => file?.rows.slice(1) ?? [], [file]);
  const result = useMemo(() => (map ? csvLeads(body, map) : null), [body, map]);
  const blocked = useMemo(() => {
    if (!result) return new Set<number>();
    const idx = dncIndex(dnc);
    return new Set(result.leads.map((l, i) => (dncBlocks(l as { email?: string; website?: string }, idx) ? i : -1)).filter((i) => i >= 0));
  }, [result, dnc]);
  const ready = result ? result.leads.length - blocked.size : 0;

  async function run() {
    if (!result || !account) { if (demo) setMsg("Importing needs a signed-in team."); return; }
    setBusy(true); setMsg("Importing…");
    try {
      const rows = result.leads.filter((_, i) => !blocked.has(i)).map((l) => toRow(l, account.team_id));
      const unique = [...new Map(rows.map((r) => [r.dedupe_key, r])).values()];
      const sb = supabaseBrowser();
      // New businesses only: a business already in Kestrel keeps its written emails, AI fit and contacts untouched.
      let added = 0;
      for (let i = 0; i < unique.length; i += 500) {
        const { data, error } = await sb.from("leads").upsert(unique.slice(i, i + 500), { onConflict: "team_id,dedupe_key", ignoreDuplicates: true }).select("id");
        if (error) throw error;
        added += data?.length ?? 0;
        setMsg(`Importing… ${Math.min(i + 500, unique.length).toLocaleString()} of ${unique.length.toLocaleString()}`);
      }
      const notes = [result.skipped ? `${result.skipped.toLocaleString()} rows had no email, website or phone` : "", blocked.size ? `${blocked.size.toLocaleString()} are on Do-not-contact` : "",
        rows.length - unique.length ? `${(rows.length - unique.length).toLocaleString()} were the same business twice` : ""].filter(Boolean);
      const kept = unique.length - added;
      setMsg(`Imported ${added.toLocaleString()} new leads.${kept ? ` ${kept.toLocaleString()} were already in Kestrel and were left as they are.` : ""}${notes.length ? ` Skipped: ${notes.join("; ")}.` : ""}`);
      setFile(null); setMap(null); onDone();
    } catch (err) { setMsg(`Import stopped: ${(err as Error).message}`); } finally { setBusy(false); }
  }

  return (
    <section className="join-card csv-card">
      <div><b>Import a CSV file <Tip text={`From Apollo, Google Sheets, Excel, Hunter or any tool: export your list as CSV and choose it here. Kestrel matches the columns by their names; check the matches, then import. Up to ${MAX_ROWS.toLocaleString()} rows. A row needs a business or person name and an email, website or phone. Duplicates are merged and Do-not-contact rows are skipped.`} /></b>
        <p>Leads from Apollo, Sheets, Excel or any other tool.</p></div>
      {!file ? (
        <label className={`btn go${!canEdit || busy ? " off" : ""}`}><input type="file" accept=".csv,text/csv,.tsv,text/tab-separated-values,.txt" hidden disabled={!canEdit || busy} onChange={choose} />Choose CSV file</label>
      ) : (
        <>
          <p className="csv-file"><b>{file.name}</b> · {body.length.toLocaleString()} rows{body.length > MAX_ROWS ? ` (only the first ${MAX_ROWS.toLocaleString()} are used)` : ""}</p>
          <div className="csv-map">
            {FIELDS.map((f) => (
              <label key={f.id} className="in"><span>{f.label}</span>
                <select value={map?.[f.id] ?? -1} onChange={(e) => setMap((m) => (m ? { ...m, [f.id]: Number(e.target.value) } : m))}>
                  <option value={-1}>Not in the file</option>
                  {header.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}{body[0]?.[i] ? ` · e.g. ${body[0][i].slice(0, 30)}` : ""}</option>)}
                </select>
              </label>
            ))}
          </div>
          {result?.leads.length ? (
            <div className="table-card members acct-table csv-preview"><table className="leads">
              <thead><tr><th>Business</th><th>Contact</th><th>Email</th><th>Website</th><th>Location</th></tr></thead>
              <tbody>{result.leads.slice(0, 3).map((l, i) => {
                const c = (l.contacts as { name?: string; position?: string }[] | undefined)?.[0];
                return <tr key={i}><td><b>{String(l.name ?? "")}</b></td><td>{c?.name ?? "—"}{c?.position ? <small className="muted-line">{c.position}</small> : null}</td><td>{String(l.email ?? "—")}</td><td>{String(l.website ?? "—").replace(/^https:\/\//, "")}</td><td>{String(l.location ?? "—")}</td></tr>;
              })}</tbody>
            </table></div>
          ) : null}
          <p className="dr-muted">{ready.toLocaleString()} leads ready{result?.skipped ? ` · ${result.skipped.toLocaleString()} rows with nothing to contact` : ""}{blocked.size ? ` · ${blocked.size.toLocaleString()} on Do-not-contact` : ""}{result?.badEmail ? ` · ${result.badEmail.toLocaleString()} emails were not valid and were left out` : ""}</p>
          <div className="join-row">
            <button className="btn go" type="button" disabled={!canEdit || busy || !ready} onClick={run}>{busy ? "Importing…" : `Import ${ready.toLocaleString()} leads`}</button>
            <button className="btn glass" type="button" disabled={busy} onClick={() => { setFile(null); setMap(null); setMsg(""); }}>Cancel</button>
          </div>
        </>
      )}
      {msg ? <p className="plan-msg" role="status" style={{ margin: 0 }}>{msg}</p> : null}
    </section>
  );
}
