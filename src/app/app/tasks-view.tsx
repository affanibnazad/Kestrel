"use client";

import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Tip } from "@/components/ui";
import { BizAvatar, siteOfEmail } from "./biz";

// Mail → Tasks (database 038): the manual steps of your sequences (LinkedIn messages, calls, other tasks), like lemlist and
// Instantly. Kestrel never does them for you: open the lead's LinkedIn or call them, then click Done (or Skip).
type Acct = { team_id: string; role: string } | null;
type Task = { id: string; campaign_id: string | null; lead_id: string | null; step: number; kind: "linkedin" | "call" | "task"; instruction: string; to_email: string | null;
  lead_name: string | null; due_at: string; state: "open" | "done" | "skipped" | "cancelled"; done_at: string | null };
type LeadBits = { id: string; phone: string | null; website: string | null; linkedin?: string | null };
type Show = "open" | "done" | "all";
const KIND: Record<Task["kind"], [string, string]> = { linkedin: ["LinkedIn", "maybe"], call: ["Call", "good"], task: ["Task", "dnc"] };
const STATE: Record<Task["state"], string> = { open: "To do", done: "Done", skipped: "Skipped", cancelled: "Stopped (lead replied or left)" };
const HELP = "Manual steps from your sequences: LinkedIn messages, calls and other tasks. On the step's day the task appears here; the sequence then goes on to its next email by itself. Open the lead's LinkedIn or call them, then click Done (or Skip). When a lead replies or unsubscribes, their open tasks stop. Kestrel never logs in to LinkedIn for you: that breaks LinkedIn's rules and gets accounts banned.";
// Lead data comes from scraped websites: only a real https LinkedIn address is ever used as a link.
const safeLinkedIn = (u?: string | null) => {
  try { const x = new URL(String(u ?? "")); const h = x.hostname.toLowerCase().replace(/\.$/, ""); return x.protocol === "https:" && (h === "linkedin.com" || h.endsWith(".linkedin.com")) ? x.href : null; }
  catch { return null; }
};
const ago = (iso: string) => new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const T0 = new Date(Date.now() - 3600000).toISOString();
const DEMO: Task[] = [
  { id: "t1", campaign_id: "c", lead_id: "l1", step: 1, kind: "linkedin", instruction: "Visit Sam's LinkedIn, follow the company and send a connection request with a short, personal note.", to_email: "sam@harbour-example.test", lead_name: "Harbour Social (example)", due_at: T0, state: "open", done_at: null },
  { id: "t2", campaign_id: "c", lead_id: "l2", step: 2, kind: "call", instruction: "Call Ana. Mention the email you sent and ask your question.", to_email: "ana@fieldhouse-example.test", lead_name: "Fieldhouse Media (example)", due_at: T0, state: "open", done_at: null },
  { id: "t3", campaign_id: "c", lead_id: "l3", step: 1, kind: "linkedin", instruction: "Send a connection request.", to_email: "jo@oakline-example.test", lead_name: "Oakline Events (example)", due_at: T0, state: "done", done_at: T0 },
];
const DEMO_LEADS: Record<string, LeadBits> = { l1: { id: "l1", phone: null, website: "https://harbour-example.test", linkedin: "https://www.linkedin.com/company/example" }, l2: { id: "l2", phone: "+44 20 7946 0000", website: null } };

export default function TasksView({ account, demo, toast, go }: { account: Acct; demo: boolean; toast: (t: string) => void; go: (v: string) => void }) {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [leads, setLeads] = useState<Record<string, LeadBits>>({});
  const [camps, setCamps] = useState<Record<string, string>>({});
  const [show, setShow] = useState<Show>("open");
  const [missing, setMissing] = useState(false);
  const edit = demo || Boolean(account && account.role !== "viewer");

  const load = useCallback(async () => {
    if (demo) { setTasks(DEMO); setLeads(DEMO_LEADS); setCamps({ c: "Video agencies, London (example)" }); return; }
    if (!account) return;   // signed in, account still loading: never show example data
    const sb = supabaseBrowser();
    const { data, error } = await sb.from("campaign_tasks").select("id,campaign_id,lead_id,step,kind,instruction,to_email,lead_name,due_at,state,done_at")
      .eq("team_id", account.team_id).order("due_at", { ascending: false }).limit(500);
    if (error) { setMissing(true); setTasks([]); return; }
    const list = (data as Task[] | null) ?? [];
    setTasks(list);
    const ids = [...new Set(list.map((t) => t.lead_id).filter(Boolean))] as string[];
    const cids = [...new Set(list.map((t) => t.campaign_id).filter(Boolean))] as string[];
    const [l, c] = await Promise.all([
      ids.length ? sb.from("leads").select("id,phone,website,linkedin:data->socials->>linkedin").in("id", ids.slice(0, 500)) : Promise.resolve({ data: [] }),
      cids.length ? sb.from("campaigns").select("id,name").in("id", cids) : Promise.resolve({ data: [] }),
    ]);
    setLeads(Object.fromEntries(((l.data as LeadBits[] | null) ?? []).map((x) => [x.id, x])));
    setCamps(Object.fromEntries(((c.data as { id: string; name: string }[] | null) ?? []).map((x) => [x.id, x.name])));
  }, [account, demo]);
  useEffect(() => { Promise.resolve().then(load); }, [load]);

  async function mark(t: Task, outcome: "done" | "skipped" | "open") {
    if (demo) { setTasks((x) => (x ?? []).map((y) => (y.id === t.id ? { ...y, state: outcome, done_at: outcome === "open" ? null : new Date().toISOString() } : y))); return; }
    const { error } = await supabaseBrowser().rpc("complete_task", { task_id: t.id, outcome });
    if (error) { toast(error.message); return; }
    setTasks((x) => (x ?? []).map((y) => (y.id === t.id ? { ...y, state: outcome, done_at: outcome === "open" ? null : new Date().toISOString() } : y)));
  }

  const list = tasks ?? [];
  const open = list.filter((t) => t.state === "open");
  const shown = list.filter((t) => (show === "all" ? true : show === "open" ? t.state === "open" : t.state !== "open"));
  const linkedinSearch = (t: Task) => `https://www.linkedin.com/search/results/all/?keywords=${encodeURIComponent(String(t.lead_name ?? "").replace(/\s*\(example\)$/, ""))}`;

  return (
    <div className="app-page">
      <header className="head">
        <div><h1>Tasks <Tip text={HELP} /></h1><span className="sub">{open.length.toLocaleString()} to do</span></div>
        <div className="seg" role="group" aria-label="Show">
          {([["open", "To do"], ["done", "Finished"], ["all", "All"]] as [Show, string][]).map(([id, name]) => (
            <button key={id} type="button" className={show === id ? "on" : ""} aria-pressed={show === id} onClick={() => setShow(id)}>{name}</button>
          ))}
        </div>
      </header>
      {missing ? <p className="plan-msg">Tasks are coming soon to your workspace.</p> : null}

      <div className="table-card members acct-table">
        <table className="leads">
          <thead><tr><th>Lead</th><th>Task</th><th>Due</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{shown.map((t) => {
            const l = t.lead_id ? leads[t.lead_id] : undefined;
            return (
              <tr key={t.id}>
                <td><span className="biz"><BizAvatar name={t.lead_name || t.to_email || "Lead"} website={siteOfEmail(t.to_email)} /><span className="biz-txt"><b>{t.lead_name || t.to_email}</b>
                  <small>{t.campaign_id && camps[t.campaign_id] ? camps[t.campaign_id] : t.to_email}</small></span></span></td>
                <td className="tk-what"><em className={`pill ${KIND[t.kind][1]}`}>{KIND[t.kind][0]}</em> <span>{t.instruction}</span>
                  <span className="tk-links">
                    {t.kind === "linkedin" ? <a className="link-btn" href={safeLinkedIn(l?.linkedin) || linkedinSearch(t)} target="_blank" rel="noreferrer noopener">{safeLinkedIn(l?.linkedin) ? "Open LinkedIn" : "Find on LinkedIn"}</a> : null}
                    {t.kind === "call" && l?.phone ? <a className="link-btn" href={`tel:${l.phone.replace(/[^\d+]/g, "")}`}>Call {l.phone}</a> : null}
                    {t.to_email ? <a className="link-btn" href={`mailto:${t.to_email}`}>{t.to_email}</a> : null}
                  </span></td>
                <td>{ago(t.due_at)}</td>
                <td>{STATE[t.state]}{t.done_at && t.state !== "open" && t.state !== "cancelled" ? <small className="muted-line">{ago(t.done_at)}</small> : null}</td>
                <td className="pl-actions">{edit && t.state === "open" ? <>
                  <button type="button" className="btn go small" onClick={() => mark(t, "done")}>Done</button>
                  <button type="button" className="link-btn" onClick={() => mark(t, "skipped")}>Skip</button>
                </> : edit && (t.state === "done" || t.state === "skipped") ? <button type="button" className="link-btn" onClick={() => mark(t, "open")}>Undo</button> : null}</td>
              </tr>
            );
          })}</tbody>
        </table>
        {tasks && !shown.length ? (
          <div className="empty"><div><b>{show === "open" ? "Nothing to do" : "No tasks yet"}</b>
            <Tip text="Add a LinkedIn, call or other task step to a sequence (Mail → Sequences → a follow-up → Step type). On its day, it appears here." />
            <button type="button" className="link-btn" onClick={() => go("sequences")}>Open Sequences</button></div></div>
        ) : null}
      </div>
    </div>
  );
}
