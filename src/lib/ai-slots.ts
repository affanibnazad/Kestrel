// Shared definitions for Kestrel's 3 AI slots (Swift, Talon, Nest) and provider presets.
// Safe to import in both client components and server code.

export type AiSlotId = "swift" | "talon" | "nest";

export const AI_SLOTS: {
  id: AiSlotId;
  name: string;
  role: string;
  description: string;
}[] = [
  {
    id: "swift",
    name: "Swift",
    role: "Fast",
    description: "Used for research, scoring, explain, voice, QC, reply labels, and spam fix.",
  },
  {
    id: "talon",
    name: "Talon",
    role: "Strong",
    description: "Used for Kestrel AI chat, writing emails, and reply suggestions.",
  },
  {
    id: "nest",
    name: "Nest",
    role: "Backup",
    description: "Automatic fallback when Swift or Talon fails, times out, or hits rate limits.",
  },
];

export type SlotProviderPreset = {
  id: string;
  label: string;
  kind: "anthropic" | "gemini" | "openai-compatible";
  baseUrl: string;
  placeholderModel: string;
};

export const SLOT_PROVIDERS: SlotProviderPreset[] = [
  { id: "anthropic", label: "Anthropic (Claude)", kind: "anthropic", baseUrl: "https://api.anthropic.com/v1", placeholderModel: "claude-sonnet-4-5" },
  { id: "gemini", label: "Google Gemini", kind: "gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta", placeholderModel: "gemini-2.5-flash" },
  { id: "openai", label: "OpenAI", kind: "openai-compatible", baseUrl: "https://api.openai.com/v1", placeholderModel: "gpt-4o-mini" },
  { id: "groq", label: "Groq", kind: "openai-compatible", baseUrl: "https://api.groq.com/openai/v1", placeholderModel: "openai/gpt-oss-120b" },
  { id: "nvidia", label: "NVIDIA", kind: "openai-compatible", baseUrl: "https://integrate.api.nvidia.com/v1", placeholderModel: "nvidia/nemotron-3-super-120b-a12b" },
  { id: "openrouter", label: "OpenRouter", kind: "openai-compatible", baseUrl: "https://openrouter.ai/api/v1", placeholderModel: "openai/gpt-4o-mini" },
  { id: "together", label: "Together", kind: "openai-compatible", baseUrl: "https://api.together.xyz/v1", placeholderModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo" },
  { id: "mistral", label: "Mistral", kind: "openai-compatible", baseUrl: "https://api.mistral.ai/v1", placeholderModel: "mistral-small-latest" },
  { id: "deepseek", label: "DeepSeek", kind: "openai-compatible", baseUrl: "https://api.deepseek.com/v1", placeholderModel: "deepseek-chat" },
  { id: "xai", label: "xAI", kind: "openai-compatible", baseUrl: "https://api.x.ai/v1", placeholderModel: "grok-3-mini" },
  { id: "fireworks", label: "Fireworks", kind: "openai-compatible", baseUrl: "https://api.fireworks.ai/inference/v1", placeholderModel: "accounts/fireworks/models/llama-v3p3-70b-instruct" },
  { id: "cerebras", label: "Cerebras", kind: "openai-compatible", baseUrl: "https://api.cerebras.ai/v1", placeholderModel: "llama-3.3-70b" },
  { id: "custom", label: "Custom (OpenAI-compatible)", kind: "openai-compatible", baseUrl: "", placeholderModel: "model-name" },
];

export const SLOT_BASE_URLS: Record<string, string> = Object.fromEntries(
  SLOT_PROVIDERS.filter((p) => p.baseUrl).map((p) => [p.id, p.baseUrl])
);

export function presetBaseUrl(provider: string, customBaseUrl?: string | null): string {
  const trimmed = (customBaseUrl || "").trim().replace(/\/+$/, "");
  if (provider === "custom") return trimmed;
  return SLOT_BASE_URLS[provider] || trimmed || "https://api.openai.com/v1";
}
