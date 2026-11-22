import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { currentUser, supabaseServer } from "@/lib/supabase/server";
import { serverSecret } from "@/lib/assistant-server";
import { AUTO, AUTO_ASSISTANT_MODELS } from "@/lib/ai-models";
import { testKey } from "@/lib/key-test";

// Owner panel → Assistant → Test: checks Kestrel's Claude key with a free call (list models) and that the chosen
// model is available to it. Kestrel admins only; the key stays on the server.
export const maxDuration = 30;

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const sb = await supabaseServer();
  const { data: admin } = await sb.rpc("is_admin");
  if (admin !== true) return NextResponse.json({ error: "Only Kestrel admins can test Kestrel AI's key." }, { status: 403 });
  const secret = serverSecret();
  if (secret.length < 32) return NextResponse.json({ error: "The server secret is missing on Vercel (MAIL_SERVER_SECRET)." }, { status: 503 });
  // Kestrel's ChatGPT, Gemini, OpenRouter, Groq or NVIDIA key (database 034, Groq 047, NVIDIA 056): a free read-only test, the result kept, the models returned.
  const body = await req.json().catch(() => ({})) as { provider?: string };
  if (body.provider === "openai" || body.provider === "gemini" || body.provider === "openrouter" || body.provider === "groq" || body.provider === "nvidia") {
    const provider = body.provider;
    const { data: key, error: keyErr } = await sb.rpc("assistant_kestrel_key", { server_secret: secret, provider });
    if (keyErr) return NextResponse.json({ error: /assistant_kestrel_key|schema cache/i.test(keyErr.message) ? "Testing these keys needs database 034." : "Could not read the key." }, { status: 400 });
    if (!key) return NextResponse.json({ error: "Add the key first." }, { status: 400 });
    let r: { ok: boolean; note: string; models?: { id: string; label: string }[] };
    try { r = await testKey(provider, String(key)); } catch { r = { ok: false, note: "Could not reach the AI company. Try again." }; }
    const note = String(r.note).replace(/\s+/g, " ").slice(0, 160);
    await sb.rpc("record_kestrel_key_check", { provider, ok: r.ok, note });
    return NextResponse.json({ ok: r.ok, note, models: r.models ?? [] });
  }
  const { data, error } = await sb.rpc("assistant_config", { server_secret: secret });
  if (error) return NextResponse.json({ error: "Kestrel AI settings are not set up yet (database 023)." }, { status: 400 });
  const c = data as { key: string | null; model: string };
  if (!c.key) return NextResponse.json({ error: "Add the Claude key first." }, { status: 400 });

  let ok = false, note = "";
  try {
    const client = new Anthropic({ apiKey: c.key, maxRetries: 1, timeout: 12_000 });
    const ids: string[] = [];
    for await (const m of client.models.list({ limit: 100 })) ids.push(m.id);
    // Auto uses Sonnet and Opus, so both must be available.
    const need = c.model === AUTO ? AUTO_ASSISTANT_MODELS : [c.model], lacking = need.filter((m) => !ids.includes(m));
    ok = lacking.length === 0;
    note = ok ? `Working. ${c.model === AUTO ? "Auto (Sonnet 5.5 and Opus 5.5)" : c.model} is available.` : `The key works, but ${lacking.join(" and ")} is not available to it. Choose another model.`;
  } catch (e) {
    note = e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError ? "Claude did not accept this key. Copy it again, or make a new one."
      : e instanceof Anthropic.RateLimitError ? "Claude says the limit or credit is used up. Add credit under Billing."
      : e instanceof Anthropic.APIError ? `Claude answered with an error (${e.status ?? "?"}). Try again later.` : "Could not reach Claude. Try again.";
  }
  await sb.rpc("record_assistant_check", { ok, note });
  return NextResponse.json({ ok, note });
}
