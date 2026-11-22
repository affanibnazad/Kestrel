"use client";

import { useEffect, useRef, useState } from "react";

// In-app replacements for the browser's confirm() and prompt() (UX audit rows 35, 48): a real dialog in Kestrel's design
// that says exactly what will happen. Usage: `if (!(await askConfirm("Delete …?", { ok: "Delete", danger: true }))) return;`
// and `const name = await askText("Name the new list")` (null when cancelled). <DialogHost /> is mounted once in the App.
type Req = { kind: "confirm" | "text"; text: string; ok?: string; danger?: boolean; value?: string; placeholder?: string; done: (v: string | null) => void };
let open: ((r: Req) => void) | null = null;

export function askConfirm(text: string, o: { ok?: string; danger?: boolean } = {}): Promise<boolean> {
  if (!open) return Promise.resolve(typeof window !== "undefined" && window.confirm(text));
  return new Promise((done) => open!({ kind: "confirm", text, ...o, done: (v) => done(v !== null) }));
}
export function askText(text: string, value = "", o: { ok?: string; placeholder?: string } = {}): Promise<string | null> {
  if (!open) return Promise.resolve(typeof window !== "undefined" ? window.prompt(text, value) : null);
  return new Promise((done) => open!({ kind: "text", text, value, ...o, done }));
}

export function DialogHost() {
  const [req, setReq] = useState<Req | null>(null);
  const [val, setVal] = useState("");
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    open = (r) => { setReq((old) => { old?.done(null); return r; }); setVal(r.value ?? ""); };
    return () => { open = null; };
  }, []);
  useEffect(() => { const d = ref.current; if (req && d && !d.open) d.showModal(); }, [req]);
  const finish = (v: string | null) => { req?.done(v); setReq(null); ref.current?.close(); };
  const lines = (req?.text ?? "").split("\n");
  return (
    <dialog ref={ref} className="k-dialog" aria-labelledby="k-dialog-text" onCancel={(e) => { e.preventDefault(); finish(null); }}>
      {req ? (
        <form method="dialog" onSubmit={(e) => { e.preventDefault(); finish(req.kind === "text" ? val.trim() || null : "ok"); }}>
          <div id="k-dialog-text" className="k-dialog-text">{lines.map((l, i) => (l ? <p key={i} className={i === 0 ? "k-dialog-q" : ""}>{l}</p> : null))}</div>
          {req.kind === "text" ? <input autoFocus value={val} placeholder={req.placeholder} maxLength={80} aria-label={lines[0]} onChange={(e) => setVal(e.target.value)} /> : null}
          <div className="k-dialog-btns">
            <button type="button" className="btn glass small" onClick={() => finish(null)}>Cancel</button>
            <button type="submit" autoFocus={req.kind === "confirm"} className={`btn small ${req.danger ? "danger-go go" : "go"}`} disabled={req.kind === "text" && !val.trim()}>{req.ok ?? (req.kind === "text" ? "Save" : "OK")}</button>
          </div>
        </form>
      ) : null}
    </dialog>
  );
}
