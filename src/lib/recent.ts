// The sidebar's "Recent" list (T0.9, 21 Nov 2026): the last few campaigns and lists that were opened.
// Kept in this browser only. Nothing here talks to the server.
export type RecentItem = { label: string; view: string; target?: string; at: number };
const KEY = "kestrel-recent";
const MAX = 5;

export function readRecent(): RecentItem[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "[]") as RecentItem[];
    if (!Array.isArray(raw)) return [];
    return raw.filter((r) => r && typeof r.label === "string" && typeof r.view === "string").slice(0, MAX);
  } catch { return []; }
}

export function noteRecent(label: string, view: string, target?: string) {
  if (!label || !view) return;
  try {
    const list = readRecent().filter((r) => !(r.view === view && r.label === label && (r.target ?? "") === (target ?? "")));
    list.unshift({ label: label.slice(0, 80), view, target, at: Date.now() });
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch { /* private window: the list just stays as it was */ }
}
