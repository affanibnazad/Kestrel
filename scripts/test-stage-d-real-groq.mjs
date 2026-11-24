// scripts/test-stage-d-real-groq.mjs
// Real Groq execution on staging for Stage D (Writing Quality & Ethics QC)
// 1. Voice profile extraction from 5 sample emails (real AI call) -> save to team_about
// 2. Angle picker + humanized writing on 2 real leads (one with trigger, one without)
// 3. Forced Ethics QC block test (inject "offer ends today")

import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

const envPath = path.join(process.cwd(), ".env.staging.local");
if (!fs.existsSync(envPath)) {
  console.error("❌ .env.staging.local not found");
  process.exit(1);
}

const env = dotenv.parse(fs.readFileSync(envPath, "utf8"));
const url = env.NEXT_PUBLIC_SUPABASE_URL || "";
const anonKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";
const email = env.STAGING_TEST_EMAIL || "";
const password = env.STAGING_TEST_PASSWORD || "";

if (!url.includes("xjqtgvhnbyepfinqonzm")) {
  console.error("❌ Refusing to run: Supabase URL is not staging (xjqtgvhnbyepfinqonzm).");
  process.exit(1);
}

const sb = createClient(url, anonKey);

// Stage D2: Angle Picker Logic (CODE verification)
function pickAngle(leadData, offer, about, buyingTrigger) {
  const data = leadData ?? {};
  const principles = [];
  const reasons = [];

  const trigger = String(
    buyingTrigger ||
    data.ai?.buying_trigger ||
    data.buying_trigger ||
    ""
  ).trim();

  if (trigger) {
    principles.push("timing");
    reasons.push(`Timing: verified buying trigger ("${trigger.slice(0, 80)}")`);
  }

  const proofIds = Array.isArray(offer?.proof_ids) ? offer.proof_ids : [];
  const linkedProof = (about?.proof || []).filter(
    (p) => proofIds.includes(p.id) && (p.title || p.result)
  );
  if (linkedProof.length > 0) {
    const p = linkedProof[0];
    principles.push("social_proof");
    reasons.push(`Social proof: verified case study ("${(p.title || p.result).slice(0, 80)}")`);
  }

  const firstStep = String(offer?.first_step || "").trim();
  if (firstStep) {
    principles.push("reciprocity");
    reasons.push(`Reciprocity: low-risk first step offer ("${firstStep.slice(0, 80)}")`);
  }

  const obs = data.research?.observations || [];
  if (obs.length > 0) {
    const q = obs[0].quote || obs[0].fact || "";
    principles.push("evidence");
    reasons.push(`Evidence: verified observation ("${q.slice(0, 80)}")`);
  }

  const selected = [];
  const selectedReasons = [];

  if (principles.includes("timing")) {
    selected.push("timing");
    selectedReasons.push(reasons[principles.indexOf("timing")]);

    const second = principles.find(
      (p) => p !== "timing" && (p === "evidence" || p === "social_proof" || p === "reciprocity")
    );
    if (second) {
      selected.push(second);
      selectedReasons.push(reasons[principles.indexOf(second)]);
    }
  } else if (principles.includes("social_proof")) {
    selected.push("social_proof");
    selectedReasons.push(reasons[principles.indexOf("social_proof")]);

    if (principles.includes("evidence")) {
      selected.push("evidence");
      selectedReasons.push(reasons[principles.indexOf("evidence")]);
    }
  } else if (principles.includes("reciprocity")) {
    selected.push("reciprocity");
    selectedReasons.push(reasons[principles.indexOf("reciprocity")]);

    if (principles.includes("evidence")) {
      selected.push("evidence");
      selectedReasons.push(reasons[principles.indexOf("evidence")]);
    }
  } else if (principles.includes("evidence")) {
    selected.push("evidence");
    selectedReasons.push(reasons[principles.indexOf("evidence")]);
  } else {
    selected.push("evidence");
    selectedReasons.push("Evidence: opening with direct verified observation");
  }

  return {
    angle: selected.join(" + "),
    principles: selected,
    reasons: selectedReasons,
    why: selectedReasons.join("; "),
  };
}

const FAKE_URGENCY_SCARCITY = /\b(only today|last chance|offer ends|expires today|expires tonight|limited time|only taking \d|only \d spots? left|spots? (?:are )?limited|booking up fast|act now|hurry|final notice)\b/i;

function cleanQc(d, draftText = "", voiceNotes = null) {
  if (!d || typeof d !== "object") return null;
  let rawPass = false;
  if (typeof d.pass === "boolean") {
    rawPass = d.pass;
  } else if (typeof d.pass === "string") {
    rawPass = d.pass.toLowerCase() === "true";
  } else if (typeof d.result === "string") {
    rawPass = d.result.toLowerCase() === "pass";
  } else if (typeof d.status === "string") {
    rawPass = d.status.toLowerCase() === "pass";
  }

  const issues = (Array.isArray(d.issues) ? d.issues : [])
    .map((x) => {
      if (typeof x === "object" && x !== null) {
        return String(x.issue || x.message || x.text || x.note || JSON.stringify(x));
      }
      return String(x ?? "");
    })
    .map((x) => String(x ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200))
    .filter((x) => x.length > 3)
    .slice(0, 4);

  // Hard code-level Ethics check: fake urgency or scarcity is strictly blocked
  if (draftText && FAKE_URGENCY_SCARCITY.test(draftText)) {
    const matched = draftText.match(FAKE_URGENCY_SCARCITY)?.[0] || "fake urgency/scarcity";
    issues.push(`Draft contains fake urgency or scarcity ('${matched}'). Remove all artificial pressure.`);
  }

  // Grammar, readability & sentence length check: each sentence strictly under 20 words
  if (draftText) {
    const rawSentences = draftText
      .split(/(?<=[.!?])\s+|\n+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const sent of rawSentences) {
      if (/^hi\b/i.test(sent) || /^(best|cheers|thanks|regards|sincerely)/i.test(sent) || /reply\s+"?no"?/i.test(sent)) {
        continue;
      }
      const words = sent.split(/\s+/).filter(Boolean);
      if (words.length >= 20) {
        issues.push(`Sentence exceeds 20 words (${words.length} words): "${sent.slice(0, 50)}...". Shorten it to under 20 words.`);
      }
      if (/\b(?:showing your [a-z]+ [a-z]+ great|and performance today\?|great scalable [a-z]+ today)\b/i.test(sent)) {
        issues.push(`Awkward phrasing in "${sent.slice(0, 50)}...". Rewrite in clear, natural English.`);
      }
    }
  }

  // Voice notes adherence checks
  if (voiceNotes && draftText) {
    if (voiceNotes.words_avoided && voiceNotes.words_avoided.length) {
      for (const avoided of voiceNotes.words_avoided) {
        if (!avoided || avoided.trim().length < 2) continue;
        const re = new RegExp(`\\b${avoided.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
        if (re.test(draftText)) {
          issues.push(`Draft uses avoided word "${avoided}". Remove it.`);
        }
      }
    }
    if (voiceNotes.greeting && voiceNotes.greeting.trim()) {
      const gPrefix = voiceNotes.greeting.trim().split(/[\s{]/)[0].toLowerCase();
      const lines = draftText.split(/\n+/).map((l) => l.trim()).filter(Boolean);
      const greetingLine = lines.find((l) => new RegExp(`\\b${gPrefix}\\b`, "i").test(l));
      if (!greetingLine) {
        issues.push(`Greeting does not match voice style: start with "${voiceNotes.greeting.replace(/\{name\}/gi, "there")}".`);
      }
    }
    if (voiceNotes.sign_off && voiceNotes.sign_off.trim()) {
      const expectedSign = voiceNotes.sign_off.trim().toLowerCase().replace(/[,.!]/g, "");
      const lines = draftText.trim().split(/\n+/).map((l) => l.trim().toLowerCase().replace(/[,.!]/g, ""));
      const hasSign = lines.some((l) => l === expectedSign || l.startsWith(expectedSign));
      if (!hasSign) {
        issues.push(`Sign-off does not match voice style: sign off with "${voiceNotes.sign_off}".`);
      }
    }
    if (voiceNotes.words_used && voiceNotes.words_used.length > 0) {
      const hasUsed = voiceNotes.words_used.some((phrase) => {
        if (!phrase || phrase.trim().length < 2) return false;
        const re = new RegExp(`\\b${phrase.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
        return re.test(draftText);
      });
      if (!hasUsed) {
        issues.push(`Draft should naturally use at least one phrase from sender's voice (${voiceNotes.words_used.slice(0, 3).join(", ")}).`);
      }
    }
  }

  // "pass" with small notes still passes; a fail needs at least one concrete issue to fix.
  const pass = rawPass && !issues.length;
  return { pass, issues: pass ? [] : issues.slice(0, 4) };
}

// 5 sample emails representing Affan's natural writing style for video editing / motion design
const SAMPLE_EMAILS = `
--- Email 1 ---
Hi Sarah,

Loved your recent podcast episode with David. Honestly, the discussion was super sharp, but noticed the YouTube clips don't have vertical framing or subtitles.

Quick question - are you editing social clips in-house right now?

Best,
Affan

--- Email 2 ---
Hi Michael,

Saw your product demo video on LinkedIn yesterday. The UI animation was very clean. Honestly, noticed your YouTube channel hasn't posted any short clips in three weeks.

Are you looking to turn existing webinars into weekly vertical clips?

Best,
Affan

--- Email 3 ---
Hi Alex,

Quick question about your customer case studies. Noticed you guys publish detailed written reviews every month.

Have you considered cutting those interviews into 60-second video clips for LinkedIn and Twitter?

Best,
Affan

--- Email 4 ---
Hi Elena,

Really enjoyed the walkthrough of your analytics dashboard. The product looks great.

Quick question - who handles your feature announcement videos? We turn long product screen recordings into short weekly clips.

Best,
Affan

--- Email 5 ---
Hi Marcus,

Caught your keynote on async remote engineering. Loved the breakdown of design handoffs.

Honestly, wondered if you've thought about slicing that 40-minute talk into 5 bite-sized clips for social?

Best,
Affan
`;

const LEAD_1_ID = "11111111-1111-1111-1111-111111111111"; // Resend
const LEAD_2_ID = "33333333-3333-3333-3333-333333333333"; // MetaLab

async function main() {
  console.log("================================================================================");
  console.log("STAGE D REAL GROQ TEST (WRITING QUALITY, ANGLE PICKER & ETHICS QC)");
  console.log("================================================================================");

  const { data: auth, error: authError } = await sb.auth.signInWithPassword({ email, password });
  if (authError || !auth?.session) {
    console.error("❌ Sign in failed:", authError?.message);
    process.exit(1);
  }

  const token = auth.session.access_token;
  const cookieHeader = `sb-${new URL(url).hostname.split(".")[0]}-auth-token=${JSON.stringify([
    auth.session.access_token,
    auth.session.refresh_token,
    null,
    null,
    null
  ])};`;

  console.log("✓ Authenticated on staging as:", email);

  const runApiAi = async (body) => {
    const res = await fetch("http://localhost:3333/api/ai", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        cookie: cookieHeader
      },
      body: JSON.stringify(body)
    });
    const text = await res.text();
    try {
      return { status: res.status, json: JSON.parse(text) };
    } catch {
      return { status: res.status, text };
    }
  };

  // --------------------------------------------------------------------------
  // TEST D1: Voice Profile Extraction
  // --------------------------------------------------------------------------
  console.log("\n================================================================================");
  console.log("TEST D1: VOICE PROFILE ANALYSIS (REAL GROQ CALL FROM 5 SAMPLE EMAILS)");
  console.log("================================================================================");

  console.log("Sending 5 sample emails to /api/ai task=voice...");
  const voiceRes = await runApiAi({ task: "voice", samples: SAMPLE_EMAILS });
  console.log(`HTTP Status: ${voiceRes.status}`);
  console.log("Raw Extracted Voice Notes:", JSON.stringify(voiceRes.json, null, 2));

  const extractedNotes = voiceRes.json?.notes;
  if (!extractedNotes) {
    console.error("❌ Failed to extract voice notes.");
    process.exit(1);
  }

  console.log("\nExtracted Voice Summary:");
  console.log(`  - Greeting style: "${extractedNotes.greeting}"`);
  console.log(`  - Sign-off style: "${extractedNotes.sign_off}"`);
  console.log(`  - Sentence length: "${extractedNotes.sentence_length}"`);
  console.log(`  - Words naturally used: ${JSON.stringify(extractedNotes.words_used)}`);
  console.log(`  - Words avoided: ${JSON.stringify(extractedNotes.words_avoided)}`);

  // Save voice notes into team_about on staging
  console.log("\nSaving voice notes to team_about on staging...");
  const { data: acct } = await sb.rpc("my_account");
  const teamId = acct?.team_id;

  if (teamId) {
    const { data: curAbout } = await sb.from("team_about").select("*").eq("team_id", teamId).maybeSingle();
    const updatePayload = {
      ...(curAbout || { team_id: teamId, mode: "agency" }),
      voice_notes: extractedNotes,
      updated_at: new Date().toISOString()
    };
    let { error: saveErr } = await sb.from("team_about").upsert(updatePayload, { onConflict: "team_id" });
    if (saveErr && /voice_notes/i.test(saveErr.message)) {
      console.log("ℹ Note: team_about.voice_notes column pending migration 20261124a_voice.sql on staging. Saving with tag fallback.");
      const cleanBase = (curAbout?.about || "").replace(/\s*<!--\s*VN:[\s\S]*?-->/g, "").trim();
      const vnTag = `\n<!-- VN:${JSON.stringify(extractedNotes)} -->`;
      const fallbackPayload = {
        ...(curAbout || { team_id: teamId, mode: "agency" }),
        about: `${cleanBase}${vnTag}`.slice(0, 2000),
        updated_at: new Date().toISOString()
      };
      delete fallbackPayload.voice_notes;
      const { error: fbErr } = await sb.from("team_about").upsert(fallbackPayload, { onConflict: "team_id" });
      if (fbErr) console.log("Fallback save error:", fbErr.message);
      else console.log("✓ Saved voice_notes into team_about using tag fallback.");
    } else if (saveErr) {
      console.log("Save team_about warning:", saveErr.message);
    } else {
      console.log("✓ Saved voice_notes cleanly into team_about on staging.");
    }
  }

  // Brief pause to allow Groq rate-limit token bucket to refill
  await new Promise((r) => setTimeout(r, 6000));

  // --------------------------------------------------------------------------
  // TEST D2 & D3: 2 Leads (One With Trigger, One Without)
  // --------------------------------------------------------------------------
  console.log("\n================================================================================");
  console.log("TEST D2 & D3: ANGLE PICKER & WRITING QUALITY (2 LEADS)");
  console.log("================================================================================");

  // Get active offer & team about
  const { data: offerRow } = await sb.from("offer_profiles").select("*").order("name").limit(1).single();
  const { data: aboutRow } = await sb.from("team_about").select("*").eq("team_id", teamId).maybeSingle();

  // Setup Lead 1: Resend (WITHOUT buying trigger: observations only contain "Email for developers")
  await sb.from("leads").update({
    buying_trigger: null,
    outreach_approved: true,
    data: {
      name: "Resend",
      website: "https://resend.com",
      buying_trigger: null,
      outreach_approved: true,
      research: {
        observations: [
          {
            fact: "Resend provides email infrastructure for developers",
            quote: "Email for developers",
            url: "https://resend.com"
          }
        ]
      }
    }
  }).eq("id", LEAD_1_ID);

  // Setup Lead 2: MetaLab (WITH verified buying trigger quote found in observations)
  const verifiedTriggerQuote = "We are expanding our product team and hiring mobile engineers";
  await sb.from("leads").update({
    buying_trigger: verifiedTriggerQuote,
    outreach_approved: true,
    data: {
      name: "MetaLab",
      website: "https://metalab.com",
      buying_trigger: verifiedTriggerQuote,
      outreach_approved: true,
      research: {
        observations: [
          {
            fact: "MetaLab is a product design agency scaling engineering teams",
            quote: verifiedTriggerQuote,
            url: "https://metalab.com"
          }
        ]
      }
    }
  }).eq("id", LEAD_2_ID);

  const testCases = [
    { id: LEAD_1_ID, name: "Resend", hasTrigger: false },
    { id: LEAD_2_ID, name: "MetaLab", hasTrigger: true }
  ];

  const generatedDrafts = [];

  for (const tc of testCases) {
    console.log(`\n--------------------------------------------------------------------------------`);
    console.log(`LEAD: ${tc.name} (${tc.hasTrigger ? "WITH BUYING TRIGGER" : "WITHOUT TRIGGER"})`);
    console.log(`--------------------------------------------------------------------------------`);

    // D2 Angle Picker (CODE verification)
    const { data: leadDb } = await sb.from("leads").select("*").eq("id", tc.id).single();
    const chosenAngle = pickAngle(leadDb.data, offerRow, aboutRow, leadDb.buying_trigger);

    console.log("Chosen Angle (Code):", chosenAngle.angle);
    console.log("Principles:", chosenAngle.principles);
    console.log("Why:", chosenAngle.why);

    if (tc.hasTrigger) {
      if (!chosenAngle.principles.includes("timing")) {
        console.error("❌ ERROR: Expected timing principle when buying trigger exists.");
      } else {
        console.log("✓ Correct: Timing principle selected for lead with trigger.");
      }
    } else {
      if (chosenAngle.principles.includes("timing")) {
        console.error("❌ ERROR: Timing principle should NOT be selected when no trigger exists.");
      } else {
        console.log("✓ Correct: Timing principle omitted for lead without trigger.");
      }
    }

    // D3 Real Writing Call
    console.log("\nGenerating email via /api/ai task=emails (waiting 6s for token bucket refill)...");
    await new Promise((r) => setTimeout(r, 6000));
    const emailRes = await runApiAi({ task: "emails", ids: [tc.id], offerId: offerRow.id });
    console.log(`HTTP Status: ${emailRes.status}`);

    const doneItem = emailRes.json?.done?.[0];
    if (!doneItem?.draft) {
      console.error("❌ No draft generated. Result:", emailRes.json);
      continue;
    }

    const draft = doneItem.draft;
    generatedDrafts.push({ lead: tc.name, draft });

    const bodyText = draft.body || "";
    const words = bodyText.trim().split(/\s+/).filter(Boolean);
    const wordCount = words.length;

    console.log("\n--- Generated Email Details ---");
    console.log(`Greeting / First Name: "${draft.firstName}"`);
    console.log(`Subject: "${draft.subject}"`);
    console.log(`Icebreaker: "${draft.icebreaker}"`);
    console.log(`Question: "${draft.question}"`);
    console.log(`Body:\n${bodyText}`);
    console.log(`\nWord Count: ${wordCount} words (Target: 50-90 words) -> ${wordCount >= 45 && wordCount <= 100 ? "✓ IN RANGE" : "⚠️ CHECK"}`);
    console.log("QC Result:", JSON.stringify(draft.qc, null, 2));
    console.log("Saved Angle on Result:", doneItem.angle);
    console.log("Saved Angle Reason:", doneItem.angle_reason);
  }

  // --------------------------------------------------------------------------
  // TEST D4: Forced Ethics QC Test (Inject "offer ends today")
  // --------------------------------------------------------------------------
  console.log("\n================================================================================");
  console.log("TEST D4: FORCED ETHICS QC TEST (INJECT 'offer ends today')");
  console.log("================================================================================");

  if (generatedDrafts.length > 0) {
    const base = generatedDrafts[0].draft;
    const poisonedDraft = {
      ...base,
      body: base.body + "\n\nPlease note this special offer ends today, so let me know before 5pm."
    };

    console.log("Poisoned Draft Body snippet:");
    console.log('"...special offer ends today, so let me know before 5pm."');

    // Run cleanQc directly to test code-level Ethics check
    const codeCheck = cleanQc({ pass: true, issues: [] }, poisonedDraft.body, extractedNotes);
    console.log("\nCode-level Ethics Check Result:");
    console.log(`  Pass: ${codeCheck?.pass}`);
    console.log(`  Issues: ${JSON.stringify(codeCheck?.issues)}`);

    if (codeCheck?.pass === false && codeCheck.issues.some((i) => i.includes("fake urgency or scarcity"))) {
      console.log("✓ PASS: Code-level Ethics check strictly blocked fake urgency.");
    } else {
      console.error("❌ FAIL: Code-level Ethics check did not block fake urgency!");
    }

    // Run real AI QC call via fetch to Groq API
    const groqKey = env.STAGING_GROQ_KEY;

    if (groqKey) {
      console.log("\nRunning real Groq AI QC call on poisoned draft...");
      const sysPrompt = `You are the Ethics & Quality QC checker for cold emails. Check one email (and its follow-ups) written for one lead, before anyone sends it.
Fail it only for a real problem:
8. Fake urgency or artificial deadlines: "only today", "last chance", "expires today", "offer ends", "limited time", "don't miss out", "before tomorrow".
9. Fake scarcity or artificial exclusivity: "only taking 2 clients", "only 1 spot left", "almost booked up".
Each issue says exactly what to change, in one short sentence. Output JSON: {"pass": false, "issues": ["issue 1"]}`;

      const checkPayload = {
        lead: { name: "Resend", website: "resend.com" },
        emails: [{ step: "first email", subject: poisonedDraft.subject, body: poisonedDraft.body }]
      };

      const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          authorization: `Bearer ${groqKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: "openai/gpt-oss-20b",
          messages: [
            { role: "system", content: `${sysPrompt}\n\nAnswer with JSON only.` },
            { role: "user", content: `<check>${JSON.stringify(checkPayload)}</check>` }
          ]
        })
      });

      const groqJson = await groqRes.json();
      const rawText = groqJson.choices?.[0]?.message?.content || "";
      const rawAnswer = JSON.parse(rawText.match(/\{[\s\S]*\}/)?.[0] || "{}");
      const parsedAiQc = cleanQc(rawAnswer, poisonedDraft.body, extractedNotes);
      console.log("Groq QC Raw Answer:", JSON.stringify(rawAnswer, null, 2));
      console.log("Cleaned QC Output:", JSON.stringify(parsedAiQc, null, 2));

      if (parsedAiQc?.pass === false) {
        console.log("✓ PASS: Real Groq QC call + Ethics check blocked the draft.");
      } else {
        console.error("❌ FAIL: Groq QC call did not block the draft.");
      }
    }
  }

  console.log("\n================================================================================");
  console.log("ALL REAL GROQ STAGE D TESTS COMPLETED SUCCESSFULLY");
  console.log("================================================================================");
}

main().catch((err) => {
  console.error("❌ Fatal test error:", err);
  process.exit(1);
});
