"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Line } from "@/components/ui";
import { askText } from "@/components/dialog";
import { ATTACH_MAX_FILES, attachmentProblem, parseEmails, replyBodyHtml, type ReplyAlign, type ReplySize } from "@/lib/reply-format";
import { editorToMarks } from "./reply-editor";
import { BizAvatar, siteOfEmail } from "./biz";

// Replies → Modern 2-card inbox composer card matching reference UI:
// Recipient chip with avatar, Subject line, live contentEditable editor,
// toolbar with formatting, attachments, AI replies, and a coral pill [ Send Message | 🕒 ] button.
type File64 = { name: string; type: string; size: number; data: string };
type Idea = { title: string; text: string };
const EMOJI = ["🙂", "😊", "👍", "🙏", "🎉", "👋", "✅", "📅", "🎬", "💡", "🚀", "🤝"];
const DEMO_IDEAS: Idea[] = [
  { title: "Share examples", text: "Hi, thanks for coming back to me!\n\nHere are two short reels we cut for similar brands:\n- Launch teaser (30 s)\n- Product walkthrough (60 s)\n\nWould a 15-minute call this week help? Pick a time here: https://cal.com/example/15min" },
  { title: "Book a call", text: "Hi, great to hear from you.\n\nHappy to show you a few examples live and hear what you have coming up. Does Thursday or Friday afternoon suit you for 15 minutes? https://cal.com/example/15min" },
  { title: "Ask a question", text: "Hi, thanks for the reply!\n\nBefore I send examples: which launches are you planning next, and roughly how many videos do you usually need for each one?" },
];

const DEMO_REPLY = "Hello Guys 😊\n\nThank you for reaching out and sharing this exciting opportunity! I've reviewed the attached document, and the project scope aligns well with our current objectives. I'd love to discuss this further and explore how we can collaborate effectively. Let me know your availability this week for a call or meeting.";

function Svg({ d }: { d: string }) {
  return <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
}
const ALIGN_ICON: Record<ReplyAlign, string> = {
  left: "M3 5h14M3 9h9M3 13h14M3 17h9", center: "M3 5h14M5.5 9h9M3 13h14M5.5 17h9",
  right: "M3 5h14M8 9h9M3 13h14M8 17h9", justify: "M3 5h14M3 9h14M3 13h14M3 17h14",
};

function Tool({ label, on = false, disabled, onClick, children }: { label: string; on?: boolean; disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" className={`kc-tool${on ? " on" : ""}`} aria-label={label} title={label} aria-pressed={on || undefined} disabled={disabled}
    onMouseDown={(e) => e.preventDefault()} onClick={onClick}>{children}</button>;
}

export default function ReplyBox({ replyId, name, email = "", subject = "", demo, editable, manage, booking, waiting, boxRef, toast, onSent, onDone }: {
  replyId: string; name: string; email?: string; subject?: string; demo: boolean; editable: boolean; manage: boolean; booking: string; waiting: boolean;
  boxRef: RefObject<HTMLDivElement | null>; toast: (t: string) => void; onSent: (snoozeDays: number) => void; onDone: () => void;
}) {
  const [text, setText] = useState(demo ? DEMO_REPLY : "");
  const [recipient, setRecipient] = useState(email || name);
  const [isEditingTo, setIsEditingTo] = useState(false);
  const [currSubject, setCurrSubject] = useState(subject ? (subject.startsWith("Re:") ? subject : `Re: ${subject}`) : "Re: Follow up");
  const [cc, setCc] = useState<string | null>(null);
  const [bcc, setBcc] = useState<string | null>(null);
  const [size, setSize] = useState<ReplySize>("normal");
  const [align, setAlign] = useState<ReplyAlign>("left");
  const [files, setFiles] = useState<File64[]>([]);
  const [busy, setBusy] = useState(false);
  const [ideas, setIdeas] = useState<Idea[] | null>(null);
  const [thinking, setThinking] = useState(false);
  
  type Planned = { id: string; send_at: string; status: string; error: string | null; preview: string };
  const [planned, setPlanned] = useState<Planned[]>([]);
  const [pickAt, setPickAt] = useState("");
  const loadPlanned = useCallback(async () => {
    if (demo) return;
    const { data, error } = await supabaseBrowser().from("scheduled_answers").select("id,send_at,status,error,preview").eq("reply_id", replyId)
      .in("status", ["waiting", "sending", "failed"]).order("send_at", { ascending: false }).limit(3);
    if (!error) setPlanned((data ?? []) as Planned[]);
  }, [demo, replyId]);
  useEffect(() => { Promise.resolve().then(loadPlanned); }, [loadPlanned]);
  useEffect(() => {
    if (demo && boxRef.current && !boxRef.current.innerHTML) {
      boxRef.current.innerHTML = replyBodyHtml(DEMO_REPLY);
    }
  }, [demo, boxRef]);
  const fileIn = useRef<HTMLInputElement>(null);
  const imageIn = useRef<HTMLInputElement>(null);
  const can = editable && manage;

  const saved = useRef<Range | null>(null);
  const sync = () => { const el = boxRef.current; if (el) setText(editorToMarks(el)); };
  const remember = () => { const s = window.getSelection(); const el = boxRef.current; if (s && s.rangeCount && el && el.contains(s.anchorNode)) saved.current = s.getRangeAt(0).cloneRange(); };
  const restore = () => {
    const el = boxRef.current; if (!el) return;
    if (document.activeElement === el) return;
    el.focus();
    const s = window.getSelection();
    if (s && saved.current && el.contains(saved.current.startContainer)) { s.removeAllRanges(); s.addRange(saved.current); }
  };
  const cmd = (name: string, value?: string) => { restore(); document.execCommand(name, false, value); remember(); sync(); };
  const setEditor = useCallback((t: string) => {
    const el = boxRef.current;
    if (el) el.innerHTML = t ? replyBodyHtml(t) : "";
    setText(t); saved.current = null;
  }, [boxRef]);
  const insert = (s: string) => cmd("insertText", s);
  const list = (kind: "ul" | "ol") => cmd(kind === "ul" ? "insertUnorderedList" : "insertOrderedList");
  async function link() {
    remember();
    const sel = saved.current && !saved.current.collapsed ? saved.current.toString() : "";
    const url = await askText("Link address", "https://", { ok: "Add link", placeholder: "https://…" });
    if (!url) return;
    if (!/^https?:\/\/\S+$/.test(url.trim())) { toast("Type a full link that starts with https://"); return; }
    if (sel) cmd("createLink", url.trim()); else insert(url.trim());
  }
  async function addFiles(list: FileList | null) {
    if (!list?.length) return;
    const picked = [...files, ...[...list].map((f) => ({ name: f.name, type: f.type, size: f.size, data: "" }))];
    const problem = attachmentProblem(picked);
    if (problem) { toast(problem); return; }
    const read = await Promise.all([...list].map((f) => new Promise<File64>((ok) => {
      const r = new FileReader(); r.onload = () => ok({ name: f.name, type: f.type || "application/octet-stream", size: f.size, data: String(r.result).split(",")[1] ?? "" }); r.readAsDataURL(f);
    })));
    setFiles((fs) => [...fs, ...read].slice(0, ATTACH_MAX_FILES));
  }
  async function suggest() {
    setThinking(true);
    if (demo) { await new Promise((r) => setTimeout(r, 400)); setIdeas(DEMO_IDEAS); setThinking(false); return; }
    const r = await fetch("/api/mail/suggest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reply: replyId }) })
      .then((x) => x.json()).catch(() => ({ error: "No connection." })) as { options?: Idea[]; error?: string };
    setThinking(false);
    if (r.error || !r.options) { toast(r.error || "No suggestions this time."); return; }
    setIdeas(r.options);
  }
  async function send(snoozeDays = 0) {
    const ccL = parseEmails(cc ?? ""), bccL = parseEmails(bcc ?? "");
    if (ccL.bad.length || bccL.bad.length) { toast(`Check these addresses: ${[...ccL.bad, ...bccL.bad].slice(0, 3).join(", ")}`); return; }
    if (demo) {
      toast(recipient ? `Sent to ${recipient} (demo).` : "Sent message.");
      setEditor(""); setFiles([]); setIdeas(null);
      onSent(snoozeDays);
      return;
    }
    setBusy(true);
    const r = await fetch("/api/mail/reply", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ reply: replyId, text, subject: currSubject, to_email: recipient, cc: cc ?? "", bcc: bcc ?? "", size, align, files: files.map(({ name, type, data }) => ({ name, type, data })) }) })
      .then((x) => x.json()).catch(() => ({ error: "No connection." })) as { sent?: boolean; to?: string; error?: string };
    setBusy(false);
    if (r.error) { toast(r.error); return; }
    toast(`Sent to ${r.to || recipient}, in the same email thread.`);
    setEditor(""); setFiles([]); setIdeas(null);
    onSent(snoozeDays);
  }

  const sendLater = useCallback(async (at: Date) => {
    const ccL = parseEmails(cc ?? ""), bccL = parseEmails(bcc ?? "");
    if (ccL.bad.length || bccL.bad.length) { toast(`Check these addresses: ${[...ccL.bad, ...bccL.bad].slice(0, 3).join(", ")}`); return; }
    if (at.getTime() < Date.now() + 60_000) { toast("Pick a time at least a minute from now."); return; }
    const when = at.toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    if (demo) { setPlanned([{ id: "demo", send_at: at.toISOString(), status: "waiting", error: null, preview: text.slice(0, 140) }]); setEditor(""); toast(`Scheduled for ${when} (example).`); return; }
    setBusy(true);
    const r = await fetch("/api/mail/schedule", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ reply: replyId, sendAt: at.toISOString(), text, subject: currSubject, to_email: recipient, cc: cc ?? "", bcc: bcc ?? "", size, align, files: files.map(({ name, type, data }) => ({ name, type, data })) }) })
      .then((x) => x.json()).catch(() => ({ error: "No connection." })) as { scheduled?: string; error?: string };
    setBusy(false);
    if (r.error) { toast(r.error); return; }
    toast(`Scheduled for ${when}. Kestrel sends it then, in the same email thread.`);
    setEditor(""); setFiles([]); setIdeas(null); setPickAt("");
    loadPlanned();
  }, [cc, bcc, demo, text, replyId, currSubject, recipient, size, align, files, toast, loadPlanned, setEditor]);
  async function cancelPlanned(id: string) {
    if (demo) { setPlanned([]); return; }
    const r = await fetch("/api/mail/schedule", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cancel: id }) })
      .then((x) => x.json()).catch(() => ({ error: "No connection." })) as { error?: string };
    toast(r.error ?? "Scheduled answer cancelled.");
    loadPlanned();
  }
  const at9 = (days: number, weekday?: number) => { const d = new Date(); d.setHours(9, 0, 0, 0);
    if (weekday !== undefined) { d.setDate(d.getDate() + (((weekday - d.getDay() + 7) % 7) || 7)); } else d.setDate(d.getDate() + days); return d; };

  return (
    <div className="kcomp kc-modern-card">
      {planned.map((p) => (
        <div key={p.id} className={`kc-planned${p.status === "failed" ? " bad" : ""}`} role="status">
          <Line name="clock" />
          <span>{p.status === "failed" ? <>Not sent: {p.error || "it could not be sent"}</> : <>Scheduled for <b>{new Date(p.send_at).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</b>{p.preview ? <small>“{p.preview}”</small> : null}</>}</span>
          {p.status === "waiting" && can ? <button type="button" className="kc-link" onClick={() => cancelPlanned(p.id)}>Cancel</button> : null}
        </div>
      ))}

      {/* Recipient line with chip or editable input */}
      <div className="kc-to-row">
        <div className="kc-to-left">
          <span className="kc-label">To:</span>
          {isEditingTo ? (
            <input
              type="email"
              className="kc-editable-input"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="recipient@example.com"
              aria-label="Recipient email"
              autoFocus
            />
          ) : (
            <div className="kc-chip">
              <BizAvatar name={recipient} website={siteOfEmail(recipient || "")} size={22} />
              <span className="kc-chip-name">{recipient}</span>
              <button
                type="button"
                className="kc-chip-x"
                title="Remove recipient email"
                aria-label="Remove recipient email"
                onClick={() => {
                  setRecipient("");
                  setIsEditingTo(true);
                }}
              >
                ×
              </button>
            </div>
          )}
        </div>
        <div className="kc-to-right">
          <button type="button" className={`kc-cc-btn${cc !== null ? " on" : ""}`} onClick={() => setCc(cc === null ? "" : null)} disabled={!can}>Cc</button>
          <button type="button" className={`kc-cc-btn${bcc !== null ? " on" : ""}`} onClick={() => setBcc(bcc === null ? "" : null)} disabled={!can}>Bcc</button>
        </div>
      </div>

      {cc !== null ? <label className="kcomp-line"><span className="kcomp-k">Cc:</span><input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="name@company.com, …" aria-label="Cc" /></label> : null}
      {bcc !== null ? <label className="kcomp-line"><span className="kcomp-k">Bcc:</span><input value={bcc} onChange={(e) => setBcc(e.target.value)} placeholder="name@company.com, …" aria-label="Bcc" /></label> : null}

      {/* Subject line - fully editable */}
      <div className="kc-subj-row">
        <span className="kc-label">Subject:</span>
        <input
          type="text"
          className="kc-editable-input"
          value={currSubject}
          onChange={(e) => setCurrSubject(e.target.value)}
          placeholder="Subject..."
          aria-label="Subject"
        />
      </div>

      {/* Formatting Tool bar */}
      <div className="kcomp-tools" role="toolbar" aria-label="Formatting">
        <label className="kc-size" title="Text size"><span aria-hidden="true">A</span>
          <select value={size} onChange={(e) => setSize(e.target.value as ReplySize)} aria-label="Text size" disabled={!can}><option value="small">Small</option><option value="normal">Normal</option><option value="large">Large</option></select></label>
        <i className="kc-sep" />
        <Tool label="Bold" disabled={!can} onClick={() => cmd("bold")}><b>B</b></Tool>
        <Tool label="Italic" disabled={!can} onClick={() => cmd("italic")}><em>I</em></Tool>
        <Tool label="Underline" disabled={!can} onClick={() => cmd("underline")}><u>U</u></Tool>
        <i className="kc-sep" />
        <Tool label="Link" disabled={!can} onClick={link}><Line name="link" /></Tool>
        <details className="kdrop kc-emoji">
          <summary className="kc-tool" aria-label="Emoji" title="Emoji"><Svg d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM7 12.5s1 1.5 3 1.5 3-1.5 3-1.5M7.5 8h.01M12.5 8h.01" /></summary>
          <div className="kmenu kc-emoji-grid">{EMOJI.map((e) => <button key={e} type="button" onClick={(ev) => { insert(e); (ev.currentTarget.closest("details") as HTMLDetailsElement).open = false; }}>{e}</button>)}</div>
        </details>
        <Tool label="Attach an image" disabled={!can} onClick={() => imageIn.current?.click()}><Svg d="M3 4h14v12H3zM3 13l4-4 3 3 2-2 5 5M13 7.5h.01" /></Tool>
        <i className="kc-sep" />
        <Tool label="Bulleted list" disabled={!can} onClick={() => list("ul")}><Svg d="M7 5h10M7 10h10M7 15h10M3.5 5h.01M3.5 10h.01M3.5 15h.01" /></Tool>
        <Tool label="Numbered list" disabled={!can} onClick={() => list("ol")}><Svg d="M8 5h9M8 10h9M8 15h9M3 4l1-.5V7M3 9.5c.5-.7 2-.7 2 .3 0 .8-2 1.7-2 2.7h2M3 14h2l-1 1.2c.8 0 1.2.4 1.2 1s-.6 1.1-1.2 1.1c-.5 0-.9-.2-1.1-.5" /></Tool>
        <i className="kc-sep" />
        {(["left", "center", "right", "justify"] as ReplyAlign[]).map((a) => <Tool key={a} label={`Align ${a}`} on={align === a} disabled={!can} onClick={() => setAlign(a)}><Svg d={ALIGN_ICON[a]} /></Tool>)}
        <span className="kcomp-grow" />
        <button type="button" className="kc-ai" disabled={!can || thinking} onClick={suggest}><Line name="sparkle" /> {thinking ? "Writing…" : "AI replies"}</button>
      </div>

      {ideas ? (
        <div className="kc-ideas" aria-label="AI reply options">
          {ideas.map((o, i) => (
            <button key={i} type="button" className="kc-idea" onClick={() => { setEditor(o.text); setIdeas(null); requestAnimationFrame(() => boxRef.current?.focus()); }}>
              <b>{o.title || `Option ${i + 1}`}</b><span>{o.text}</span><em>Use this</em></button>
          ))}
          <button type="button" className="link-btn kc-ideas-x" onClick={() => setIdeas(null)}>Close</button>
        </div>
      ) : null}

      <div ref={boxRef} className="kc-editor" contentEditable={can} suppressContentEditableWarning role="textbox" aria-multiline="true" aria-label="Your answer"
        aria-disabled={!can || undefined} data-placeholder="Type something..." data-empty={text.trim() ? undefined : "true"}
        onInput={sync} onKeyUp={remember} onMouseUp={remember} onBlur={remember}
        onPaste={(e) => { e.preventDefault(); document.execCommand("insertText", false, e.clipboardData.getData("text/plain")); sync(); }}
        onDrop={(e) => e.preventDefault()}
        style={{ textAlign: align, fontSize: size === "small" ? 13 : size === "large" ? 18 : 15 }} />

      {files.length ? <ul className="kc-files">{files.map((f, i) => (
        <li key={i}><span className="kc-file-ic"><Line name="doc" /></span><span><b>{f.name}</b><small>{f.size < 1048576 ? `${Math.max(1, Math.round(f.size / 1024))} KB` : `${(f.size / 1048576).toFixed(1)} MB`}</small></span>
          <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles((fs) => fs.filter((_, j) => j !== i))}>×</button></li>))}</ul> : null}

      {/* Bottom action bar */}
      <div className="kcomp-foot kc-modern-foot">
        {/* Discard draft trash button on left */}
        <button type="button" className="kc-foot-btn" aria-label="Discard draft" title="Discard draft" disabled={!can || !text} onClick={() => setEditor("")}>
          <Line name="trash" />
        </button>

        <button type="button" className="kc-foot-btn" aria-label="Attach files" title="Attach files (up to 3, 3 MB in all)" disabled={!can} onClick={() => fileIn.current?.click()}>
          <Line name="clip" />
          <span>Attach</span>
        </button>
        <input ref={fileIn} type="file" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
        <input ref={imageIn} type="file" accept="image/*" hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />

        {booking && can && !text.includes(booking) ? (
          <button
            type="button"
            className="kc-foot-btn"
            title="Insert booking link"
            onClick={() => insert(`${text.trim() ? "\n\n" : ""}Pick a time that suits you: ${booking}`)}
          >
            <Line name="calendar" />
            <span>Booking link</span>
          </button>
        ) : null}

        {can ? (
          <button
            type="button"
            className="kc-foot-btn"
            title="Deliverability & spam check"
            onClick={() => window.dispatchEvent(new CustomEvent("kestrel-spam-check", { detail: { subject: currSubject, body: text, mode: "reply" } }))}
          >
            <Line name="shield" />
            <span>Spam check</span>
          </button>
        ) : null}

        <span className="kcomp-grow" />
        <button type="button" className="kc-foot-link" disabled={!editable} onClick={onDone}>{waiting ? "Mark as done" : "Mark as to answer"}</button>

        {/* Calm Mono Pill Send Button [ Send Message | 🕒 ] */}
        <div className="kc-send-pill-group">
          <button type="button" className="kc-send-pill-main" disabled={busy || text.trim().length < 2 || !can} onClick={() => send(0)}>
            {busy ? "Sending…" : "Send Message"}
          </button>
          <details className="kdrop kdrop-right kc-send-more">
            <summary className="kc-send-pill-clock" aria-label="Send later or schedule" title="Send later or schedule">
              <Line name="clock" />
            </summary>
            <div className="kmenu" onClick={(e) => { if ((e.target as HTMLElement).tagName === "BUTTON" && !(e.target as HTMLElement).closest(".kc-pick")) (e.currentTarget.closest("details") as HTMLDetailsElement).open = false; }}>
              <p className="kmenu-h">Send later</p>
              <button type="button" disabled={busy || text.trim().length < 2 || !can} onClick={() => sendLater(at9(1))}>Tomorrow, 9:00</button>
              <button type="button" disabled={busy || text.trim().length < 2 || !can} onClick={() => sendLater(at9(0, 1))}>Monday, 9:00</button>
              <div className="kc-pick" onClick={(e) => e.stopPropagation()}>
                <input type="datetime-local" aria-label="Day and time to send" value={pickAt} onChange={(e) => setPickAt(e.target.value)} disabled={!can} />
                <button type="button" disabled={busy || !pickAt || text.trim().length < 2 || !can} onClick={() => sendLater(new Date(pickAt))}>Schedule</button>
              </div>
              <hr />
              <p className="kmenu-h">Send now, then snooze</p>
              <button type="button" disabled={busy || text.trim().length < 2 || !can} onClick={() => send(3)}>Send, back in 3 days</button>
              <button type="button" disabled={busy || text.trim().length < 2 || !can} onClick={() => send(7)}>Send, back in a week</button>
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}
