export type ZoneId = "collect" | "understand" | "decide" | "write" | "send";

export type BrainNodeKind = "code" | "code sm" | "ai" | "wait" | "done" | "ai sm sub" | "code sm sub";

export type BrainNodeDef = {
  id: string;
  z?: ZoneId;
  x: number;
  y: number;
  n: string;
  ic: string;
  k: BrainNodeKind;
  w: string;
  own?: 1;
  timeoutLabel?: string;
};

export type BrainZoneDef = {
  id: ZoneId;
  n: string;
  d: string;
};

export type BrainEdgeDef = [source: string, target: string, isSub?: 1];

export type BrainEvent = {
  id: string;
  lead_id: string | null;
  lead_name: string;
  agent: string;
  from_agent: string | null;
  status: "started" | "ok" | "error" | "skipped";
  ms: number;
  ai_run_id?: number | null;
  tokens_in?: number | null;
  tokens_out?: number | null;
  source?: "kestrel" | "team_key" | "code";
  summary: string;
  created_at: string;
};

export type BrainLead = {
  id: string;
  name: string;
  at: string;
  phase: "idle" | "work";
  summary?: string;
  outreach_approved?: boolean;
};

export const W = { n: 184, sm: 164, sub: 48 } as const;
export const H = { n: 62, sm: 50, sub: 48 } as const;
export const COLX = 236;
export const ZGAP = 44;
export const ROWY = [0, 340, 680] as const;

export const Z: BrainZoneDef[] = [
  { id: "collect", n: "1 · Collect", d: "Gather public facts about each lead" },
  { id: "understand", n: "2 · Understand", d: "Turn pages into checked facts" },
  { id: "decide", n: "3 · Decide", d: "Score against your offers, then you decide" },
  { id: "write", n: "4 · Write", d: "Email in your voice, checked before sending" },
  { id: "send", n: "5 · Send", d: "Only checked emails go out" },
];

export const N: BrainNodeDef[] = [
  { id: "new", z: "collect", x: 0, y: 0, n: "New leads", ic: "inbox", k: "code", w: "Collected leads" },
  { id: "web", z: "collect", x: 1, y: -2, n: "Website", ic: "globe", k: "code sm", w: "Safe page reader" },
  { id: "gmb", z: "collect", x: 1, y: -1, n: "Google profile", ic: "map-pin", k: "code sm", w: "Google profile reader" },
  { id: "soc", z: "collect", x: 1, y: 0, n: "Social links", ic: "share-2", k: "code sm", w: "Link finder" },
  { id: "yt", z: "collect", x: 1, y: 1, n: "YouTube", ic: "youtube", k: "code sm", w: "YouTube checker" },
  { id: "job", z: "collect", x: 1, y: 2, n: "Job pages", ic: "briefcase", k: "code sm", w: "Careers page reader" },
  { id: "merge", z: "collect", x: 2, y: 0, n: "Merge", ic: "git-merge", k: "code", w: "Lead file builder" },
  { id: "sig", z: "understand", x: 3, y: 0, n: "Signals", ic: "radar", k: "code", w: "Signal detectors (code)" },
  { id: "read", z: "understand", x: 4, y: 0, n: "Read", ic: "scan-text", k: "ai", w: "Kestrel AI · research", timeoutLabel: "20 s · 1 retry" },
  { id: "quote", z: "understand", x: 5, y: 0, n: "Quote check", ic: "quote", k: "code", w: "Quote verifier (code)" },
  { id: "score", z: "decide", x: 6, y: 0, n: "Match score", ic: "gauge", k: "code", w: "Rules × your offer weights" },
  { id: "explain", z: "decide", x: 7, y: 0, n: "Explain", ic: "message-square-text", k: "ai", w: "Kestrel AI · explain", timeoutLabel: "10 s · 1 retry" },
  { id: "approve", z: "decide", x: 8, y: 0, n: "You approve", ic: "user-check", k: "wait", w: "You" },
  { id: "angle", z: "write", x: 9, y: 0, n: "Angle", ic: "compass", k: "code", w: "Angle picker (code)" },
  { id: "write", z: "write", x: 10, y: 0, n: "Write", ic: "pen-line", k: "ai", w: "Kestrel AI · write", timeoutLabel: "40 s · 1 retry" },
  { id: "qc", z: "write", x: 11, y: 0, n: "QC", ic: "shield-check", k: "ai", w: "Kestrel AI · QC + code", timeoutLabel: "15 s · 1 retry" },
  { id: "ready", z: "send", x: 12, y: 0, n: "Ready to send", ic: "mail-check", k: "done", w: "Checked emails" },
  { id: "camp", z: "send", x: 13, y: 0, n: "Campaign", ic: "send", k: "done", w: "Your schedule + mailboxes" },
  { id: "m_fast", x: 4, y: 1.3, n: "Swift slot", ic: "zap", k: "ai sm sub", own: 1, w: "Owner → AI (Swift)" },
  { id: "m_cat", x: 6, y: 1.3, n: "Offer weights", ic: "sliders-horizontal", k: "code sm sub", own: 1, w: "From Settings → Your business" },
  { id: "m_strong", x: 10, y: 1.3, n: "Talon / Swift", ic: "cpu", k: "ai sm sub", own: 1, w: "Owner → AI (Team / Kestrel)" },
  { id: "m_voice", x: 11, y: 1.3, n: "Your voice", ic: "audio-lines", k: "code sm sub", own: 1, w: "Voice profile" },
];

export const E: BrainEdgeDef[] = [
  ["new", "web"],
  ["new", "gmb"],
  ["new", "soc"],
  ["new", "yt"],
  ["new", "job"],
  ["web", "merge"],
  ["gmb", "merge"],
  ["soc", "merge"],
  ["yt", "merge"],
  ["job", "merge"],
  ["merge", "sig"],
  ["sig", "read"],
  ["read", "quote"],
  ["quote", "score"],
  ["score", "explain"],
  ["explain", "approve"],
  ["approve", "angle"],
  ["angle", "write"],
  ["write", "qc"],
  ["qc", "ready"],
  ["ready", "camp"],
  ["m_fast", "read", 1],
  ["m_cat", "score", 1],
  ["m_strong", "write", 1],
  ["m_voice", "qc", 1],
];

export const GRID: Record<string, [number, number]> = {
  new: [0, 0],
  web: [1, 0],
  gmb: [1, 0],
  soc: [1, 0],
  yt: [1, 0],
  job: [1, 0],
  merge: [2, 0],
  sig: [3, 0],
  read: [4, 0],
  quote: [5, 0],
  score: [0, 1],
  explain: [1, 1],
  approve: [2, 1],
  angle: [3, 1],
  write: [4, 1],
  qc: [5, 1],
  ready: [0, 2],
  camp: [1, 2],
};

export const PARENT: Record<string, string> = {
  m_fast: "read",
  m_cat: "score",
  m_strong: "write",
  m_voice: "qc",
};

export function nodeSize(n: BrainNodeDef): "sub" | "sm" | "n" {
  if (/(^| )sub( |$)/.test(n.k)) return "sub";
  if (/(^| )sm( |$)/.test(n.k)) return "sm";
  return "n";
}

export function isAiNode(n: BrainNodeDef): boolean {
  return /(^| )ai( |$)/.test(n.k);
}

export function defPos(n: BrainNodeDef): { x: number; y: number } {
  if (PARENT[n.id]) {
    const parentNode = N.find((x) => x.id === PARENT[n.id])!;
    const p = defPos(parentNode);
    return { x: p.x + W.n / 2 - W.sub / 2, y: p.y + H.n + 56 };
  }
  const g = GRID[n.id] ?? [0, 0];
  const s = nodeSize(n);
  const zoneShift = g[0] >= 3 && g[1] < 2 ? ZGAP : 0;
  const left = g[0] * COLX + zoneShift + (s === "sm" ? (W.n - W.sm) / 2 : 0);
  const cy = ROWY[g[1]] + (s === "sm" ? n.y * 68 : 0);
  return { x: left, y: cy - H[s] / 2 };
}

export function defaultPositions(): Record<string, { x: number; y: number }> {
  const out: Record<string, { x: number; y: number }> = {};
  for (const n of N) out[n.id] = defPos(n);
  return out;
}

/**
 * Exact edgeD() path generator from lead-brain.html v4.
 * When target is left of source (row-to-row wrap), routes with 22px rounded S-corners.
 */
export function edgePath(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  isSub = false
): string {
  if (isSub) {
    return `M${sourceX} ${sourceY} C${sourceX} ${sourceY + 36},${targetX} ${targetY - 36},${targetX} ${targetY}`;
  }
  if (targetX < sourceX + 30) {
    const my = targetY > sourceY + 120 ? targetY - 95 : (sourceY + targetY) / 2;
    const x1 = sourceX + 32;
    const x2 = targetX - 32;
    const dn = my > sourceY ? 1 : -1;
    const dn2 = targetY > my ? 1 : -1;
    const r = Math.max(2, Math.min(22, Math.abs(my - sourceY) / 2, Math.abs(targetY - my) / 2));
    return `M${sourceX} ${sourceY} H${x1 - r} Q${x1} ${sourceY} ${x1} ${sourceY + dn * r} V${my - dn * r} Q${x1} ${my} ${x1 - r} ${my} H${x2 + r} Q${x2} ${my} ${x2} ${my + dn2 * r} V${targetY - dn2 * r} Q${x2} ${targetY} ${x2 + r} ${targetY} H${targetX}`;
  }
  const dx = Math.max(50, Math.abs(targetX - sourceX) * 0.5);
  return `M${sourceX} ${sourceY} C${sourceX + dx} ${sourceY},${targetX - dx} ${targetY},${targetX} ${targetY}`;
}
