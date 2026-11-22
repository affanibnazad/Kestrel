// The services a team can connect with its own key (Connections page). Shared by the page and the test route.
export type ServiceId = "anthropic" | "openai" | "gemini" | "openrouter" | "groq" | "nvidia" | "hunter" | "companiesHouse" | "listenNotes" | "apollo" | "findymail" | "hubspot" | "pipedrive";
export type Service = { logo: string; name: string; maker: string; kind: "ai" | "data" | "crm"; use: string; keyUrl: string; mark: string; tone: string; how: string; looks: string };

export const SERVICES: Record<ServiceId, Service> = {
  anthropic: { logo: "/logos/claude.png", name: "Claude", maker: "Anthropic", kind: "ai", use: "Scores leads and writes emails", keyUrl: "https://console.anthropic.com/settings/keys", mark: "C", tone: "#c96442",
    how: "Sign in at console.anthropic.com → API keys → Create key. Add credit under Billing first.", looks: "sk-ant-…" },
  openai: { logo: "/logos/chatgpt.png", name: "ChatGPT", maker: "OpenAI", kind: "ai", use: "Scores leads and writes emails", keyUrl: "https://platform.openai.com/api-keys", mark: "G", tone: "#10a37f",
    how: "Sign in at platform.openai.com → API keys → Create new secret key. Add credit under Billing.", looks: "sk-…" },
  gemini: { logo: "/logos/gemini.png", name: "Gemini", maker: "Google", kind: "ai", use: "Scores leads and writes emails", keyUrl: "https://aistudio.google.com/apikey", mark: "G", tone: "#4285f4",
    how: "Open aistudio.google.com/apikey → Create API key. A free tier is included.", looks: "AIza…" },
  openrouter: { logo: "/logos/openrouter.svg", name: "OpenRouter", maker: "Hundreds of models with one key", kind: "ai", use: "Scores leads and writes emails", keyUrl: "https://openrouter.ai/keys", mark: "R", tone: "#6467f2",
    how: "Sign in at openrouter.ai → Keys → Create key, then add credit.", looks: "sk-or-…" },
  groq: { logo: "", name: "Groq", maker: "Very fast open models (Llama, GPT-OSS, Qwen…)", kind: "ai", use: "Scores leads and writes emails", keyUrl: "https://console.groq.com/keys", mark: "Gq", tone: "#f55036",
    how: "Sign in at console.groq.com → API Keys → Create API Key. A free tier with rate limits is included.", looks: "gsk_…" },
  nvidia: { logo: "", name: "NVIDIA", maker: "Nemotron and other open models", kind: "ai", use: "Scores leads and writes emails", keyUrl: "https://build.nvidia.com/settings/api-keys", mark: "Nv", tone: "#76b900",
    how: "Sign in at build.nvidia.com → your account → API Keys → Generate API Key. Free credits are included to start.", looks: "nvapi-…" },
  hunter: { logo: "/logos/hunter.png", name: "Hunter", maker: "Hunter.io", kind: "data", use: "Finds and verifies email addresses", keyUrl: "https://hunter.io/api-keys", mark: "H", tone: "#e4562e",
    how: "Sign in at hunter.io → API → copy your API key. The free plan includes 25 searches a month.", looks: "40 letters and numbers" },
  companiesHouse: { logo: "/logos/companies-house.png", name: "Companies House", maker: "UK government", kind: "data", use: "UK companies and their directors", keyUrl: "https://developer.company-information.service.gov.uk/", mark: "CH", tone: "#1d70b8",
    how: "Register at developer.company-information.service.gov.uk → create an application → add a REST API key. Free.", looks: "a long code with dashes" },
  listenNotes: { logo: "/logos/listen-notes.png", name: "Listen Notes", maker: "Podcast search", kind: "data", use: "Finds podcasts and their hosts", keyUrl: "https://www.listennotes.com/api/", mark: "LN", tone: "#c11b47",
    how: "Sign up at listennotes.com/api → get your API key. The free plan has a monthly limit.", looks: "32 letters and numbers" },
  apollo: { logo: "", name: "Apollo", maker: "Apollo.io", kind: "data", use: "Finds work emails when Hunter finds none", keyUrl: "https://app.apollo.io/#/settings/integrations/api", mark: "A", tone: "#1f2a44",
    how: "Apollo → Settings → Integrations → API → create a key with People Enrichment. Each found email uses 1 Apollo credit.", looks: "letters and numbers" },
  findymail: { logo: "", name: "Findymail", maker: "Findymail", kind: "data", use: "Finds verified emails when Hunter and Apollo find none", keyUrl: "https://app.findymail.com/api-keys", mark: "F", tone: "#6c4cf5",
    how: "Findymail → API → create a key. A credit is used only when an email is found.", looks: "letters and numbers" },
  hubspot: { logo: "/logos/hubspot.svg", name: "HubSpot", maker: "CRM", kind: "crm", use: "Interested leads become contacts and deals", keyUrl: "https://app.hubspot.com/private-apps/", mark: "HS", tone: "#ff7a59",
    how: "HubSpot → Settings → Integrations → Private apps → Create. Scopes: crm.objects.contacts read and write, crm.objects.deals read and write. Copy the access token.", looks: "pat-…" },
  pipedrive: { logo: "", name: "Pipedrive", maker: "CRM", kind: "crm", use: "Interested leads become people, organisations and deals", keyUrl: "https://app.pipedrive.com/settings/api", mark: "P", tone: "#017737",
    how: "Pipedrive → your name → Personal preferences → API → copy your personal API token.", looks: "40 letters and numbers" },
};
export const AI_SERVICES: ServiceId[] = ["anthropic", "openai", "gemini", "openrouter", "groq", "nvidia"];
export const DATA_SERVICES: ServiceId[] = ["hunter", "apollo", "findymail", "companiesHouse", "listenNotes"];
export const CRM_SERVICES: ServiceId[] = ["hubspot", "pipedrive"];

export type TeamKey = { service: ServiceId; last4: string; updated_at: string; checked_at?: string | null; check_ok?: boolean | null; check_note?: string | null };
