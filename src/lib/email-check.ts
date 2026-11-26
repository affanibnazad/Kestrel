// Contact emails that should not get cold email, found before a campaign (UX audit rows 9, 52). Pure, shared by the App's
// Leads table, lead panel and campaign checklist.
//   bad  = left out of campaigns unless the user includes them: jobs/HR inboxes, legal/abuse/no-reply, placeholders
//          (you@brand.com), typos (nfo@), file names scraped as emails (logo@2x.png).
//   warn = shown, still sent: an address on another company's domain, press/media and franchise help desks.
import { hostOf } from "./hunter";

export type EmailIssue = { level: "bad" | "warn"; reason: string };

const FREE = new Set(["gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "hotmail.com", "outlook.com", "live.com", "msn.com", "icloud.com", "me.com",
  "aol.com", "proton.me", "protonmail.com", "gmx.com", "mail.com", "zoho.com", "yahoo.co.uk", "hotmail.co.uk", "btinternet.com"]);
const JOBS = /^(careers?|jobs?|hr|humanresources|human\.resources|recruit(ing|ment|er)?|resumes?|cv|hiring|talent|apply|applications?|join(us)?|work(withus)?)$/;
const NOT_PEOPLE = /^(privacy|legal|abuse|postmaster|webmaster|hostmaster|no-?reply|do-?not-?reply|donotreply|mailer-daemon|bounce[s]?|unsubscribe|dpo|gdpr|compliance|fcc-?public-?file|public-?file|security|noc|dmca|copyright)$/;
const SOFT = /^(press|media|media-?inquir(y|ies)|pr|investors?|ir|reservations?|franchis(e|ing)|helpdesk|help-?desk|accounting|accounts-?payable|ap|billing|invoices?|payroll|purchasing|procurement)$/;
const PLACEHOLDER_LOCAL = /^(you|your|yourname|your\.name|name|email|user|username|example|test|firstname|first\.last|firstname\.lastname|john\.doe|jane\.doe|someone|me)$/;
const PLACEHOLDER_DOMAIN = /(^|\.)(example\.(com|org|net)|domain\.com|yourdomain\.[a-z]+|brand\.com|company\.com|website\.com|email\.com|sentry\.io|wixpress\.com|sentry-next\.wixpress\.com|godaddy\.com|test\.com)$/;
const TYPO_LOCAL = /^(nfo|inf|inof|ifno|imfo|infp|ino|hell|helo|contat|contac|conact)$/;
const FILE = /\.(png|jpe?g|gif|webp|svg|mp4|mov|pdf|css|js)$/i;

export function emailIssue(raw: string | null | undefined, website?: string | null): EmailIssue | null {
  const email = String(raw || "").trim().toLowerCase();
  if (!email) return null;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { level: "bad", reason: "Not a real email address" };
  if (FILE.test(email)) return { level: "bad", reason: "A file name, not an email address" };
  const [local, domain] = email.split("@");
  const plain = local.replace(/\+.*$/, "");
  if (PLACEHOLDER_LOCAL.test(plain) || PLACEHOLDER_DOMAIN.test(domain)) return { level: "bad", reason: "A placeholder from a website template" };
  if (TYPO_LOCAL.test(plain)) return { level: "bad", reason: `Looks like a typo (“${plain}@”)` };
  if (JOBS.test(plain)) return { level: "bad", reason: "A jobs / HR inbox" };
  if (NOT_PEOPLE.test(plain)) return { level: "bad", reason: "Not read by a person who buys (legal, no-reply…)" };
  const site = hostOf(website);
  if (site && !FREE.has(domain) && !(domain === site || site.endsWith(`.${domain}`) || domain.endsWith(`.${site}`)))
    return { level: "warn", reason: `On another domain (${domain}, website ${site})` };
  if (SOFT.test(plain)) return { level: "warn", reason: "A press, bookings or back-office inbox" };
  return null;
}

// Big chains and franchises rarely buy from small agencies: shown as a note (UX audit row 52).
const CHAINS = /\b(planet fitness|gold'?s gym|anytime fitness|la fitness|24 hour fitness|crunch fitness|orangetheory|f45|snap fitness|starbucks|mcdonald'?s|subway|burger king|kfc|domino'?s|pizza hut|costa coffee|pret a manger|greggs|tesco|walmart|target|ikea|h&m|zara|remax|re\/max|keller williams|century 21|coldwell banker|marriott|hilton|holiday inn|premier inn)\b/i;
export const isChain = (name: string | null | undefined) => CHAINS.test(String(name || ""));

// A phone that is really something else (a rating "4.9(50", a cut-off number): fewer than 7 digits or rating-like text.
export function phoneIssue(raw: string | null | undefined) {
  const p = String(raw || "").trim();
  if (!p) return null;
  const digits = p.replace(/\D/g, "");
  if (/\d\.\d\s*\(\d/.test(p) || /[()]\s*$/.test(p) && !/\)\s*\d/.test(p)) return "Not a phone number (looks like a rating)";
  if (digits.length < 7) return "Too short to be a phone number";
  if (p.startsWith("+") && digits.length < 10) return "Cut-off international number";
  return null;
}
// Descriptions that are not about the business: an email, a link, a file, or a few cut-off words.
export function junkText(raw: string | null | undefined) {
  const t = String(raw || "").trim();
  if (!t) return false;
  return /^\S+@\S+\.\S+$/.test(t) || /^https?:\/\/\S+$/.test(t) || /\.(mp4|mov|jpe?g|png|pdf)(\?\S*)?$/i.test(t) || (t.length < 25 && !/[.!?]$/.test(t));
}

// A person's first name from their email address, when it clearly has one: anthony@ads4local.com → "Anthony",
// clay.smith@x.com → "Clay". Not for role inboxes (info@, hello@), company words or long joined names (Batch 001 #6, #7).
const NOT_NAMES = new Set(["info", "hello", "hi", "hey", "contact", "team", "sales", "support", "admin", "office", "studio", "marketing", "media", "video",
  "design", "mail", "email", "enquiries", "enquiry", "inquiries", "inquiry", "booking", "bookings", "jobs", "careers", "press", "accounts", "billing", "service",
  "services", "help", "social", "creative", "agency", "director", "manager", "owner", "ceo", "founder", "news", "newsletter", "noreply", "webmaster", "general",
  "reception", "work", "hola", "us", "me", "projects", "project", "partners", "partner", "growth", "digital", "content", "films", "film", "photo", "events",
  "orders", "shop", "store", "studios", "productions", "production", "brand", "brands", "ads", "web", "dev", "tech", "ops", "hr", "pr", "biz", "business"]);
export function nameFromEmail(raw: string | null | undefined, company?: string | null): string {
  const email = String(raw || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+$/.test(email) || emailIssue(email)?.level === "bad") return "";
  const [local, domain] = email.split("@");
  const first = local.replace(/\+.*$/, "").split(/[._-]/)[0];
  if (!/^[a-z]{3,12}$/.test(first) || NOT_NAMES.has(first)) return "";
  const words = `${company ?? ""} ${domain.split(".")[0]}`.toLowerCase().replace(/[^a-z]+/g, " ");
  if (words.split(" ").includes(first) || domain.split(".")[0].startsWith(first)) return "";
  return first[0].toUpperCase() + first.slice(1);
}

// The name after "Hi" (Affan, 19 Nov 2026): a person's first name, or "there" ("Hi there,") when no person is known.
// Never a company ("Hey Social HQ,") or "… team". Used on every new email, whatever the AI or a job file returned.
// The greeting name the email may use (19 Nov 2026: "Hi Social," for "Social HQ"). The AI's first_name is used only
// when it is a real person's first name Kestrel has for this lead: from a contact person or from the email address
// (e.g. sarah@…). Otherwise the email says "Hi there,". Never the company name.
export function trustedFirstName(
  aiName: string | null | undefined,
  lead: { name?: string | null; email?: string | null; contacts?: { name?: string | null }[] | null; researchContacts?: { name?: string | null }[] | null },
): string {
  const want = String(aiName ?? "").trim().toLowerCase();
  if (!want || want === "there") return "there";
  const fromEmail = nameFromEmail(lead.email ?? "", lead.name ?? "");
  const contactFirsts = (lead.contacts ?? []).map((c) => String(c?.name ?? "").trim().split(/\s+/)[0]).filter(Boolean);
  // Only use research contacts when no personal name came from the email, or it matches that email's first name.
  const researchFirsts = (!fromEmail ? (lead.researchContacts ?? []) : (lead.researchContacts ?? []).filter((c) => String(c?.name ?? "").trim().split(/\s+/)[0]?.toLowerCase() === fromEmail.toLowerCase()))
    .map((c) => String(c?.name ?? "").trim().split(/\s+/)[0])
    .filter(Boolean);
  const firsts = [...contactFirsts, ...(fromEmail ? [fromEmail] : []), ...researchFirsts];
  const hit = firsts.find((f) => f.toLowerCase() === want);
  return hit ? greetName(hit, lead.name) : "there";
}
export function greetName(raw: string | null | undefined, company?: string | null): string {
  const n = String(raw ?? "").replace(/[,.!:;"“”]+$/g, "").replace(/\s+/g, " ").trim();
  if (!n || /^there$/i.test(n)) return "there";
  const words = n.split(" ");
  if (words.length > 2 || /\bteam$/i.test(n) || /\b(ltd|limited|llc|inc|gmbh|studio|agency|media|group|co)\b/i.test(n) || /[0-9@&/]/.test(n) || n.length > 24) return "there";
  const co = String(company ?? "").toLowerCase().replace(/\b(ltd|limited|llc|inc)\b\.?/g, "").replace(/\s+/g, " ").trim();
  if (co && (n.toLowerCase() === co || co.split(" ")[0] === n.toLowerCase())) return "there";   // the company, or its first word
  return n;
}
