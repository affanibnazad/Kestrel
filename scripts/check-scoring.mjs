// Checks that the App's team rules (src/lib/scoring.ts) and Find Emails choices (src/lib/hunter.ts) give the same data quality,
// rule rejects and Good / No marks as the extension (core/lib.js). Points scoring was removed on 18 Nov 2026.
// Run: node scripts/check-scoring.mjs   (compiles scoring.ts with the TypeScript compiler into a temp folder first)
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const out = mkdtempSync(join(tmpdir(), "kestrel-scoring-"));
execFileSync("npx", ["tsc", "src/lib/scoring.ts", "src/lib/hunter.ts", "--outDir", out, "--module", "commonjs", "--target", "es2020", "--skipLibCheck"], { stdio: "inherit" });
writeFileSync(join(out, "package.json"), '{"type":"commonjs"}');
const S = require(join(out, "scoring.js"));
const L = require("../../All Outreach Resources/Outreach Engine/tools/quarry/core/lib.js");

let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const pick = (a) => a[Math.floor(rnd() * a.length)];
const maybe = (v) => (rnd() < 0.5 ? v : undefined);
const fields = S.RULE_FIELDS.map((f) => f[0]), ops = S.RULE_OPS.map((o) => o[0]);
if (JSON.stringify(fields) !== JSON.stringify(L.RULE_FIELDS.map((f) => f[0]))) throw new Error("rule fields differ");
const refine = { ...L.mergeDefaults({}).refine };
delete refine.rules;
if (JSON.stringify(S.DEFAULT_REFINE) !== JSON.stringify(refine)) throw new Error("default refine differs");

let bad = 0;
for (let i = 0; i < 3000; i++) {
  const lead = {
    name: pick(["Acme Video", "Bright Studio", "Recruit Co", ""]), category: maybe(pick(["Video production", "Recruiter", "Marketing agency"])),
    description: maybe("We make brand films"), keyword: maybe(pick(["video agency", "marketing", "a b"])), source: pick(["maps", "youtube", "search", "osm"]),
    email: maybe("hi@acme.ie"), phone: maybe("+44 20 1234"), website: maybe("https://acme.ie"), address: maybe("1 Road"), emailKind: maybe(pick(["person", "role", "other", "free", "none"])),
    socials: maybe(pick([{}, { facebook: "f" }, { facebook: "f", x: "t", instagram: "i", linkedin: "l", youtube: "y" }])),
    rating: pick([undefined, 0, 3.4, 3.6, 4.2, "4.5"]), reviews: pick([undefined, "", 0, 5, 50, 2000, "12"]), subscribers: maybe(pick([500, 5000, 900000])), videos: maybe(pick([2, 8, 40])),
    country: maybe("GB"), ai: maybe({ fit: Math.floor(rnd() * 100), verdict: pick(["good", "maybe", "no"]) }),
  };
  const rules = Array.from({ length: Math.floor(rnd() * 4) }, () => ({ field: pick(fields), op: pick(ops), value: pick(["", "video", "recruit,acme", "3", "4.0", "0"]), action: pick(["reject", "good", "no", "boost", "penalty"]), amount: 10 }));
  const a = L.applyRules(JSON.parse(JSON.stringify(lead)), rules);
  const b = S.applyRules(JSON.parse(JSON.stringify(lead)), rules);
  for (const k of ["quality", "ruleReject", "ruleMark"]) if (a[k] !== b[k]) { bad++; if (bad < 5) console.log("differs", k, a[k], b[k], JSON.stringify(lead), JSON.stringify(rules)); }
}
if (bad) { console.error(`${bad} differences`); process.exit(1); }
console.log("App rules match the extension (3000 random leads)");

// Find Emails: same email choice, order and contacts as the extension.
globalThis.QuarryLib = L;
const Src = require("../../All Outreach Resources/Outreach Engine/tools/quarry/core/sources.js");
const H = require(join(out, "hunter.js"));
const sample = { data: { domain: "acme.ie", emails: [
  { value: "info@acme.ie", type: "generic", confidence: 90 },
  { value: "jo@acme.ie", type: "personal", confidence: 95, first_name: "Jo", last_name: "Ray", position: "Founder", decision_maker: true },
  { value: "sam@acme.ie", type: "personal", confidence: 40, first_name: "Sam" },
  { value: "kim@acme.ie", type: "personal", confidence: 80, first_name: "Kim", position: "Editor", seniority: "senior", verification: { status: "invalid" } },
  { value: "lee@gmail.com", type: "personal", confidence: 70, first_name: "Lee", position: "Head of video" } ] } };
const same = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`); };
same(H.hunterPick(sample), Src.hunterPick(sample), "hunterPick");
same(H.hunterUrl({ website: "https://www.acme.ie/x" }, "k"), Src.hunterUrl({ website: "https://www.acme.ie/x" }, "k"), "hunterUrl");
same(H.hunterUrl({ name: "Acme Ltd" }, "k"), Src.hunterUrl({ name: "Acme Ltd" }, "k"), "hunterUrl by name");
for (const site of ["https://acme.ie", "", "https://other.com"]) {
  const a = { website: site }, b = { website: site }, list = ["info@acme.ie", "jo@acme.ie", "x@gmail.com", "y@acme.co.uk"];
  L.setEmails(a, list); H.setEmails(b, list); same(b, a, `setEmails ${site}`);
}
same(H.mergeContacts([{ name: "Jo Ray", position: "Founder" }], [{ name: "jo  ray", role: "CEO", email: "jo@acme.ie" }, { name: "Kim" }]),
  L.mergeContacts([{ name: "Jo Ray", position: "Founder" }], [{ name: "jo  ray", role: "CEO", email: "jo@acme.ie" }, { name: "Kim" }]), "mergeContacts");
console.log("App Find Emails matches the extension");
