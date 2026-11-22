// Kestrel Assistant: the shared pieces the chat page and the server both use (pages it can open, actions it can
// propose, and the action labels). The model's own instructions and tools live in the server route.

// App pages Kestrel AI can open for the person (view ids from the App's left bar).
export const ASSISTANT_PAGES: Record<string, string> = {
  home: "Home", autopilot: "Autopilot", all: "All Leads", campaigns: "Campaigns", inbox: "Replies", analytics: "Analytics", mailboxes: "Email accounts",
  sequences: "Sequences", ai: "Kestrel AI", about: "Your business", rules: "Rules", pipeline: "Pipeline", dnc: "Do-not-contact", plan: "Plan and billing",
  team: "Team", connections: "Integrations → Services", import: "Import and examples", get: "Integrations → Extension", progress: "Search progress", profile: "Your profile",
};

// Changes Kestrel AI may suggest. Nothing changes until the person clicks Confirm in the chat; the App then runs it
// with that person's own permissions (the same buttons they could press themselves).
export type ActionKind = "pause_campaign" | "resume_campaign" | "stop_campaign" | "set_lead_status" | "mark_reply_done" | "add_do_not_contact" | "remember_fact" | "forget_fact"
  | "remove_do_not_contact" | "set_lead_fit" | "set_lead_keep" | "find_emails" | "score_leads" | "write_emails" | "create_sequence" | "update_sequence" | "create_campaign" | "update_offer"
  | "set_lead_result" | "add_rule" | "update_business" | "add_to_campaign"
  | "import_csv";   // made by the chat itself when a CSV is dropped (Phase 3D), never by the AI
// The kinds the model may ask for with propose_change. Memory cards come only from the remember and forget tools.
export const ACTION_KINDS: ActionKind[] = ["pause_campaign", "resume_campaign", "stop_campaign", "set_lead_status", "mark_reply_done", "add_do_not_contact",
  "remove_do_not_contact", "set_lead_fit", "set_lead_keep", "find_emails", "score_leads", "write_emails", "create_sequence", "update_sequence", "create_campaign", "update_offer",
  "set_lead_result", "add_rule", "update_business", "add_to_campaign"];
export type OfferPatch = { offer?: string; customer?: string; good?: string; bad?: string; one_line?: string };
export type ProposedAction = { id: string; kind: ActionKind; summary: string; campaign_id?: string; conversation_id?: string; stage?: string | null; entry?: string; fact?: string; fact_id?: string;
  lead_ids?: string[]; verdict?: "Good" | "Maybe" | "No"; keep?: "kept" | "removed" | "new"; offer_id?: string; sequence?: string; name?: string; offer_patch?: OfferPatch;
  // Phase 3C
  result?: "meeting" | "won" | "lost" | null; deal_value?: number; reason?: string | null;
  rule?: { field: string; op: string; value?: string; action: "reject" | "good" | "no" | "boost" | "penalty"; amount?: number };
  business_patch?: { about?: string; tone?: string; avoid?: string; website?: string };
  steps?: { day: number; subject: string; body: string }[];   // create_sequence written by the AI (19 Nov 2026)
};
// Changes that cost money or credits, or are hard to undo: a second click to confirm.
export const DOUBLE_CHECK: ActionKind[] = ["stop_campaign", "add_do_not_contact", "remove_do_not_contact", "find_emails", "score_leads", "write_emails", "add_to_campaign"];
export const ACTION_LABELS: Record<ActionKind, string> = {
  pause_campaign: "Pause campaign", resume_campaign: "Resume campaign", stop_campaign: "Stop campaign for good",
  set_lead_status: "Set lead status", mark_reply_done: "Mark reply as done", add_do_not_contact: "Add to Do-not-contact",
  remember_fact: "Remember this", forget_fact: "Forget this",
  remove_do_not_contact: "Take off Do-not-contact", set_lead_fit: "Set AI fit", set_lead_keep: "Keep or remove leads", find_emails: "Find emails (Hunter)",
  score_leads: "Score leads with AI", write_emails: "Write emails with AI", create_sequence: "Create a sequence", update_sequence: "Change a sequence", create_campaign: "Create a campaign", update_offer: "Update your offer",
  set_lead_result: "Meeting, Won or Lost", add_rule: "Add a lead rule", update_business: "Update Your business", add_to_campaign: "Add leads to a campaign",
  import_csv: "Import leads",
};
export const LEAD_STAGES = ["interested", "meeting", "not_now", "not_interested", "wrong_person", "won", "lost"] as const;

// What the server sends back for one turn.
export type AssistantTurn = {
  messages: unknown[];          // new messages to append to the history, exactly as the API returned them
  text: string;                 // the final answer, for display
  activity: string[];           // what it looked at ("Looked at your campaigns")
  actions: ProposedAction[];    // changes waiting for the person's Confirm
  navigate?: string | null;     // a page to open
  usage?: { used: number; limit: number } | null;
  ai?: string;                  // which AI answered ("Claude (included)", "ChatGPT (your team's key)")
};

// Light markdown for answers: paragraphs, bullet lists, **bold**. Returns plain blocks (no HTML injection).
export type Block = { type: "p"; text: string } | { type: "ul"; items: string[] } | { type: "ol"; items: string[] };
export function toBlocks(md: string): Block[] {
  const out: Block[] = [];
  for (const chunk of String(md || "").replace(/\r/g, "").split(/\n{2,}/)) {
    const lines = chunk.split("\n").map((l) => l.trimEnd()).filter((l) => l.trim());
    if (!lines.length) continue;
    if (lines.every((l) => /^\s*[-*•]\s+/.test(l))) out.push({ type: "ul", items: lines.map((l) => l.replace(/^\s*[-*•]\s+/, "")) });
    else if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) out.push({ type: "ol", items: lines.map((l) => l.replace(/^\s*\d+[.)]\s+/, "")) });
    else out.push({ type: "p", text: lines.join("\n").replace(/^#{1,6}\s+/gm, "") });
  }
  return out;
}
