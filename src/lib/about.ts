// The About page (Phase 2, 18 Nov 2026): how a team uses Kestrel, what it does, its proof and its tone, saved in
// team_about (database 059). The AI reads it for scoring, writing and Kestrel AI (aboutForAi).

export type Mode = "agency" | "solo" | "whitelabel";
export type Proof = { id: string; title: string; result: string; link: string };
export type VoiceNotes = {
  greeting?: string;
  sign_off?: string;
  sentence_length?: string;
  words_used?: string[];
  words_avoided?: string[];
};
export type About = {
  mode: Mode;
  website: string;
  about: string;
  proof: Proof[];
  tone: string;
  avoid: string;
  voice_notes?: VoiceNotes;
};

export const EMPTY_VOICE_NOTES: VoiceNotes = {
  greeting: "",
  sign_off: "",
  sentence_length: "",
  words_used: [],
  words_avoided: [],
};

export const EMPTY_ABOUT: About = {
  mode: "agency",
  website: "",
  about: "",
  proof: [],
  tone: "",
  avoid: "",
  voice_notes: EMPTY_VOICE_NOTES,
};
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

  let rawVn = (r.voice_notes && typeof r.voice_notes === "object" ? r.voice_notes : null) as Record<string, unknown> | null;
  // If voice_notes column is null or pending migration, extract from embedded tag in about or tone if present
  if (!rawVn && typeof r.about === "string" && r.about.includes("<!-- VN:")) {
    try {
      const match = r.about.match(/<!-- VN:([\s\S]*?) -->/);
      if (match && match[1]) rawVn = JSON.parse(match[1]);
    } catch {}
  }
  if (!rawVn) rawVn = {};
  const voice_notes: VoiceNotes = {
    greeting: str(rawVn.greeting, 100),
    sign_off: str(rawVn.sign_off, 100),
    sentence_length: str(rawVn.sentence_length, 150),
    words_used: Array.isArray(rawVn.words_used)
      ? rawVn.words_used.map((w) => str(w, 50)).filter(Boolean).slice(0, 20)
      : [],
    words_avoided: Array.isArray(rawVn.words_avoided)
      ? rawVn.words_avoided.map((w) => str(w, 50)).filter(Boolean).slice(0, 20)
      : [],
  };

  return {
    mode,
    website: url(r.website),
    about: str(r.about, 2000).replace(/\s*<!--\s*VN:[\s\S]*?-->/g, "").trim(),
    proof,
    tone: str(r.tone, 600),
    avoid: str(r.avoid, 600),
    voice_notes,
  };
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
  if (a.voice_notes) {
    const vn = a.voice_notes;
    if (vn.greeting) out.push(`- Sender voice greeting: ${vn.greeting}`);
    if (vn.sign_off) out.push(`- Sender voice sign-off: ${vn.sign_off}`);
    if (vn.sentence_length) out.push(`- Sender sentence rhythm: ${vn.sentence_length}`);
    if (vn.words_used?.length) out.push(`- Words/phrases they naturally use: ${vn.words_used.join(", ")}`);
    if (vn.words_avoided?.length) out.push(`- Words they strictly avoid: ${vn.words_avoided.join(", ")}`);
  }
  return out.join("\n");
}
