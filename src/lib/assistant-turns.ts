// Kestrel AI chat (the new chat page, first version).
// Pure logic only: the shape of one turn (thinking steps, the answer, the search
// receipts and the context the AI is holding) and the scripted turns used until
// the live streaming route is ready. No React, no server code here.

// One step of the visible thinking process.
export type Step = {
  id: string;
  label: string;        // what the AI is doing, in plain English
  detail?: string;      // the numbers it got back
  ms?: number;          // how long it took
  state?: "waiting" | "running" | "done";
};

// One search receipt: the AI says exactly what it searched and what it found.
export type Receipt = {
  id: string;
  kind: "leads" | "replies" | "campaigns" | "accounts" | "business" | "rules" | "sequence";
  query: string;        // what it searched for
  count: number;        // what it found
};

// What the AI is holding open right now (the context rail).
export type Rail = {
  title: string;
  rows: { label: string; value: string }[];
};

export type Turn = {
  steps: Step[];
  answer: string;       // markdown: paragraphs, "- " bullets, **bold**
  receipts: Receipt[];
  context: Rail;
};

const done = (ms: number) => ({ state: "done" as const, ms });

// The scripted turns used in the first version. Each one shows the thinking
// process, the search receipts and the context, so the shape of the real chat
// can be seen before the live route is built.
export function scriptedTurn(q: string): Turn {
  const t = q.toLowerCase();

  if (/campaign|doing|reply rate|performance/.test(t) && !/start|first/.test(t)) {
    return {
      steps: [
        { id: "s1", label: "Reading your campaigns", ...done(180) },
        { id: "s2", label: "Opening “Video agencies, London”", detail: "40 leads in this campaign", ...done(260) },
        { id: "s3", label: "Comparing replies, bounces and unsubscribes", detail: "3 replies · 1 bounce", ...done(310) },
      ],
      answer:
        "**Video agencies, London** is sending: 30 of 40 leads started, 3 replies (10%) and 1 bounce (3.3%).\n\n" +
        "A 10% reply rate is much better than the usual 1–2%. The first email gets most of the replies, so keep its subject.\n\n" +
        "One thing to watch: bounces are above 1%. Turn on **Verify each email before sending** in the campaign's Options.",
      receipts: [
        { id: "r1", kind: "campaigns", query: "all campaigns", count: 4 },
        { id: "r2", kind: "campaigns", query: "Video agencies, London", count: 30 },
      ],
      context: {
        title: "What I am looking at",
        rows: [
          { label: "Page", value: "Home" },
          { label: "Campaign", value: "Video agencies, London" },
          { label: "Emails sent", value: "416" },
          { label: "Replies waiting", value: "3" },
        ],
      },
    };
  }

  if (/repl|answer|unibox|inbox/.test(t)) {
    return {
      steps: [
        { id: "s1", label: "Reading your Replies", detail: "19 conversations in total", ...done(190) },
        { id: "s2", label: "Finding the ones with no answer yet", detail: "3 waiting", ...done(240) },
        { id: "s3", label: "Reading the newest 3 replies", detail: "Harbour Social asked for examples", ...done(290) },
      ],
      answer:
        "One reply needs an answer:\n\n" +
        "- **Harbour Social**: “Hi, yes we get busy around launches. Can you share examples?”\n\n" +
        "They are interested. Send 2–3 short examples and offer a 15-minute call. I have prepared the lead status — click Confirm to save it.",
      receipts: [
        { id: "r1", kind: "replies", query: "waiting for an answer", count: 3 },
        { id: "r2", kind: "replies", query: "read the newest", count: 3 },
      ],
      context: {
        title: "What I am looking at",
        rows: [
          { label: "Page", value: "Replies" },
          { label: "Waiting for you", value: "3" },
          { label: "Last reply", value: "15 min ago" },
          { label: "Lead status", value: "Interested" },
        ],
      },
    };
  }

  if (/account|warm|ready|domain|mailbox/.test(t)) {
    return {
      steps: [
        { id: "s1", label: "Checking your email accounts", detail: "2 accounts", ...done(170) },
        { id: "s2", label: "Reading today's send limits", detail: "18 of 25 sent today", ...done(220) },
        { id: "s3", label: "Checking domain health", detail: "DMARC record missing", ...done(300) },
      ],
      answer:
        "You have 2 email accounts:\n\n" +
        "- **alex@northlight-studio.test**: ready, 18 of 25 sent today, 0.8% bounces.\n" +
        "- **sam@northlight-mail.test**: ready, slow start (13 a day today, 2 more each day).\n\n" +
        "Your domain is missing a **DMARC** record. Add a TXT record at _dmarc with: v=DMARC1; p=none",
      receipts: [
        { id: "r1", kind: "accounts", query: "all email accounts", count: 2 },
        { id: "r2", kind: "accounts", query: "today's limits", count: 2 },
      ],
      context: {
        title: "What I am looking at",
        rows: [
          { label: "Page", value: "Email accounts" },
          { label: "Accounts", value: "2 (both ready)" },
          { label: "Sent today", value: "18 of 25" },
          { label: "Domain", value: "DMARC missing" },
        ],
      },
    };
  }

  if (/sequence|write|email for|score|judge/.test(t)) {
    return {
      steps: [
        { id: "s1", label: "Reading Your business", detail: "agency mode, 12 proof points", ...done(200) },
        { id: "s2", label: "Reading your offer", detail: "Video editing for agencies", ...done(230) },
        { id: "s3", label: "Searching your Good leads", detail: "4 leads without a written email", ...done(270) },
        { id: "s4", label: "Writing a first email and 3 follow-ups", detail: "one personal line for every lead", ...done(640) },
      ],
      answer:
        "I found **4 Good leads** that have an email but no written email yet.\n\n" +
        "For each one I wrote a first email and 3 follow-ups, using your business page and the offer “Video editing for agencies”. Every lead gets their own opening line, their own question and their own follow-up.\n\n" +
        "Nothing is sent. Read the emails and click **Confirm** when you are happy with them.",
      receipts: [
        { id: "r1", kind: "business", query: "your business page", count: 12 },
        { id: "r2", kind: "leads", query: "Good, has email, no email written", count: 4 },
        { id: "r3", kind: "sequence", query: "first email + 3 follow-ups", count: 4 },
      ],
      context: {
        title: "What I am looking at",
        rows: [
          { label: "Your business", value: "agency mode" },
          { label: "Offer", value: "Video editing for agencies" },
          { label: "Leads", value: "4 Good, no email yet" },
          { label: "Sequence", value: "first email + 3 follow-ups" },
        ],
      },
    };
  }

  return {
    steps: [
      { id: "s1", label: "Reading your business page", detail: "not set up yet", ...done(180) },
      { id: "s2", label: "Checking your email accounts", detail: "1 account", ...done(230) },
      { id: "s3", label: "Checking your first campaign", detail: "not started", ...done(260) },
    ],
    answer:
      "Here is how to start your first campaign:\n\n" +
      "1. **Your business**: say what you sell and who your ideal customer is.\n" +
      "2. **Email accounts**: add an inbox and send a test to yourself.\n" +
      "3. **Kestrel AI → Score and write**: score your leads, then write emails for the Good ones.\n" +
      "4. **Campaigns** → Add new: name it, pick the leads, the sequence and the schedule.\n" +
      "5. Send a test to yourself, then press **Start**.",
    receipts: [
      { id: "r1", kind: "business", query: "your business page", count: 0 },
      { id: "r2", kind: "accounts", query: "email accounts", count: 1 },
      { id: "r3", kind: "campaigns", query: "campaigns", count: 0 },
    ],
    context: {
      title: "What I am looking at",
      rows: [
        { label: "Page", value: "Home" },
        { label: "Your business", value: "not set up yet" },
        { label: "Email accounts", value: "1" },
        { label: "Campaigns", value: "none yet" },
      ],
    },
  };
}

// Short starter questions for the empty screen.
export const STARTERS: { q: string; hint: string }[] = [
  { q: "How are my campaigns doing?", hint: "Replies, bounces and what to fix" },
  { q: "Which replies need an answer?", hint: "From your Replies" },
  { q: "Are my email accounts ready to send?", hint: "Limits, bounces and domain health" },
  { q: "Write emails for my Good leads", hint: "First email and follow-ups" },
];
