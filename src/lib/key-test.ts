import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { SERVICES, type ServiceId } from "./connections";

// Tests one key with a free, read-only call to its company (list models, account info or one tiny search; NVIDIA: a
// 1-token answer, as its model list does not check the key). For AI
// keys it also returns the models the key can use. Used by Connections (team keys) and Owner → Assistant (Kestrel's keys).
export type KeyTestResult = { ok: boolean; note: string; models?: { id: string; label: string }[] };

async function get(url: string, headers: Record<string, string> = {}) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(12_000), redirect: "error" });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}
const failNote = (status: number, name: string) =>
  status === 401 || status === 403 ? `${name} did not accept this key. Check it was copied fully, or make a new one.`
  : status === 429 ? `${name} says the limit or credit is used up.` : `${name} answered with an error (${status}). Try again later.`;

export async function testKey(service: ServiceId, key: string): Promise<KeyTestResult> {
  const name = SERVICES[service].name;
  switch (service) {
    case "anthropic": {
      try {
        const client = new Anthropic({ apiKey: key, maxRetries: 1, timeout: 12_000 });
        const models: { id: string; label: string }[] = [];
        for await (const m of client.models.list({ limit: 100 })) models.push({ id: m.id, label: m.display_name || m.id });
        return { ok: true, note: `Working. ${models.length} Claude models available.`, models };
      } catch (e) {
        if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return { ok: false, note: failNote(401, name) };
        if (e instanceof Anthropic.RateLimitError) return { ok: false, note: failNote(429, name) };
        if (e instanceof Anthropic.APIError) return { ok: false, note: failNote(e.status ?? 500, name) };
        return { ok: false, note: `Could not reach ${name}. Try again.` };
      }
    }
    case "openai": {
      const r = await get("https://api.openai.com/v1/models", { authorization: `Bearer ${key}` });
      if (r.status !== 200) return { ok: false, note: failNote(r.status, name) };
      const ids = ((r.body?.data ?? []) as { id: string }[]).map((m) => m.id)
        .filter((id) => /^(gpt-|o\d|chatgpt-)/.test(id) && !/(audio|realtime|transcribe|tts|image|embedding|search|moderation|instruct)/.test(id)).sort().reverse();
      return { ok: true, note: `Working. ${ids.length} chat models available.`, models: ids.slice(0, 80).map((id) => ({ id, label: id })) };
    }
    case "gemini": {
      const r = await get("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { "x-goog-api-key": key });
      if (r.status !== 200) return { ok: false, note: failNote(r.status === 400 ? 401 : r.status, name) };
      const ms = ((r.body?.models ?? []) as { name: string; displayName?: string; supportedGenerationMethods?: string[] }[])
        .filter((m) => m.supportedGenerationMethods?.includes("generateContent") && /gemini/i.test(m.name) && !/(embedding|image|tts|audio|live)/i.test(m.name));
      return { ok: true, note: `Working. ${ms.length} Gemini models available.`, models: ms.slice(0, 80).map((m) => ({ id: m.name.replace(/^models\//, ""), label: m.displayName || m.name })) };
    }
    case "openrouter": {
      const k = await get("https://openrouter.ai/api/v1/key", { authorization: `Bearer ${key}` });
      if (k.status !== 200) return { ok: false, note: failNote(k.status, name) };
      const left = k.body?.data?.limit_remaining;
      const m = await get("https://openrouter.ai/api/v1/models");
      const ms = ((m.body?.data ?? []) as { id: string; name?: string }[]).slice(0, 300).map((x) => ({ id: x.id, label: x.name || x.id }));
      return { ok: true, note: `Working.${typeof left === "number" ? ` $${left.toFixed(2)} credit left.` : ""} ${ms.length} models available.`, models: ms };
    }
    case "groq": {
      const r = await get("https://api.groq.com/openai/v1/models", { authorization: `Bearer ${key}` });
      if (r.status !== 200) return { ok: false, note: failNote(r.status, name) };
      const ids = ((r.body?.data ?? []) as { id: string; active?: boolean }[]).filter((m) => m.active !== false).map((m) => m.id)
        .filter((id) => !/(whisper|tts|guard|playai|distil|embed)/i.test(id)).sort();
      return { ok: true, note: `Working. ${ids.length} chat models available.`, models: ids.slice(0, 80).map((id) => ({ id, label: id })) };
    }
    case "nvidia": {
      // The model list is public (it does not check the key), so the key is checked with a 1-token answer.
      const m = await get("https://integrate.api.nvidia.com/v1/models", { authorization: `Bearer ${key}` });
      const ids = ((m.body?.data ?? []) as { id: string }[]).map((x) => x.id)
        .filter((id) => !/(embed|rerank|guard|safety|reward|parse|ocr|retriev|clip|tts|asr|whisper|riva|vista|flux|stable|cosmos)/i.test(id)).sort();
      // Try the models Kestrel suggests first (retired ones are skipped: NVIDIA answers 404 / 410 for them).
      const probes = ["nvidia/nemotron-3.5-super-vl-120b-a12b", "nvidia/nemotron-3-super-120b-a12b", "nvidia/nemotron-3.5-lightning-30b-a3b"].filter((id) => ids.includes(id));
      if (!probes.length && ids[0]) probes.push(ids[0]);
      if (!probes.length) return { ok: false, note: failNote(m.status === 200 ? 404 : m.status, name) };
      let last = "";
      for (const probe of probes.slice(0, 3)) {
        const r = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", { method: "POST", signal: AbortSignal.timeout(20_000),
          headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
          body: JSON.stringify({ model: probe, messages: [{ role: "user", content: "Say OK" }], max_tokens: 1, reasoning_effort: "none" }) });
        if (r.ok || r.status === 202) return { ok: true, note: `Working (${probe.replace(/^nvidia\//, "")}). ${ids.length} chat models available.`, models: ids.slice(0, 120).map((id) => ({ id, label: id })) };
        const d = await r.json().catch(() => ({}));
        const said = String(d?.detail || d?.error?.message || d?.title || "").replace(/\s+/g, " ").slice(0, 90);
        last = `${r.status}${said ? `: ${said}` : ""}`;
        if (r.status === 401) break;   // the key itself is wrong; other models will say the same
      }
      return { ok: false, note: /^40[13]/.test(last) ? `${name} refused this key (${last}). Make a key at build.nvidia.com → API Keys (starts with nvapi-).` : `${name} answered ${last}. Try again in a minute.` };
    }
    case "hunter": {
      const r = await get(`https://api.hunter.io/v2/account?api_key=${encodeURIComponent(key)}`);
      if (r.status !== 200) return { ok: false, note: failNote(r.status, name) };
      const s = r.body?.data?.requests?.searches, v = r.body?.data?.requests?.verifications;
      const n = (x: { used?: number; available?: number } | undefined) => (x && typeof x.available === "number" ? `${Math.max(0, x.available - (x.used ?? 0)).toLocaleString()} left` : "");
      return { ok: true, note: `Working. Searches: ${n(s) || "unknown"}. Verifications: ${n(v) || "unknown"}.` };
    }
    case "companiesHouse": {
      const r = await get("https://api.company-information.service.gov.uk/search/companies?q=kestrel&items_per_page=1", { authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}` });
      return r.status === 200 ? { ok: true, note: "Working." } : { ok: false, note: failNote(r.status, name) };
    }
    case "listenNotes": {
      const r = await get("https://listen-api.listennotes.com/api/v2/search?q=marketing&type=podcast&page_size=1", { "X-ListenAPI-Key": key });
      return r.status === 200 ? { ok: true, note: "Working." } : { ok: false, note: failNote(r.status, name) };
    }
    case "apollo": {
      const r = await get("https://api.apollo.io/api/v1/auth/health", { "x-api-key": key });
      return r.status === 200 && (r.body as { is_logged_in?: boolean })?.is_logged_in !== false ? { ok: true, note: "Working." } : { ok: false, note: failNote(r.status === 200 ? 401 : r.status, name) };
    }
    case "findymail": {
      const r = await get("https://app.findymail.com/api/credits", { authorization: `Bearer ${key}` });
      if (r.status !== 200) return { ok: false, note: failNote(r.status, name) };
      const c = (r.body as { credits?: number; finder_credits?: number })?.finder_credits ?? (r.body as { credits?: number })?.credits;
      return { ok: true, note: typeof c === "number" ? `Working. ${c.toLocaleString()} credits left.` : "Working." };
    }
    case "hubspot": {
      const r = await get("https://api.hubapi.com/crm/v3/objects/contacts?limit=1", { authorization: `Bearer ${key}` });
      return r.status === 200 ? { ok: true, note: "Working. Contacts can be read." } : { ok: false, note: r.status === 403 ? "HubSpot accepted the token but it lacks the contacts and deals scopes." : failNote(r.status, name) };
    }
    case "pipedrive": {
      const r = await get("https://api.pipedrive.com/api/v1/users/me", { "x-api-token": key });
      const d = (r.body as { data?: { company_name?: string } })?.data;
      return r.status === 200 ? { ok: true, note: `Working${d?.company_name ? ` (${d.company_name})` : ""}.` } : { ok: false, note: failNote(r.status, name) };
    }
  }
  return { ok: false, note: "Unknown service." };
}

