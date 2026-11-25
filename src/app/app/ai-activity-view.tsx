"use client";

// Kestrel AI → Activity (Phase 3E, database 061): every change the AI made after someone clicked Confirm, and every
// Score and write run. Newest first; nobody can edit or delete a row.
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { PersonAvatar } from "./biz";
import { ACTION_LABELS, type ActionKind } from "@/lib/assistant";

type Row = { id: number; user_id: string | null; kind: string; summary: string; ok: boolean; detail: string | null; ai: string | null; created_at: string };
type Person = { id: string; name: string | null; email: string; avatar: string | null };
const ago = (iso: string) => new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const DEMO: Row[] = [
  { id: 3, user_id: "me", kind: "set_lead_fit", summary: "Mark 3 leads as Good: “Northlight Studio (example)”, “Harbour Social (example)” and 1 more", ok: true, detail: null, ai: "Kestrel Pro", created_at: new Date(Date.UTC(2026, 10, 18, 15, 2)).toISOString() },
  { id: 2, user_id: "me", kind: "write_emails", summary: "Score and write: wrote emails for 12 leads (offer “Short clips for agencies”)", ok: true, detail: "2 skipped", ai: null, created_at: new Date(Date.UTC(2026, 10, 18, 11, 40)).toISOString() },
  { id: 1, user_id: "me", kind: "add_to_campaign", summary: "Add 5 leads to the running campaign “Video agencies, London (example)”", ok: false, detail: "This campaign has no email account whose sending and reading tests both passed", ai: "Kestrel AI", created_at: new Date(Date.UTC(2026, 10, 17, 9, 15)).toISOString() },
];

export default function AiActivityView({ account, demo }: { account: { team_id: string } | null; demo: boolean }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [onlyFailed, setOnlyFailed] = useState(false);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (demo || !account) { Promise.resolve().then(() => { setRows(DEMO); setMe("me"); }); return; }
    const sb = supabaseBrowser();
    Promise.all([sb.from("ai_activity").select("id,user_id,kind,summary,ok,detail,ai,created_at").eq("team_id", account.team_id).order("created_at", { ascending: false }).limit(300),
      sb.rpc("team_people"), sb.auth.getUser()]).then(([a, p, u]) => {
      if (a.error) setMissing(true);
      setRows((a.data ?? []) as Row[]); setPeople((p.data ?? []) as Person[]); setMe(u.data.user?.id ?? null);
    });
  }, [account, demo]);

  if (missing) return <p className="plan-msg">The activity log needs database update 061.</p>;
  if (!rows) return <p className="plan-msg">Loading…</p>;
  const shown = onlyFailed ? rows.filter((r) => !r.ok) : rows;
  const who = (id: string | null) => id === me ? { name: "You", avatar: people.find((x) => x.id === id)?.avatar ?? null } : (() => { const p = people.find((x) => x.id === id); return { name: p?.name || p?.email || "A teammate", avatar: p?.avatar ?? null }; })();
  return (
    <div className="aa">
      <div className="aa-bar">
        <span className="sub">{rows.length ? `${rows.length.toLocaleString()} recorded · newest first · cannot be changed` : "Nothing yet"}</span>
        <label className="agree"><input type="checkbox" checked={onlyFailed} onChange={(e) => setOnlyFailed(e.target.checked)} /> <span>Only what didn&apos;t work</span></label>
      </div>
      {shown.length ? (
        <ol className="aa-list">
          {shown.map((r) => { const w = who(r.user_id); return (
            <li key={r.id} className={r.ok ? "" : "fail"}>
              <PersonAvatar name={w.name} photo={w.avatar} size={30} />
              <div className="aa-main">
                <p><b>{w.name}</b> · {ACTION_LABELS[r.kind as ActionKind] ?? r.kind.replace(/_/g, " ")}{r.ai ? <> · <span className="aa-ai">{r.ai}</span></> : null}</p>
                <p className="aa-sum">{r.summary}</p>
                {r.detail ? <p className="aa-detail">{r.detail}</p> : null}
              </div>
              <div className="aa-side"><em className={`kpill ${r.ok ? "good" : "no"}`}>{r.ok ? "Done" : "Not done"}</em><small>{ago(r.created_at)}</small></div>
            </li>
          ); })}
        </ol>
      ) : <p className="plan-msg">{onlyFailed ? "Everything worked." : "When Kestrel AI changes something after you click Confirm, or you run Score and write, it shows here."}</p>}
    </div>
  );
}
