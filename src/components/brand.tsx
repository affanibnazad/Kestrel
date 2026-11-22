import { siBrave, siClaude, siGoogle, siGooglechrome, siGooglegemini, siGooglemaps, siOpenrouter, siOpenstreetmap, siYoutube } from "simple-icons";
import { Icon } from "@/components/ui";

// Real logos for the services Kestrel works with, from Simple Icons (CC0). Shown only to say which
// services Kestrel connects to; each logo belongs to its owner. Services without a public logo in that
// set (ChatGPT, Codex, Hunter.io, Listen Notes, Companies House) use a plain Kestrel icon instead.
type Logo = { title: string; path?: string; hex?: string; own?: string };
const SI = (i: { title: string; path: string; hex: string }, title = i.title): Logo => ({ title, path: i.path, hex: i.hex });

export const LOGOS: Record<string, Logo> = {
  maps: SI(siGooglemaps),
  google: SI(siGoogle, "Google Search"),
  youtube: SI(siYoutube),
  osm: SI(siOpenstreetmap),
  claude: SI(siClaude),
  claudecode: SI(siClaude, "Claude Code"),
  gemini: SI(siGooglegemini, "Gemini"),
  openrouter: { ...SI(siOpenrouter), hex: "6467F2" },
  brave: SI(siBrave),
  chrome: SI(siGooglechrome),
  chatgpt: { title: "ChatGPT", own: "chat" },
  codex: { title: "Codex", own: "code" },
  hunter: { title: "Hunter.io", own: "at" },
  listennotes: { title: "Listen Notes", own: "mic" },
  companies: { title: "Companies House", own: "building" },
  jobs: { title: "Job boards", own: "briefcase" },
  page: { title: "Any web page", own: "list" },
  sites: { title: "Your websites", own: "globe" },
  kestrel: { title: "Kestrel extension", own: "extension" },
};

export function LogoTile({ id }: { id: string }) {
  const l = LOGOS[id];
  if (!l) return null;
  if (l.own) return <span className="logo-tile own" aria-hidden="true"><Icon name={l.own} /></span>;
  return (
    <span className="logo-tile" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill={`#${l.hex}`}><path d={l.path} /></svg>
    </span>
  );
}

export function LogoChip({ id }: { id: string }) {
  // Website: names only, no logos.
  return <span className="chip">{LOGOS[id]?.title}</span>;
}

// "Works with": every service grouped by what it does, as text rows with logo chips.
export const WORKS_WITH: [string, string[]][] = [
  ["Browsers", ["brave", "chrome"]],
  ["Sources", ["maps", "google", "youtube", "osm", "companies", "listennotes", "jobs", "page", "sites"]],
  ["AI models", ["claude", "chatgpt", "gemini", "openrouter"]],
  ["No API key", ["claudecode", "codex"]],
  ["Contacts", ["hunter", "companies"]],
];

// "Works with": two gently moving rows of names, then one soft tile per group (like the reference design).
const MQ1 = ["Google Maps", "Google Search", "YouTube", "OpenStreetMap", "Companies House", "Listen Notes", "Job boards", "Any web page", "Your website lists"];
const MQ2 = ["Claude", "ChatGPT", "Gemini", "OpenRouter", "Groq", "NVIDIA", "Claude Code", "Codex", "Hunter.io", "Brave", "Google Chrome"];
const WT_TEXT: Record<string, string> = {
  Browsers: "The extension runs in the browser you already use.",
  "AI models": "Score and write with the model you prefer, using your own key.",
  "No API key": "Use your coding assistant with a job file instead of a key.",
  Contacts: "Find business emails and the people who decide.",
};

export function WorksWith() {
  return (
    <>
      <p className="sr-only">Sources: {MQ1.join(", ")}. Tools: {MQ2.join(", ")}.</p>
      <div className="marquee" aria-hidden="true"><div className="mq-track">{[...MQ1, ...MQ1, ...MQ1, ...MQ1, ...MQ1, ...MQ1].map((n, i) => <span key={i} className="chip">{n}</span>)}</div></div>
      <div className="marquee rev" aria-hidden="true"><div className="mq-track">{[...MQ2, ...MQ2, ...MQ2, ...MQ2, ...MQ2, ...MQ2].map((n, i) => <span key={i} className="chip">{n}</span>)}</div></div>
      <div className="wtiles">
        {WORKS_WITH.filter(([group]) => group !== "Sources").map(([group, ids]) => (
          <article key={group} className="wtile">
            <h3>{group}</h3>
            <p>{WT_TEXT[group]}</p>
            <div className="wchips">{ids.map((id) => <span key={id} className="chip">{LOGOS[id].title}</span>)}</div>
          </article>
        ))}
      </div>
    </>
  );
}
