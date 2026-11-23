// The About page (Phase 2, 18 Nov 2026): how a team uses Kestrel, what it does, its proof and its tone, saved in
// team_about (database 059). The AI reads it for scoring, writing and Kestrel AI (aboutForAi).

export type Mode = "agency" | "solo" | "whitelabel";
export type Proof = { id: string; title: string; result: string; link: string };
export type About = { mode: Mode; website: string; about: string; proof: Proof[]; tone: string; avoid: string };

export const EMPTY_ABOUT: About = { mode: "agency", website: "", about: "", proof: [], tone: "", avoid: "" };
export const MODES: { id: Mode; name: string; who: string; help: string }[] = [
  { id: "agency", name: "Agency or B2B team", who: "You sell to businesses as a team.",
    help: "Emails speak for your business (we, our team) and leads are businesses." },
  { id: "solo", name: "Solo freelancer", who: "You work on your own, for businesses or for people.",
    help: "Emails speak as you (I, me), and leads can be businesses, creators or people." },
  { id: "whitelabel", name: "White-label agency", who: "You run outreach for your own clients.",
    help: "Emails speak for the client you work for. Client workspaces with their own name and logo come in a later update." },
];
export const TONES = ["Friendly", "Direct", "Warm", "Formal", "Playful"] as const;

const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\u0000/g, "").trim().slice(0, max) : "");
const url = (v: unknown) => { const s = str(v, 300); return /^https?:\/\/[^\s<>"]+$/i.test(s) ? s : ""; };

// Whatever the database or the browser sends, return a safe About (the database checks the same limits).
export function cleanAbout(raw: unknown): About {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const mode = MODES.some((m) => m.id === r.mode) ? (r.mode as Mode) : "agency";
  const proof = (Array.isArray(r.proof) ? r.proof : []).slice(0, 10).map((p) => {
    const x = (p && typeof p === "object" ? p : {}) as Record<string, unknown>;
    const id = typeof x.id === "string" && x.id.trim() ? str(x.id, 64) : (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : Math.random().toString(36).slice(2));
    return { id, title: str(x.title, 80), result: str(x.result, 300), link: url(x.link) };
  }).filter((p) => p.title || p.result);
  return { mode, website: url(r.website), about: str(r.about, 2000), proof, tone: str(r.tone, 600), avoid: str(r.avoid, 600) };
}

// A setup step is done when the business is described (Home's setup wizard).
export const aboutReady = (a: About | null) => Boolean(a && a.about.length >= 20);

// The lines the AI gets about the sender. Proof is quoted as written: the AI must never invent results.
export function aboutForAi(a: About | null): string {
  if (!a) return "";
  const out: string[] = [];
  const mode = MODES.find((m) => m.id === a.mode);
  if (mode) out.push(`- How they work: ${mode.name}. ${mode.help}`);
  if (a.about) out.push(`- What they do: ${a.about}`);
  if (a.website) out.push(`- Website: ${a.website}`);
  if (a.proof.length) out.push(`- Proof they may mention (use at most one, exactly as written, only when it fits this lead; never invent results):\n${a.proof.map((p) => `  - ${p.title}${p.result ? `: ${p.result}` : ""}`).join("\n")}`);
  if (a.tone) out.push(`- Tone of voice: ${a.tone}`);
  if (a.avoid) out.push(`- Never use these words: ${a.avoid}`);
  return out.join("\n");
}
