// One CSV cell for every Kestrel export. Quotes when needed, and puts a ' in front of text that starts with
// = + - @ tab or CR, so Excel / Google Sheets show it as text instead of running it as a formula
// (lead names, sign-up details and reasons come from strangers).
export function csvCell(v: unknown): string {
  let t = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}
