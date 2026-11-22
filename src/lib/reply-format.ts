// Replies → the answer box (design v2, the kit's "Mail - Inbox V.1" composer). The box is a live editor (reply-editor.ts)
// that shows formatting as you type; what it keeps and sends is these small marks, turned into formatting in the email:
//   **bold**   *italic*   ++underline++   [text](https://link)   lines starting "- " or "1. " become lists.
// Size and alignment apply to the whole answer. Everything is escaped first, so a reply can never carry other HTML.
// Pure functions (no server, no browser), shared by the App and /api/mail/reply.

export type ReplySize = "small" | "normal" | "large";
export type ReplyAlign = "left" | "center" | "right" | "justify";
export const REPLY_SIZES: ReplySize[] = ["small", "normal", "large"];
export const REPLY_ALIGNS: ReplyAlign[] = ["left", "center", "right", "justify"];
const PX: Record<ReplySize, number> = { small: 13, normal: 15, large: 18 };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const LINK = /\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]{1,500})\)/g;

// One line of text with inline marks → HTML (already escaped).
function inline(line: string) {
  let h = esc(line);
  h = h.replace(/\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]{1,500})\)/g, (_m, t: string, u: string) => `<a href="${u.replace(/&amp;/g, "&").replace(/"/g, "%22")}">${t}</a>`);
  h = h.replace(/\*\*([^*\n]+?)\*\*/g, "<b>$1</b>");
  h = h.replace(/\+\+([^+\n]+?)\+\+/g, "<u>$1</u>");
  h = h.replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, "$1<i>$2</i>");
  return h;
}

// The answer's lines as HTML blocks (escaped): used inside the email (replyHtml) and to show saved text formatted in the
// answer box's live editor (reply-editor.ts).
export function replyBodyHtml(text: string) {
  const lines = text.replace(/\r/g, "").split("\n");
  const out: string[] = [];
  let list: "ul" | "ol" | null = null;
  const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const raw of lines) {
    const ul = /^\s*[-•]\s+(.*)$/.exec(raw), ol = /^\s*\d{1,3}[.)]\s+(.*)$/.exec(raw);
    if (ul || ol) {
      const want = ul ? "ul" : "ol";
      if (list !== want) { close(); out.push(`<${want}>`); list = want; }
      out.push(`<li>${inline((ul ?? ol)![1])}</li>`);
      continue;
    }
    close();
    out.push(raw.trim() ? `<div>${inline(raw)}</div>` : "<div><br></div>");
  }
  close();
  return out.join("");
}

// The answer as HTML (for the email's HTML part).
export function replyHtml(text: string, o: { size?: ReplySize; align?: ReplyAlign } = {}) {
  const size = PX[o.size ?? "normal"] ?? 15, align = REPLY_ALIGNS.includes(o.align as ReplyAlign) ? o.align : "left";
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:${size}px;line-height:1.5;text-align:${align}">${replyBodyHtml(text)}</div>`;
}

// The same answer as plain text (the email's text part, and what Kestrel keeps): marks removed, links as "text (url)".
export function replyPlain(text: string) {
  return text.replace(/\r/g, "")
    .replace(LINK, (_m, t: string, u: string) => (t === u ? u : `${t} (${u})`))
    .replace(/\*\*([^*\n]+?)\*\*/g, "$1").replace(/\+\+([^+\n]+?)\+\+/g, "$1").replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, "$1$2");
}

// Cc / Bcc: a comma- or space-separated list → clean, unique, valid addresses (at most 5); bad ones are returned too.
export function parseEmails(s: string, max = 5) {
  const parts = String(s || "").split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
  const ok: string[] = [], bad: string[] = [];
  for (const p of parts) {
    if (/^[^@\s<>"']{1,64}@[a-z0-9.-]{1,200}\.[a-z]{2,24}$/.test(p)) { if (!ok.includes(p)) ok.push(p); } else bad.push(p);
  }
  return { ok: ok.slice(0, max), bad, tooMany: ok.length > max };
}

// Attachments: up to 3 files, 3 MB in all (the request must stay under the host's 4.5 MB limit), never programs.
export const ATTACH_MAX_FILES = 3, ATTACH_MAX_BYTES = 3 * 1024 * 1024;
const BLOCKED = /\.(exe|bat|cmd|com|scr|msi|js|jse|vbs|vbe|wsf|ps1|jar|app|dmg|pkg|sh|apk|iso|lnk|hta|cpl|reg)$/i;
export function attachmentProblem(files: { name: string; size: number }[]) {
  if (files.length > ATTACH_MAX_FILES) return `Attach at most ${ATTACH_MAX_FILES} files.`;
  if (files.some((f) => BLOCKED.test(f.name))) return "Programs and scripts can't be attached (they land in spam).";
  if (files.reduce((a, f) => a + f.size, 0) > ATTACH_MAX_BYTES) return "Attachments can be 3 MB in all. Share a link for bigger files.";
  return "";
}
export const safeFileName = (n: string) => String(n || "file").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 120) || "file";
