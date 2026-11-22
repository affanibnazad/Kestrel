"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Tip } from "@/components/ui";

// Kestrel AI → Score and write → "Claude Code or Codex": the Kestrel AI Kit, step by step.
// 1. Download the kit (once; the other steps wait for it). 2. Connect the unzipped kit folder (Chrome, Edge, Brave:
// the browser's folder access; the choice is remembered in this browser). 3. Send a job: it is written straight into the
// kit's jobs/ folder. 4. Run /score-leads or /write-emails in Claude Code. 5. Kestrel looks in results/ every few seconds
// while this page is open and imports what it finds, then moves the file to results/imported/.
// Without folder access (Safari, Firefox): the job goes to Downloads (the kit's tools pick it up from there) and the
// result is uploaded by hand.

type Job = { name: string; data: unknown; count: number };
type Dir = FileSystemDirectoryHandle & {
  queryPermission?: (o: { mode: "readwrite" }) => Promise<PermissionState>;
  requestPermission?: (o: { mode: "readwrite" }) => Promise<PermissionState>;
  values?: () => AsyncIterable<FileSystemHandle>;
};
const KIT_FLAG = "kestrel-ai-kit-downloaded";
const RESULT = /^(fit|email)_result_[\w.-]+\.json$/;

// The folder handle is kept in this browser's IndexedDB (a handle cannot go in localStorage).
function idb<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest): Promise<T | undefined> {
  return new Promise((ok) => {
    try {
      const open = indexedDB.open("kestrel-ai-kit", 1);
      open.onupgradeneeded = () => open.result.createObjectStore("kit");
      open.onerror = () => ok(undefined);
      open.onsuccess = () => {
        const req = run(open.result.transaction("kit", mode).objectStore("kit"));
        req.onsuccess = () => ok(req.result as T); req.onerror = () => ok(undefined);
      };
    } catch { ok(undefined); }
  });
}
const saveHandle = (team: string, h: Dir | null) => idb("readwrite", (s) => (h ? s.put(h, team) : s.delete(team)));
const loadHandle = (team: string) => idb<Dir>("readonly", (s) => s.get(team));

export default function AiKit({ team, editable, demo, canScore, canWrite, scoreBlocked, writeBlocked, buildJob, download, importFile, toast }: {
  team: string; editable: boolean; demo: boolean; canScore: number; canWrite: number; scoreBlocked: string; writeBlocked: string;
  buildJob: (task: "score" | "emails") => Promise<Job>; download: (job: Job) => void; importFile: (f: File) => Promise<void>; toast: (t: string) => void;
}) {
  const supported = typeof window !== "undefined" && "showDirectoryPicker" in window;
  const [hasKit, setHasKit] = useState(false);
  const [dir, setDir] = useState<Dir | null>(null);
  const [granted, setGranted] = useState(false);
  const [busy, setBusy] = useState("");
  const [last, setLast] = useState("");
  const importing = useRef(false);

  useEffect(() => {
    try { if (localStorage.getItem(KIT_FLAG)) Promise.resolve().then(() => setHasKit(true)); } catch { /* private window */ }
    if (!supported || demo) return;
    loadHandle(team).then(async (h) => {
      if (!h) return;
      setDir(h); setHasKit(true);
      setGranted((await h.queryPermission?.({ mode: "readwrite" })) === "granted");
    });
  }, [team, supported, demo]);

  const allow = async (h: Dir) => {
    const p = (await h.queryPermission?.({ mode: "readwrite" })) === "granted" || (await h.requestPermission?.({ mode: "readwrite" })) === "granted";
    setGranted(p);
    return p;
  };
  async function connect() {
    try {
      const h = await (window as unknown as { showDirectoryPicker: (o: object) => Promise<Dir> }).showDirectoryPicker({ id: "kestrel-ai-kit", mode: "readwrite", startIn: "documents" });
      try { await h.getFileHandle(".kestrel-kit"); } catch { toast("That is not the Kestrel AI Kit folder. Choose the unzipped “Kestrel AI Kit” folder."); return; }
      if (!(await allow(h))) { toast("Kestrel needs permission to write into the kit folder."); return; }
      await saveHandle(team, h); setDir(h); setHasKit(true);
      try { localStorage.setItem(KIT_FLAG, "1"); } catch { /* fine */ }
      toast("Kit folder connected. Jobs go into it, and results are picked up from it by themselves.");
    } catch (e) { if ((e as Error).name !== "AbortError") toast("Could not open the folder. Try again."); }
  }
  async function disconnect() { await saveHandle(team, null); setDir(null); setGranted(false); }

  async function send(task: "score" | "emails") {
    setBusy(task);
    try {
      const job = await buildJob(task);
      if (dir && (await allow(dir))) {
        const jobs = await dir.getDirectoryHandle("jobs", { create: true });
        const w = await (await jobs.getFileHandle(job.name, { create: true })).createWritable();
        await w.write(JSON.stringify(job.data, null, 2)); await w.close();
        toast(`Sent ${job.count.toLocaleString()} leads to the kit (jobs/${job.name}). Now type ${task === "score" ? "/score-leads" : "/write-emails"} in Claude Code.`);
      } else {
        download(job);
        toast(`Saved a job with ${job.count.toLocaleString()} leads to Downloads. The kit picks it up from there.`);
      }
    } catch { toast("Could not make the job file. Try again."); }
    setBusy("");
  }

  // Look in results/ for new result files and import them (one at a time).
  const check = useCallback(async (manual = false) => {
    if (!dir || !granted || importing.current || !editable || demo) return;
    importing.current = true;
    let found = 0;
    try {
      const results = (await dir.getDirectoryHandle("results", { create: true })) as Dir;
      const files: FileSystemFileHandle[] = [];
      for await (const h of results.values?.() ?? []) if (h.kind === "file" && RESULT.test(h.name)) files.push(h as FileSystemFileHandle);
      for (const h of files) {
        const file = await h.getFile();
        await importFile(file);
        const done = await results.getDirectoryHandle("imported", { create: true });
        const w = await (await done.getFileHandle(h.name, { create: true })).createWritable();
        await w.write(await file.text()); await w.close();
        await results.removeEntry(h.name);
        found++; setLast(`${h.name} imported ${new Date().toLocaleTimeString()}`);
      }
      if (manual && !found) toast("No new results in the kit's results/ folder yet.");
    } catch { if (manual) toast("Could not read the kit folder. Click Reconnect."); setGranted(false); }
    importing.current = false;
  }, [dir, granted, editable, demo, importFile, toast]);

  useEffect(() => {
    if (!dir || !granted) return;
    const t = setInterval(() => { if (document.visibilityState === "visible") check(); }, 6000);
    return () => clearInterval(t);
  }, [dir, granted, check]);

  const ready = hasKit || Boolean(dir);
  return (
    <section className="join-card kit-card">
      <div><b>Claude Code or Codex (no key) <Tip text="Score leads and write emails with your own Claude Code or Codex plan: no API key and no cost per lead. The kit is a small folder with the guide, two commands and two helper scripts. Nothing in it sends emails." /></b>
        <p>Your own Claude Code or Codex plan does the AI work. Four steps; the first is needed once.</p></div>
      <ol className="kit-steps">
        <li className={hasKit ? "done" : ""}><b>Download the AI kit</b> and unzip it (e.g. into Documents).
          <a className="btn glass small" href="/app/download/kit" download onClick={() => { try { localStorage.setItem(KIT_FLAG, "1"); } catch { /* fine */ } setHasKit(true); }}>Download the AI kit</a>
          <Tip text="Open the unzipped “Kestrel AI Kit” folder in Claude Code (File → Open Folder, or in a terminal: cd into it and type claude). Its START HERE.md has the full guide." /></li>
        <li className={dir && granted ? "done" : ""}><b>Connect the kit folder</b> so jobs and results move by themselves.
          {!supported ? <span className="dr-muted"> Your browser cannot do this (use Chrome, Edge or Brave). Jobs go to Downloads instead.</span>
            : dir && granted ? <><span className="dr-muted"> Connected: {dir.name}</span> <button type="button" className="link-btn" onClick={disconnect}>Disconnect</button></>
            : dir ? <button type="button" className="btn glass small" onClick={() => allow(dir)}>Reconnect</button>
            : <button type="button" className="btn glass small" disabled={!ready} onClick={connect}>Connect folder</button>}</li>
        <li><b>Send a job</b>
          <span className="join-row">
            <button type="button" className="btn glass small" disabled={!ready || !editable || Boolean(busy) || Boolean(scoreBlocked) || !canScore} title={scoreBlocked}
              onClick={() => send("score")}>{busy === "score" ? "Sending…" : `Send fit job (${canScore.toLocaleString()})`}</button>
            <button type="button" className="btn glass small" disabled={!ready || !editable || Boolean(busy) || Boolean(writeBlocked) || !canWrite} title={writeBlocked}
              onClick={() => send("emails")}>{busy === "emails" ? "Sending…" : `Send email job (${canWrite.toLocaleString()})`}</button>
          </span></li>
        <li><b>In Claude Code type</b> <code>/score-leads</code> or <code>/write-emails</code> <span className="dr-muted">(Codex: “score the newest Kestrel job”)</span></li>
        <li><b>Results come back by themselves</b> {dir && granted ? <span className="dr-muted">(checked every few seconds while this page is open{last ? `; last: ${last}` : ""})</span> : null}
          <span className="join-row">
            {dir && granted ? <button type="button" className="btn go small" disabled={!editable} onClick={() => check(true)}>Check now</button> : null}
            <label className={`btn ${dir && granted ? "glass" : "go"} small${editable ? "" : " off"}`}><input type="file" accept=".json,application/json" hidden disabled={!editable}
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) importFile(f); }} />Upload results</label>
          </span></li>
      </ol>
      {!ready ? <p className="dr-muted">Download the kit first: the other steps open after that.</p> : null}
    </section>
  );
}
