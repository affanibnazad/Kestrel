"use client";

// The Kestrel AI chat. It lives in the App (sidebar → Kestrel AI → Chat).
//
// The chat is part of the App page, not a page of its own: it has no frame, no title bar
// and no colour wash. It sits on the App's canvas and takes the App's colours from the
// App's own theme tokens, so Light, Dark and Gradient all look like one thing with the
// rest of the App and there is nothing to switch.
//
// There is no sign-in screen here: the chat uses the session the person already has, and
// falls back to a scripted answer when there is none.
//
// The answer arrives the way Claude writes it: one word at a time, each word fading up
// into place with a soft cursor at the end. While Kestrel is working, the wing beats and
// little Gemini-style stars spin around the mark.

import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { toBlocks } from "@/lib/assistant";
import { scriptedTurn, STARTERS, type Receipt, type Step, type Turn } from "@/lib/ai-chat-script";
import { liveTurn, type LiveMessage } from "@/lib/ai-chat-live";
import { Line, MARK_PATHS } from "@/components/ui";
import "./ai-chat.css";

const styles: Record<string, string> = new Proxy({} as Record<string, string>, {
  get: (_, prop: string) => `kchat-${prop}`,
});

type Msg = {
  id: string;
  role: "user" | "bot";
  text?: string;     // the person's question
  files?: string[];  // files they attached
  turn?: Turn;       // what Kestrel did and said
  phase?: "thinking" | "answer";
  sig?: string;      // the live route's signature for this answer, so the chat can continue
};

const SAVE_KEY = "kestrel-ai-chat-v1";
const MODEL_KEY = "kestrel-ai-chat-model";

type ChatTheme = "light" | "dark" | "gradient";

const KIND_ICON: Record<Receipt["kind"], string> = {
  leads: "people", replies: "inbox", campaigns: "folder", accounts: "mail",
  business: "building", rules: "sliders", sequence: "list",
};

// The models you can pick, like Claude's model menu. They change how the
// answer arrives: Fast writes quickly, Thinking takes longer and shows every
// step. The engine behind them is the same until the live route is ready.
const MODELS = [
  { id: "pro", name: "Kestrel Pro", note: "Best answers, normal speed", think: 430, word: 68, pause: 240 },
  { id: "fast", name: "Kestrel Fast", note: "Quick answers, shorter steps", think: 220, word: 40, pause: 130 },
  { id: "thinking", name: "Kestrel Thinking", note: "Longer think, every step shown", think: 780, word: 68, pause: 290 },
] as const;

type ModelId = (typeof MODELS)[number]["id"];

// The commands you can type after "/" (like Claude's slash commands).
const COMMANDS = [
  { cmd: "/campaigns", label: "Campaigns", q: "How are my campaigns doing?" },
  { cmd: "/replies", label: "Replies", q: "Which replies need an answer?" },
  { cmd: "/accounts", label: "Email accounts", q: "Are my email accounts ready to send?" },
  { cmd: "/write", label: "Write emails", q: "Write emails for my Good leads" },
];

// A four-point star, the same shape as the brand sparkle and Gemini's icon.
const SPARK_PATH = "M12 1.8c.55 5.85 3.85 9.15 9.7 9.7-5.85.55-9.15 3.85-9.7 9.7-.55-5.85-3.85-9.15-9.7-9.7 5.85-.55 9.15-3.85 9.7-9.7Z";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const calm = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// The App's look right now. The chat only reads it (the App owns the theme); the
// colours themselves come from the App's CSS variables, so they follow the App
// with no work at all.
function appLook(): ChatTheme {
  const t = document.documentElement.dataset.theme;
  if (t === "dark" || t === "light" || t === "gradient") return t;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

// A particle in Gemini's shape: a small four-point star in the brand gradient.
// While Kestrel is working, these stars turn and drift around the mark.
function GemStar({ size = 9, delay = 0, x = "0px", y = "0px", className }: {
  size?: number; delay?: number; x?: string; y?: string; className?: string;
}) {
  const uid = useId();
  const gid = `gGem${uid.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ "--mx": x, "--my": y, animationDelay: `${delay}ms` } as CSSProperties}
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="#7EA5DE" />
          <stop offset="55%" stopColor="#8B5CF6" />
          <stop offset="100%" stopColor="#F472B6" />
        </linearGradient>
      </defs>
      <path d={SPARK_PATH} fill={`url(#${gid})`} />
    </svg>
  );
}

// The sparkle that sits in front of the model name, like Claude's.
function SparkIcon({ size = 14 }: { size?: number }) {
  return (
    <svg className={styles.sparkIcon} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d={SPARK_PATH} fill="currentColor" />
    </svg>
  );
}

// The Kestrel mark, drawn as ink only (no tile around it). The three feathers
// are the wing: while Kestrel is thinking or searching, the wing beats. In the
// Gradient look the mark is painted with the brand gradient, and little motes
// drift around it.
function KMark({ size = 20, busy = false, theme = "light" }: { size?: number; busy?: boolean; theme?: ChatTheme }) {
  // Each mark paints its own gradient, so two marks on one page never fight
  // over the same gradient.
  const uid = useId();
  const gid = `kGrad${uid.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const paint = theme === "gradient" ? `url(#${gid})` : "currentColor";
  return (
    <span className={`${styles.kWrap} ${busy ? styles.kBusy : ""}`}>
      <svg className={styles.kmark} width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
        {theme === "gradient" ? (
          <defs>
            <linearGradient id={gid} x1="0" y1="1" x2="1" y2="0">
              <stop offset="0%" stopColor="#7EA5DE" />
              <stop offset="52%" stopColor="#8B5CF6" />
              <stop offset="100%" stopColor="#F472B6" />
            </linearGradient>
          </defs>
        ) : null}
        <rect {...MARK_PATHS.stem} fill={paint} />
        {MARK_PATHS.feathers.map((f, i) => (
          <path key={f.d} d={f.d} fill={paint} opacity={f.opacity} className={styles.feather} style={{ animationDelay: `${i * 140}ms` }} />
        ))}
        <path d={MARK_PATHS.leg} fill={paint} />
      </svg>
      {busy ? (
        <span className={styles.motes} aria-hidden="true">
          <GemStar className={styles.mote} size={10} delay={0} x="-7px" y="-8px" />
          <GemStar className={styles.mote} size={8} delay={420} x="8px" y="-5px" />
          <GemStar className={styles.mote} size={9} delay={840} x="6px" y="8px" />
        </span>
      ) : null}
    </span>
  );
}

// The paperclip and the up arrow, drawn here so the shared icon map stays
// untouched (another session is editing it).
function Paperclip({ size = 17 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

function ArrowUp({ size = 17 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 19V5" />
      <path d="m5 12 7-7 7 7" />
    </svg>
  );
}

// The answer is split into blocks (paragraphs, bullet lists, **bold**) and then
// into single lines. Every word keeps its place in the line, so the answer can
// be written out one word at a time.
type Word = { i: number; line: number; t: string; bold: boolean; last: boolean };
type LineRow = { line: number; block: number; item: boolean; words: Word[] };

function buildAnswer(text: string) {
  const blocks = toBlocks(text);
  const lines: LineRow[] = [];
  const flat: Word[] = [];
  blocks.forEach((b, bi) => {
    const raw = b.type === "p" ? b.text.split("\n") : b.items;
    raw.forEach((lineText) => {
      const li = lines.length;
      const words: Word[] = [];
      lineText.split(/(\*\*[^*]+\*\*)/g).forEach((part) => {
        if (!part) return;
        const bold = /^\*\*[^*]+\*\*$/.test(part);
        const body = bold ? part.slice(2, -2) : part;
        body.split(/\s+/).filter(Boolean).forEach((w) => {
          const word: Word = { i: flat.length, line: li, t: w, bold, last: false };
          words.push(word);
          flat.push(word);
        });
      });
      if (words.length) words[words.length - 1].last = true;
      lines.push({ line: li, block: bi, item: b.type !== "p", words });
    });
  });
  return { blocks, lines, flat };
}

// One line of the answer. The words arrive one by one, each fading up into
// place, and a soft cursor waits at the writing point.
function MagicLine({ row, shown, newest }: { row: LineRow; shown: number; newest: number }) {
  const words = row.words.filter((w) => w.i < shown);
  return (
    <span className={styles.wordRow}>
      {words.map((w, k) => (
        <Fragment key={w.i}>
          <span className={styles.revealWord}>{w.bold ? <strong>{w.t}</strong> : w.t}</span>
          {k < words.length - 1 ? " " : null}
          {w.i === newest ? <span className={styles.nib} aria-hidden="true" /> : null}
        </Fragment>
      ))}
    </span>
  );
}

// The answer is written out word by word. A line finishes, there is a short
// pause, then the next line starts — so it reads down the page. When the last
// word is out it says so, so the mark knows Kestrel is still busy.
function RevealAnswer({ text, wordMs, linePause, onDone, onTick }: {
  text: string; wordMs: number; linePause: number; onDone?: () => void; onTick?: () => void;
}) {
  const { blocks, lines, flat } = useMemo(() => buildAnswer(text), [text]);
  const [shown, setShown] = useState(0);
  // How far the writing has got. It is kept outside the effect so that
  // changing the model mid-answer makes the writing faster or slower without
  // starting the answer again.
  const progress = useRef({ text: "", i: 0, done: false });
  // The "finished" note lives in a ref, so a new callback never restarts the
  // writing.
  const doneRef = useRef(onDone);
  // The same for the scroll: a new callback on every word must not restart
  // the writing either.
  const tickRef = useRef(onTick);
  useEffect(() => { doneRef.current = onDone; tickRef.current = onTick; });

  useEffect(() => {
    if (progress.current.text !== text) progress.current = { text, i: 0, done: false };
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const finish = () => {
      if (progress.current.done) return;
      progress.current.done = true;
      doneRef.current?.();
    };
    const tick = () => {
      if (cancelled) return;
      if (calm()) { setShown(flat.length); tickRef.current?.(); finish(); return; }
      progress.current.i += 1;
      setShown(progress.current.i);
      // Keep the newest words in view while the answer is being written.
      tickRef.current?.();
      if (progress.current.i < flat.length) {
        const word = flat[progress.current.i - 1];
        timer = setTimeout(tick, word && word.last ? linePause : wordMs);
      } else {
        finish();
      }
    };
    timer = setTimeout(tick, 170);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [text, flat, wordMs, linePause]);

  // Only the lines that have started are on the page, and only the words that
  // have been written.
  const newest = shown - 1;
  const lastLine = newest >= 0 ? flat[newest].line : -1;
  const visible = lines.filter((l) => l.line <= lastLine);

  return (
    <div className={styles.answer}>
      {blocks.map((b, bi) => {
        const rows = visible.filter((l) => l.block === bi);
        if (!rows.length) return null;
        if (b.type === "ul") {
          return <ul key={bi}>{rows.map((r) => <li key={r.line}><MagicLine row={r} shown={shown} newest={newest} /></li>)}</ul>;
        }
        if (b.type === "ol") {
          return <ol key={bi}>{rows.map((r) => <li key={r.line}><MagicLine row={r} shown={shown} newest={newest} /></li>)}</ol>;
        }
        return (
          <p key={bi}>
            {rows.map((r) => (
              <span key={r.line} className={styles.pLine}>
                <MagicLine row={r} shown={shown} newest={newest} />
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}

// The thinking process: what Kestrel did, step by step, with the time it took.
// The mark keeps working while the answer is being written, so the wing beats
// and the stars spin until Kestrel is truly done.
function Thinking({ steps, theme, busy = false }: { steps: Step[]; theme: ChatTheme; busy?: boolean }) {
  const pending = steps.some((s) => s.state !== "done");
  const working = pending || busy;
  const total = steps.reduce((n, s) => n + (s.ms || 0), 0);
  return (
    <>
      <div className={styles.botHead}>
        <KMark size={22} busy={working} theme={theme} />
        <span className={styles.thinkLabel}>{pending ? "Thinking" : "Thought through"}</span>
        <span className={styles.thinkMeta}>
          {steps.length} {steps.length === 1 ? "step" : "steps"}
          {total ? ` · ${total} ms` : ""}
        </span>
      </div>
      <ol className={styles.steps}>
        {steps.map((s) => (
          <li className={styles.step} key={s.id}>
            <span className={`${styles.dot} ${s.state === "running" ? styles.dotRun : s.state === "done" ? styles.dotDone : styles.dotWait}`} />
            <span className={styles.stepLabel}>{s.label}</span>
            {s.detail ? <span className={styles.stepDetail}>{s.detail}</span> : null}
            <span className={styles.stepMs}>{s.state === "done" && s.ms ? `${s.ms} ms` : ""}</span>
          </li>
        ))}
      </ol>
    </>
  );
}

// The search receipts: exactly what it searched for, and how much it found.
function Receipts({ receipts }: { receipts: Receipt[] }) {
  if (!receipts.length) return null;
  return (
    <div className={styles.receipts}>
      {receipts.map((r) => (
        <span className={styles.receipt} key={r.id}>
          <Line name={KIND_ICON[r.kind]} />
          <span className={styles.receiptQuery}>{r.query}</span>
          <span className={styles.receiptCount}>{r.count}</span>
        </span>
      ))}
    </div>
  );
}

// A question handed in from the App (the search box at the top) or from the
// address bar (?q=). The id makes sure the same question twice still asks twice.
export type ChatQuestion = { text: string; id: number };

export default function AiChat({ question, onAsked }: {
  question?: ChatQuestion | null;
  onAsked?: () => void;         // called once the question has been sent
}) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [model, setModel] = useState<ModelId>("pro");
  const [modelOpen, setModelOpen] = useState(false);
  const [files, setFiles] = useState<string[]>([]);
  const [listening, setListening] = useState(false);
  const [theme, setTheme] = useState<ChatTheme>("light");
  // Which answer is being written right now. The mark keeps working until the
  // last word is out.
  const [writingId, setWritingId] = useState<string | null>(null);
  const thread = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  // The busy flag as a ref too, so a question can be started from a click
  // handler without waiting for the next render.
  const busyRef = useRef(false);
  // Whether the conversation is pinned to the newest message. It is released
  // when the person scrolls up to read, and taken again when they come back.
  const stick = useRef(true);

  const chosen = MODELS.find((m) => m.id === model) ?? MODELS[0];

  // The App's look. The chat only reads it, so a change in Profile →
  // Appearance reaches the chat too.
  useEffect(() => {
    const apply = () => setTheme(appLook());
    const t = setTimeout(apply, 0);
    const watcher = new MutationObserver(apply);
    watcher.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const scheme = window.matchMedia("(prefers-color-scheme: dark)");
    const onScheme = () => { if (!document.documentElement.dataset.theme) apply(); };
    scheme.addEventListener?.("change", onScheme);
    return () => {
      clearTimeout(t);
      watcher.disconnect();
      scheme.removeEventListener?.("change", onScheme);
    };
  }, []);

  // Keep the conversation in this browser.
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const saved = JSON.parse(localStorage.getItem(SAVE_KEY) || "null");
        if (saved && Array.isArray(saved.msgs)) setMsgs(saved.msgs as Msg[]);
        const m = localStorage.getItem(MODEL_KEY) as ModelId | null;
        if (m && MODELS.some((x) => x.id === m)) setModel(m);
      } catch { /* private window: start empty */ }
      setLoaded(true);
    }, 0);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem(SAVE_KEY, JSON.stringify({ msgs })); } catch { /* private window */ }
  }, [msgs, loaded]);
  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem(MODEL_KEY, model); } catch { /* private window */ }
  }, [model, loaded]);

  // The conversation follows the newest message, unless the person has
  // scrolled up to read something.
  const toEnd = useCallback((smooth = false) => {
    const el = thread.current;
    if (!el || !stick.current) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth && !calm() ? "smooth" : "auto" });
  }, []);
  useEffect(() => { toEnd(true); }, [msgs, toEnd]);

  // The model menu closes when you click away from it.
  useEffect(() => {
    if (!modelOpen) return;
    const away = (e: MouseEvent) => {
      if (picker.current && !picker.current.contains(e.target as Node)) setModelOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [modelOpen]);

  const patch = useCallback((id: string, fn: (m: Msg) => Msg) => {
    setMsgs((all) => all.map((m) => (m.id === id ? fn(m) : m)));
  }, []);

  // Asks a question. It says whether the question actually started, so a
  // question that arrives while Kestrel is busy can wait instead of being lost.
  const ask = useCallback((question: string): boolean => {
    const q = question.trim();
    if (!q || busyRef.current) return false;
    const uid = `${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
    const userId = `u-${uid}`;
    const botId = `b-${uid}`;
    const sent = files;
    setText("");
    setFiles([]);
    busyRef.current = true;
    setBusy(true);

    // The scripted answer, used when this browser has no session.
    const scripted = scriptedTurn(q);

    setMsgs((all) => [
      ...all,
      { id: userId, role: "user", text: q, files: sent },
      { id: botId, role: "bot", phase: "thinking", turn: { steps: [], answer: "", receipts: [], context: { title: "What I am looking at", rows: [] } } },
    ]);

    // The live answer, when this browser has a session. The route uses that
    // session silently: there is no log-in page here. With no session (or with
    // the AI not switched on yet) the scripted answer is used instead.
    const history: LiveMessage[] = [
      ...msgs.flatMap((m): LiveMessage[] => {
        if (m.role === "user" && m.text) return [{ role: "user", content: m.text }];
        // Only the live answers carry the server's signature, so only they can
        // be sent back.
        if (m.role === "bot" && m.sig && m.turn?.answer) return [{ role: "assistant", content: m.turn.answer, sig: m.sig }];
        return [];
      }),
      { role: "user", content: q },
    ];

    const idle = () => { busyRef.current = false; setBusy(false); };

    void (async () => {
      const live = await liveTurn(history, (s) => {
        patch(botId, (m) => ({ ...m, turn: { ...m.turn!, steps: [...m.turn!.steps, s] } }));
      });

      if (live.kind === "live") {
        const rows = live.usage ? [{ label: "Messages today", value: `${live.usage.used} of ${live.usage.limit}` }] : [];
        patch(botId, (m) => ({
          ...m,
          phase: "answer",
          sig: live.sig,
          turn: { steps: live.steps, answer: live.text, receipts: [], context: { title: "What I am looking at", rows }, ai: live.ai },
        }));
        setWritingId(botId);
        idle();
        return;
      }

      if (live.kind === "error") {
        patch(botId, (m) => ({
          ...m,
          phase: "answer",
          turn: { steps: [{ id: "e1", label: "Kestrel AI could not answer", state: "done" }], answer: live.error, receipts: [], context: { title: "What I am looking at", rows: [] } },
        }));
        setWritingId(botId);
        idle();
        return;
      }

      // No session: the scripted answer, one step at a time.
      patch(botId, (m) => ({ ...m, turn: { ...m.turn!, steps: scripted.steps.map((s) => ({ ...s, state: "waiting" as const })) } }));
      for (const step of scripted.steps) {
        patch(botId, (m) => ({ ...m, turn: { ...m.turn!, steps: m.turn!.steps.map((s) => (s.id === step.id ? { ...s, state: "running" as const } : s)) } }));
        await sleep(calm() ? 60 : chosen.think);
        patch(botId, (m) => ({ ...m, turn: { ...m.turn!, steps: m.turn!.steps.map((s) => (s.id === step.id ? { ...s, state: "done" as const, ms: step.ms } : s)) } }));
        await sleep(calm() ? 20 : 150);
      }
      patch(botId, (m) => ({ ...m, phase: "answer", turn: { ...m.turn!, answer: scripted.answer, receipts: scripted.receipts, context: scripted.context } }));
      setWritingId(botId);
      idle();
    })();

    return true;
  }, [patch, chosen, files, msgs]);

  // A question handed in from the App (the search box at the top) or from the
  // address bar (?q=) is asked once. It waits for the saved conversation to come
  // back first: asking before the restore would wipe the new question with the
  // saved one.
  const askedId = useRef<number | null>(null);
  const askedUrl = useRef(false);
  // The latest ask() and onAsked(), so sending the question does not have to
  // wait for them to be stable.
  const askRef = useRef(ask);
  const onAskedRef = useRef(onAsked);
  useEffect(() => {
    askRef.current = ask;
    onAskedRef.current = onAsked;
  });
  useEffect(() => {
    if (!loaded) return;
    const urlQuestion = () => {
      if (typeof window === "undefined") return "";
      return (new URLSearchParams(window.location.search).get("q") || "").trim();
    };
    const prop = question && question.text.trim() ? question : null;
    const propId = prop ? prop.id : null;
    let q = "";
    if (prop) {
      if (askedId.current === propId) return;
      q = prop.text.trim();
    } else {
      if (askedUrl.current) return;
      q = urlQuestion();
      if (!q) return;
    }
    // Sent on the next tick, the same way the saved conversation comes back.
    // If Kestrel is still busy, the question waits for the next free moment
    // instead of being dropped.
    let tries = 0;
    let timer: ReturnType<typeof setTimeout>;
    const run = () => {
      if (askRef.current(q)) {
        if (propId !== null) {
          askedId.current = propId;
          // If the address bar carries the same question, do not ask it twice.
          if (urlQuestion() === q) askedUrl.current = true;
        } else {
          askedUrl.current = true;
        }
        onAskedRef.current?.();
        return;
      }
      if (tries++ < 60) timer = setTimeout(run, 250);
    };
    timer = setTimeout(run, 0);
    return () => clearTimeout(timer);
  }, [loaded, question]);

  function grow(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }

  function newChat() {
    setMsgs([]);
    setText("");
    setFiles([]);
    setWritingId(null);
    stick.current = true;
    input.current?.focus();
  }

  // The "/" menu: type a slash and the commands show up.
  const slashOpen = text.startsWith("/") && !text.includes(" ");
  const slashList = slashOpen ? COMMANDS.filter((c) => c.cmd.startsWith(text.toLowerCase())) : [];

  function pickCommand(cmd: string) {
    const found = COMMANDS.find((c) => c.cmd === cmd);
    setText("");
    if (found) ask(found.q);
  }

  // Voice input, when the browser has it (useSyncExternalStore prevents hydration mismatch).
  const canListen = useSyncExternalStore(
    () => () => {},
    () =>
      typeof window !== "undefined" &&
      !!((window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition ||
         (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition),
    () => false,
  );

  function listen() {
    const SR = (window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    }).SpeechRecognition ?? (window as unknown as {
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    }).webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.lang = "en-GB";
    rec.interimResults = false;
    rec.onresult = (e: { results: ArrayLike<{ 0: { transcript: string } }> }) => {
      const said = e.results[0]?.[0]?.transcript ?? "";
      if (said) setText((t) => (t ? `${t} ${said}` : said));
    };
    rec.onend = () => setListening(false);
    setListening(true);
    rec.start();
  }

  const lastTurn = useMemo(() => [...msgs].reverse().find((m) => m.role === "bot" && m.turn)?.turn, [msgs]);
  const searches = useMemo(
    () => msgs.filter((m) => m.turn).flatMap((m) => m.turn!.receipts).slice(-8).reverse(),
    [msgs],
  );
  const lastFiles = useMemo(
    () => [...msgs].reverse().find((m) => m.role === "user" && m.files?.length)?.files ?? [],
    [msgs],
  );

  return (
    <div className={styles.page}>
      <div className={styles.body}>
        <main className={styles.main}>
          <div
            className={styles.thread}
            ref={thread}
            data-lenis-prevent
            onScroll={(e) => {
              const el = e.currentTarget;
              stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
            }}
          >
            <div className={styles.threadInner}>
              {msgs.length === 0 ? (
                <div className={styles.empty}>
                  <div className={styles.emptyMark} aria-hidden="true"><KMark size={30} busy theme={theme} /></div>
                  <h1 className={styles.emptyTitle}>Ask Kestrel</h1>
                  <p className={styles.emptySub}>Your leads, campaigns, replies and sending — one question away.</p>
                  <div className={styles.starters}>
                    {STARTERS.map((s) => (
                      <button type="button" className={styles.starter} key={s.q} onClick={() => ask(s.q)}>
                        <span className={styles.starterQ}>{s.q}</span>
                        <span className={styles.starterHint}>{s.hint}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {msgs.map((m) => {
                if (m.role === "user") return (
                  <div className={styles.msgUser} key={m.id}>
                    <span>{m.text}</span>
                    {m.files?.length ? (
                      <span className={styles.msgFiles}>{m.files.join(" · ")}</span>
                    ) : null}
                  </div>
                );
                if (!m.turn) return null;
                return (
                  <div className={styles.msgBot} key={m.id}>
                    <div className={styles.botBody}>
                      <Thinking steps={m.turn.steps} theme={theme} busy={writingId === m.id} />
                      {m.phase === "answer" ? (
                        <>
                          <Receipts receipts={m.turn.receipts} />
                          <RevealAnswer
                            text={m.turn.answer}
                            wordMs={chosen.word}
                            linePause={chosen.pause}
                            onDone={() => setWritingId((id) => (id === m.id ? null : id))}
                            onTick={() => toEnd()}
                          />
                        </>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className={styles.composerWrap}>
            {slashList.length ? (
              <div className={styles.slashMenu}>
                {slashList.map((c) => (
                  <button type="button" className={styles.slashItem} key={c.cmd} onClick={() => pickCommand(c.cmd)}>
                    <span className={styles.slashCmd}>{c.cmd}</span>
                    <span className={styles.slashLabel}>{c.label}</span>
                  </button>
                ))}
              </div>
            ) : null}

            <form className={styles.composer} onSubmit={(e) => { e.preventDefault(); ask(text); }}>
              <textarea
                ref={input}
                className={styles.composerInput}
                rows={1}
                value={text}
                placeholder="Ask Kestrel anything, or type / for commands…"
                aria-label="Ask Kestrel"
                onChange={(e) => { setText(e.target.value); grow(e.target); }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(text); }
                }}
              />

              {files.length ? (
                <div className={styles.attached}>
                  {files.map((f) => (
                    <span className={styles.attachedChip} key={f}>
                      <span className={styles.attachedName}>{f}</span>
                      <button
                        type="button"
                        className={styles.attachedRemove}
                        aria-label={`Remove ${f}`}
                        onClick={() => setFiles((all) => all.filter((x) => x !== f))}
                      >
                        <Line name="close" />
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}

              <div className={styles.composerBar}>
                <div className={styles.barLeft}>
                  <button
                    type="button"
                    className={styles.iconBtn}
                    aria-label="Attach a file"
                    title="Attach a file"
                    onClick={() => fileInput.current?.click()}
                  >
                    <Paperclip />
                  </button>
                  <input
                    ref={fileInput}
                    type="file"
                    multiple
                    className={styles.fileInput}
                    onChange={(e) => {
                      const names = Array.from(e.target.files ?? []).map((f) => f.name);
                      if (names.length) setFiles((all) => [...all, ...names]);
                      e.target.value = "";
                    }}
                  />
                  <button
                    type="button"
                    className={`${styles.iconBtn} ${listening ? styles.iconBtnLive : ""}`}
                    aria-label="Speak your question"
                    title={canListen ? "Speak your question" : "Voice input is not available in this browser"}
                    disabled={!canListen}
                    onClick={listen}
                  >
                    <Line name="mic" />
                  </button>
                </div>

                <div className={styles.barMid}>
                  <button type="button" className={styles.newChatBtn} onClick={newChat} disabled={!msgs.length || busy}>
                    <Line name="plus" />
                    <span>New chat</span>
                  </button>
                </div>

                <div className={styles.barRight}>
                  <button
                    type="button"
                    className={`${styles.ghostBtn} ${styles.railToggle}`}
                    onClick={() => setRailOpen(true)}
                    aria-label="Open context"
                  >
                    <Line name="sliders" />
                    <span className={styles.btnText}>Context</span>
                  </button>
                  <div className={styles.modelWrap} ref={picker}>
                    <button
                      type="button"
                      className={styles.modelBtn}
                      onClick={() => setModelOpen((v) => !v)}
                      aria-haspopup="listbox"
                      aria-expanded={modelOpen}
                    >
                      <SparkIcon />
                      <span className={styles.modelName}>{chosen.name}</span>
                      <Line name="chevronDown" />
                    </button>
                    {modelOpen ? (
                      <div className={styles.modelMenu} role="listbox">
                        {MODELS.map((m) => (
                          <button
                            type="button"
                            role="option"
                            aria-selected={m.id === model}
                            className={`${styles.modelItem} ${m.id === model ? styles.modelItemOn : ""}`}
                            key={m.id}
                            onClick={() => { setModel(m.id); setModelOpen(false); }}
                          >
                            <span className={styles.modelItemName}>{m.name}</span>
                            <span className={styles.modelItemNote}>{m.note}</span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <button type="submit" className={styles.send} disabled={!text.trim() || busy} aria-label="Send">
                    <ArrowUp />
                  </button>
                </div>
              </div>
            </form>
          </div>
        </main>

        {railOpen ? <div className={styles.scrim} onClick={() => setRailOpen(false)} aria-hidden="true" /> : null}
        <aside className={`${styles.rail} ${railOpen ? styles.railOpen : ""}`} aria-label="Context" data-lenis-prevent>
          <button type="button" className={styles.railClose} onClick={() => setRailOpen(false)} aria-label="Close context">
            <Line name="close" />
          </button>
          <div className={styles.railCard}>
            <h2 className={styles.railTitle}>{lastTurn ? lastTurn.context.title : "Context"}</h2>
            {lastTurn ? (
              <div className={styles.railRows}>
                {lastTurn.context.rows.map((r) => (
                  <div className={styles.railRow} key={r.label}>
                    <span className={styles.railLabel}>{r.label}</span>
                    <span className={styles.railValue}>{r.value}</span>
                  </div>
                ))}
                <div className={styles.railRow}>
                  <span className={styles.railLabel}>Model</span>
                  <span className={styles.railValue}>{lastTurn.ai || chosen.name}</span>
                </div>
                {lastFiles.length ? (
                  <div className={styles.railRow}>
                    <span className={styles.railLabel}>Attached</span>
                    <span className={styles.railValue}>{lastFiles.length}</span>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className={styles.railNote}>Nothing yet. Ask a question and Kestrel shows what it opens.</p>
            )}
          </div>
          <div className={styles.railCard}>
            <h2 className={styles.railTitle}>Searches</h2>
            {searches.length ? (
              <div className={styles.railList}>
                {searches.map((r, i) => (
                  <div className={styles.railItem} key={`${r.id}-${i}`}>
                    <Line name={KIND_ICON[r.kind]} />
                    <span className={styles.railItemText}>{r.query}</span>
                    <b>{r.count}</b>
                  </div>
                ))}
              </div>
            ) : (
              <p className={styles.railNote}>No searches yet.</p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

// A tiny shape for the browser's speech API, so the file needs no extra types.
type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  onresult: ((e: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
};
