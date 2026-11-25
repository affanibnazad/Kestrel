import { NextResponse } from "next/server";
import { currentUser, supabaseServer } from "@/lib/supabase/server";
import { serverSecret } from "@/lib/assistant-server";
import { runAiTask } from "@/lib/ai-router";
import type { AiSlotId } from "@/lib/ai-slots";

export const maxDuration = 30;

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const sb = await supabaseServer();
  const { data: admin } = await sb.rpc("is_admin");
  if (admin !== true) return NextResponse.json({ error: "Only Kestrel admins can test AI slots." }, { status: 403 });

  const secret = serverSecret();
  if (secret.length < 32) {
    return NextResponse.json({ error: "MAIL_SERVER_SECRET is missing." }, { status: 503 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    slot?: AiSlotId;
    provider?: string;
    baseUrl?: string;
    model?: string;
    key?: string;
  };

  const slot = body.slot;
  if (slot !== "swift" && slot !== "talon" && slot !== "nest") {
    return NextResponse.json({ error: "Invalid slot." }, { status: 400 });
  }

  // Load saved slot config from Vault if any field is omitted
  const { data: savedSlot, error: slotErr } = await sb.rpc("ai_slot_for_server", {
    server_secret: secret,
    p_slot: slot,
  });
  if (slotErr) {
    return NextResponse.json({ ok: false, error: slotErr.message }, { status: 400 });
  }
  const s = (savedSlot ?? {}) as {
    provider?: string;
    base_url?: string | null;
    model?: string;
    key?: string | null;
  };

  const provider = (body.provider || s.provider || "").trim().toLowerCase();
  const baseUrl = body.baseUrl !== undefined ? body.baseUrl : s.base_url ?? null;
  const model = (body.model || s.model || "").trim();
  const key = (body.key || s.key || "").trim();

  if (!provider || !model || !key) {
    return NextResponse.json(
      { ok: false, error: "Provider, model, and API key are required before testing." },
      { status: 400 }
    );
  }

  // Need a teamId to log into ai_runs
  const { data: member } = await sb.from("members").select("team_id").eq("user_id", user.id).maybeSingle();
  const teamId = (member as { team_id?: string } | null)?.team_id;
  if (!teamId) {
    return NextResponse.json({ ok: false, error: "Admin has no team_id for logging." }, { status: 400 });
  }

  // One tiny real call through the router using the slot's resolution
  const task = slot === "talon" ? "chat" : slot === "swift" ? "reply_label" : "reply_label";
  const res = await runAiTask({
    sb,
    teamId,
    userId: user.id,
    task,
    system: "You are a health check. Reply with OK.",
    user: "OK",
    maxTokens: 20,
    timeoutMs: 15_000,
    deadlineMs: 20_000,
    resolution: {
      provider,
      baseUrl,
      model,
      key,
      source: "kestrel",
      slot,
      effort: "low",
    },
  });

  if (!res.ok) {
    return NextResponse.json({
      ok: false,
      error: res.lastError || res.error,
      statusCode: res.statusCode,
    });
  }

  return NextResponse.json({
    ok: true,
    ms: res.ms,
    model: res.model,
    provider: res.provider,
  });
}
