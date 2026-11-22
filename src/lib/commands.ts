// Kestrel AI "/" commands (Phase 3B, Affan 18 Nov 2026). Typing "/" in the chat shows this menu. A command is turned
// into a clear request for the AI (what the person typed after it is the detail); /help and /new run in the browser.

export type Command = { cmd: string; label: string; hint: string; arg?: string; local?: "help" | "new"; make?: (arg: string) => string };

export const COMMANDS: Command[] = [
  { cmd: "find", label: "Find leads", hint: "Search your leads, e.g. /find video agencies in Leeds", arg: "what to find",
    make: (a) => `Find leads in my workspace that match: ${a || "my best Good leads"}. Show the best ones and say why each fits.` },
  { cmd: "research", label: "Research a lead", hint: "What problem they likely have and how your offer solves it", arg: "lead name",
    make: (a) => `Research this lead and tell me what problem they likely have and how my offer solves it: ${a || "my newest Good lead"}. Use only what Kestrel knows about them.` },
  { cmd: "write", label: "Write emails", hint: "Personal emails from your offer and Your business page", arg: "who to write for",
    make: (a) => `Write personal emails for ${a || "my Good leads that have an email and no written email yet"}, using my offer and my Your business page. Prepare it for me to confirm.` },
  { cmd: "sequence", label: "Make a sequence", hint: "A first email and follow-ups in your tone", arg: "what it is for",
    make: (a) => `Create an email sequence for ${a || "my default offer"}: a first email and follow-ups, in my tone of voice. Prepare it for me to confirm.` },
  { cmd: "campaign", label: "Set up a campaign", hint: "Checks email accounts, sequence and leads first", arg: "which leads or offer",
    make: (a) => `Help me set up a campaign${a ? ` for ${a}` : ""}. First check my email accounts, sequence and leads, then prepare it for me to confirm.` },
  { cmd: "reply", label: "Answer replies", hint: "Replies that need an answer and what to do next",
    make: (a) => `Show the replies that need an answer${a ? ` (${a})` : ""} and what I should do next with each one.` },
  { cmd: "funnel", label: "Funnel report", hint: "Leads per stage, where they get stuck, next steps",
    make: () => "Give me my funnel report: how many leads are in each stage, where they get stuck, and the next 3 things I should do." },
  { cmd: "qc", label: "Quality check", hint: "Mistakes, spam words and missing details", arg: "what to check",
    make: (a) => `Check ${a || "my campaigns, sequences and written emails"} for mistakes, spam words and missing details, and tell me exactly what to fix.` },
  { cmd: "help", label: "All commands", hint: "Show what each command does", local: "help" },
  { cmd: "new", label: "New chat", hint: "Start a fresh conversation", local: "new" },
];

// The commands that match what is typed so far ("/wr" → write). Empty when the text is not a command start.
export function matchCommands(text: string): Command[] {
  const m = text.match(/^\/([a-z]*)$/i);
  if (!m) return [];
  const q = m[1].toLowerCase();
  return COMMANDS.filter((c) => c.cmd.startsWith(q));
}

// "/write Northlight Studio" → { command, request for the AI }. Not a command → null.
export function expandCommand(text: string): { command: Command; request: string | null } | null {
  const m = text.trim().match(/^\/([a-z]+)(?:\s+([\s\S]*))?$/i);
  if (!m) return null;
  const command = COMMANDS.find((c) => c.cmd === m[1].toLowerCase());
  if (!command) return null;
  return { command, request: command.make ? command.make((m[2] ?? "").trim().slice(0, 1000)) : null };
}

export const HELP_TEXT = COMMANDS.map((c) => `**/${c.cmd}${c.arg ? ` ${c.arg}` : ""}**: ${c.hint}`).join("\n- ");
