// Reads a stream of JSON lines (one event per line), as the Kestrel AI chat streams its steps (Phase 3A).
// Lines may arrive split across chunks; blank or broken lines are skipped.
export async function readNdjson(body: ReadableStream<Uint8Array>, onEvent: (ev: Record<string, unknown>) => void) {
  const reader = body.getReader(), dec = new TextDecoder();
  let buf = "";
  const flush = (line: string) => {
    const t = line.trim();
    if (!t) return;
    try { const ev = JSON.parse(t); if (ev && typeof ev === "object") onEvent(ev as Record<string, unknown>); } catch { /* skip a broken line */ }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) { flush(buf.slice(0, nl)); buf = buf.slice(nl + 1); }
  }
  flush(buf + dec.decode());
}
