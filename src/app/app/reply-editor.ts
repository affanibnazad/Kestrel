// The Replies answer box's live editor (contentEditable): turns what the person sees back into the small marks that
// lib/reply-format.ts sends (**bold**, *italic*, ++underline++, [text](https://link), "- " and "1. " lists).
// Only those are kept; any other markup (from typing tricks or the browser) becomes plain text, so the editor can never
// carry HTML into an email. Pasting is plain text only (see reply-box.tsx).

const BLOCK = new Set(["DIV", "P", "H1", "H2", "H3", "H4", "BLOCKQUOTE", "PRE"]);

function inlineOf(n: Node): string {
  if (n.nodeType === Node.TEXT_NODE) return (n.textContent ?? "").replace(/ /g, " ");
  if (n.nodeType !== Node.ELEMENT_NODE) return "";
  const el = n as HTMLElement, tag = el.tagName;
  if (tag === "BR") return "\n";
  const inner = Array.from(el.childNodes).map(inlineOf).join("");
  if (!inner.trim()) return inner;
  const weight = el.style?.fontWeight, style = el.style?.fontStyle, deco = el.style?.textDecoration || el.style?.textDecorationLine;
  if (tag === "B" || tag === "STRONG" || weight === "bold" || Number(weight) >= 600) return `**${inner}**`;
  if (tag === "I" || tag === "EM" || style === "italic") return `*${inner}*`;
  if (tag === "U" || /underline/.test(deco ?? "")) return `++${inner}++`;
  if (tag === "A") { const href = el.getAttribute("href") ?? ""; return /^https?:\/\/\S+$/.test(href) ? `[${inner.replace(/[[\]]/g, "")}](${href})` : inner; }
  return inner;
}

function linesOf(n: Node): string[] {
  const out: string[] = [];
  let cur = "", open = false;
  const push = () => { out.push(cur); cur = ""; open = false; };
  for (const c of Array.from(n.childNodes)) {
    if (c.nodeType === Node.ELEMENT_NODE) {
      const el = c as HTMLElement, tag = el.tagName;
      if (tag === "BR") { push(); continue; }
      if (tag === "UL" || tag === "OL") {
        if (open) push();
        Array.from(el.children).forEach((li, i) => out.push(`${tag === "UL" ? "- " : `${i + 1}. `}${inlineOf(li).replace(/\n+/g, " ").trim()}`));
        continue;
      }
      if (BLOCK.has(tag)) {
        if (open) push();
        const inner = linesOf(el);
        out.push(...(inner.length ? inner : [""]));
        continue;
      }
    }
    cur += inlineOf(c); open = true;
  }
  if (open) out.push(...cur.split("\n"));
  return out;
}

export function editorToMarks(root: HTMLElement) {
  return linesOf(root).join("\n").replace(/\n{3,}/g, "\n\n").replace(/\s+$/, "");
}
