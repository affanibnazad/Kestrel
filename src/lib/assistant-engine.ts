import "server-only";
import { runAiTask } from "./ai-router";
import type { supabaseServer } from "./supabase/server";
import type { Provider } from "./ai";

type Sb = Awaited<ReturnType<typeof supabaseServer>>;

export type ChatMsg = { role: "user" | "assistant"; content: string };
export type NeutralTool = { name: string; description: string; schema: Record<string, unknown> };

export type EngineInput = {
  provider: Provider;
  key: string;
  model: string;
  effort?: "low" | "medium" | "high";
  system: string;
  history: ChatMsg[];
  tools: NeutralTool[];
  runTool: (name: string, input: Record<string, unknown>) => Promise<string>;
  maxRounds: number;
  images?: { type: string; data: string }[];
  sb?: Sb;
  teamId?: string;
  userId?: string | null;
};

export type EngineResult = { text: string; refused?: boolean; outOfRounds?: boolean };
export class EngineError extends Error {
  constructor(message: string, public kind: "key" | "rate" | "model" | "network" | "other") {
    super(message);
  }
}

export async function runAssistant(x: EngineInput): Promise<EngineResult> {
  const lastUserMsg = [...(x.history || [])].reverse().find((m) => m.role === "user")?.content || "";

  if (x.sb && x.teamId) {
    const res = await runAiTask({
      sb: x.sb,
      teamId: x.teamId,
      userId: x.userId,
      task: "chat",
      system: x.system,
      user: lastUserMsg,
      history: x.history,
      tools: x.tools,
      runTool: x.runTool,
      images: x.images,
      maxTokens: 4000,
      effort: x.effort,
    });

    if (!res.ok) {
      if (res.status === "skipped") return { text: "", refused: true };
      throw new EngineError(res.error, "other");
    }

    return { text: res.text };
  }

  throw new EngineError("Database connection not provided.", "other");
}
