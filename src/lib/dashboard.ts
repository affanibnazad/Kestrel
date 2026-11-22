// Home dashboard numbers (redesign: the kit's "Dashboard #1"): counts for the chosen period, the change against the period
// before it, and day-by-day series for the charts. Pure functions (no database), so they are tested on their own.
// Days are calendar days in UTC, the same days the database's mail_daily uses.

export type Range = 7 | 30 | 90;
export const RANGES: { id: Range; label: string }[] = [{ id: 7, label: "Last 7 days" }, { id: 30, label: "Last 30 days" }, { id: 90, label: "Last 90 days" }];
export type MailDay = { day: string; first_sent: number; follow_ups: number; replies: number; bounces?: number; unsubscribes?: number; opened?: number };
export type Change = { value: number; previous: number; pct: number | null; up: boolean };

const DAY = 864e5;
const key = (t: number) => new Date(t).toISOString().slice(0, 10);
const startOfUtcDay = (t: number) => Math.floor(t / DAY) * DAY;

// The day keys of the current period, oldest first (today is the last one).
export function dayKeys(range: Range, now = Date.now()): string[] {
  const today = startOfUtcDay(now);
  return Array.from({ length: range }, (_, i) => key(today - (range - 1 - i) * DAY));
}
// The day keys of the period just before it (for the % change).
export function previousKeys(range: Range, now = Date.now()): string[] {
  return dayKeys(range, now - range * DAY);
}

// This period against the one before. pct is null when there is nothing to compare with (previous = 0).
export function change(value: number, previous: number): Change {
  return { value, previous, pct: previous > 0 ? Math.round(((value - previous) / previous) * 1000) / 10 : null, up: value >= previous };
}
export const pctLabel = (c: Change) => (c.pct === null ? (c.value > 0 ? "New" : "—") : `${c.pct > 0 ? "+" : ""}${c.pct}%`);

// Count dates (ISO strings) per day of the period, plus this period vs. the one before.
export function countByDay(dates: (string | null | undefined)[], range: Range, now = Date.now()) {
  const days = dayKeys(range, now), prev = new Set(previousKeys(range, now)), at = new Map(days.map((d, i) => [d, i]));
  const counts = new Array(range).fill(0);
  let previous = 0;
  for (const s of dates) {
    if (!s) continue;
    const d = s.slice(0, 10);
    const i = at.get(d);
    if (i !== undefined) counts[i]++;
    else if (prev.has(d)) previous++;
  }
  return { days, counts, total: change(counts.reduce((a, b) => a + b, 0), previous) };
}

// Emails sent (first + follow-ups) and replies per day from mail_daily(range * 2), plus the change against the period before.
export function mailByDay(rows: MailDay[], range: Range, now = Date.now()) {
  const days = dayKeys(range, now), prev = new Set(previousKeys(range, now)), at = new Map(days.map((d, i) => [d, i]));
  const sent = new Array(range).fill(0), replies = new Array(range).fill(0);
  let prevSent = 0, prevReplies = 0;
  for (const r of rows ?? []) {
    const s = (Number(r.first_sent) || 0) + (Number(r.follow_ups) || 0), rep = Number(r.replies) || 0;
    const i = at.get(r.day);
    if (i !== undefined) { sent[i] += s; replies[i] += rep; }
    else if (prev.has(r.day)) { prevSent += s; prevReplies += rep; }
  }
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  return { days, sent, replies, totalSent: change(sum(sent), prevSent), totalReplies: change(sum(replies), prevReplies),
    replyRate: sum(sent) ? Math.round((sum(replies) / sum(sent)) * 1000) / 10 : 0 };
}

// Short labels for chart axes: weekday for 7 days, day of month otherwise.
export function dayLabel(day: string, range: Range) {
  const d = new Date(`${day}T12:00:00Z`);
  return range === 7 ? d.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" }) : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

// A tidy top value for a chart's axis (1, 2, 5 × 10ⁿ steps) and its tick marks.
export function niceMax(max: number, ticks = 4) {
  if (max <= 0) return { top: ticks, step: 1 };
  const raw = max / ticks, pow = 10 ** Math.floor(Math.log10(raw)), f = raw / pow;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
  return { top: step * ticks, step };
}
