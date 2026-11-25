import { NextResponse } from "next/server";
import { currentUser, supabaseServer } from "@/lib/supabase/server";
import { serverSecret } from "@/lib/assistant-server";
import { presetBaseUrl, type AiSlotId } from "@/lib/ai-slots";

export const maxDuration = 20;

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const sb = await supabaseServer();
  const { data: admin } = await sb.rpc("is_admin");
  if (admin !== true) return NextResponse.json({ error: "Only Kestrel admins can load slot models." }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as {
    slot?: AiSlotId;
    provider?: string;
    baseUrl?: string;
    key?: string;
  };

  const provider = String(body.provider || "").trim().toLowerCase();
  if (!provider) return NextResponse.json({ error: "Choose a provider first." }, { status: 400 });

  let apiKey = String(body.key || "").trim();
  let baseUrl = body.baseUrl ? String(body.baseUrl).trim() : "";

  if (!apiKey && body.slot) {
    const secret = serverSecret();
    if (secret.length >= 32) {
      const { data: slotData } = await sb.rpc("ai_slot_for_server", {
        server_secret: secret,
        p_slot: body.slot,
      });
      const s = slotData as { key?: string | null; base_url?: string | null } | null;
      if (s?.key) apiKey = s.key;
      if (!baseUrl && s?.base_url) baseUrl = s.base_url;
    }
  }

  if (!apiKey) {
    return NextResponse.json({ error: "Paste an API key (or save one) before loading models." }, { status: 400 });
  }

  try {
    if (provider === "anthropic") {
      const res = await fetch("https://api.anthropic.com/v1/models?limit=100", {
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        signal: AbortSignal.timeout(12_000),
      });
      const json = (await res.json().catch(() => ({}))) as { data?: { id: string; display_name?: string }[]; error?: { message?: string } };
      if (!res.ok) {
        return NextResponse.json({ error: json?.error?.message || `Anthropic error (${res.status})` }, { status: 400 });
      }
      const models = (json.data || []).map((m) => ({
        id: m.id,
        label: m.display_name ? `${m.display_name} (${m.id})` : m.id,
      }));
      return NextResponse.json({ models });
    }

    if (provider === "gemini") {
      const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", {
        headers: { "x-goog-api-key": apiKey },
        signal: AbortSignal.timeout(12_000),
      });
      const json = (await res.json().catch(() => ({}))) as {
        models?: { name: string; displayName?: string; supportedGenerationMethods?: string[] }[];
        error?: { message?: string };
      };
      if (!res.ok) {
        return NextResponse.json({ error: json?.error?.message || `Gemini error (${res.status})` }, { status: 400 });
      }
      const models = (json.models || [])
        .filter((m) => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes("generateContent"))
        .map((m) => {
          const id = m.name.replace(/^models\//, "");
          return { id, label: m.displayName ? `${m.displayName} (${id})` : id };
        });
      return NextResponse.json({ models });
    }

    // OpenAI-compatible GET {base_url}/models
    const resolvedBase = presetBaseUrl(provider, baseUrl);
    if (!resolvedBase || !/^https?:\/\//i.test(resolvedBase)) {
      return NextResponse.json({ error: "Enter a valid base URL (https://...)." }, { status: 400 });
    }
    const res = await fetch(`${resolvedBase}/models`, {
      headers: {
        authorization: `Bearer ${apiKey}`,
        ...(provider === "openrouter" ? { "x-title": "Kestrel" } : {}),
      },
      signal: AbortSignal.timeout(12_000),
    });
    const json = (await res.json().catch(() => ({}))) as {
      data?: { id: string; name?: string }[];
      error?: { message?: string } | string;
    };
    if (!res.ok) {
      const msg = typeof json?.error === "string" ? json.error : json?.error?.message || `HTTP ${res.status}`;
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    const models = (json.data || [])
      .map((m) => ({ id: m.id, label: m.name && m.name !== m.id ? `${m.name} (${m.id})` : m.id }))
      .sort((a, b) => a.id.localeCompare(b.id));
    return NextResponse.json({ models });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load models." },
      { status: 502 }
    );
  }
}
