// scripts/verify-multitenant-isolation.mjs
// Comprehensive automated cross-tenant isolation and IDOR test suite for Kestrel.
// Verifies that Tenant A and Tenant B cannot access, modify, delete, or spoof each other's data.

import { execSync } from "node:child_process";
import { seedMultiTenant } from "./seed-multitenant-test.mjs";
import { cleanupMultiTenant } from "./cleanup-multitenant-test.mjs";

const DB = process.env.STAGING_DB || process.env.PGDATABASE || "kestrel_staging_test";
const USER = process.env.PGUSER || "aryanrawat";

const TENANT_A = {
  name: "Tenant A (Kestrel QA Alpha)",
  userId: "a0000000-0000-0000-0000-000000000001",
  teamId: "a0000000-0000-0000-0000-000000000002",
  lead1Id: "a0000000-0000-0000-0000-000000000011",
  lead2Id: "a0000000-0000-0000-0000-000000000012",
  campaignId: "a0000000-0000-0000-0000-000000000021",
  sequenceId: "a0000000-0000-0000-0000-000000000031",
  webhookId: "a0000000-0000-0000-0000-000000000051",
  replyId: "a0000000-0000-0000-0000-000000000061",
  mailboxId: "a0000000-0000-0000-0000-000000000071",
  listId: "a0000000-0000-0000-0000-000000000081",
  offerId: "a0000000-0000-0000-0000-000000000091",
};

const TENANT_B = {
  name: "Tenant B (Kestrel QA Beta)",
  userId: "b0000000-0000-0000-0000-000000000001",
  teamId: "b0000000-0000-0000-0000-000000000002",
  lead1Id: "b0000000-0000-0000-0000-000000000011",
  lead2Id: "b0000000-0000-0000-0000-000000000012",
  campaignId: "b0000000-0000-0000-0000-000000000021",
  sequenceId: "b0000000-0000-0000-0000-000000000031",
  webhookId: "b0000000-0000-0000-0000-000000000051",
  replyId: "b0000000-0000-0000-0000-000000000061",
  mailboxId: "b0000000-0000-0000-0000-000000000071",
  listId: "b0000000-0000-0000-0000-000000000081",
  offerId: "b0000000-0000-0000-0000-000000000091",
};

function runQuery(asUser, sql) {
  const wrapped = `
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '${asUser.userId}';
SET LOCAL "request.jwt.claim.role" = 'authenticated';
${sql}
COMMIT;
`;
  try {
    const stdout = execSync(`psql -U "${USER}" -d "${DB}" -t -A -v ON_ERROR_STOP=1`, { input: wrapped, encoding: "utf8" });
    return { ok: true, stdout: stdout.trim(), stderr: "" };
  } catch (err) {
    return { ok: false, stdout: "", stderr: err.stderr ? err.stderr.trim() : err.message };
  }
}

function runAdminQuery(sql) {
  try {
    const stdout = execSync(`psql -U "${USER}" -d "${DB}" -t -A -v ON_ERROR_STOP=1`, { input: sql, encoding: "utf8" });
    return { ok: true, stdout: stdout.trim(), stderr: "" };
  } catch (err) {
    return { ok: false, stdout: "", stderr: err.stderr ? err.stderr.trim() : err.message };
  }
}

async function runAllTests() {
  console.log("================================================================================");
  console.log("KESTREL MULTI-TENANT ISOLATION & IDOR VERIFICATION SUITE");
  console.log(`Database: ${DB} | Target: PostgreSQL RLS Architecture`);
  console.log("================================================================================\n");

  // Step 1: Clean & Seed fresh fixtures
  seedMultiTenant();

  const results = [];

  function record(id, name, actor, target, expected, actual, pass, detail = "") {
    results.push({ id, name, actor: actor.name, target: target.name, expected, actual, pass, detail });
    const mark = pass ? "✓ PASS" : "✗ FAIL";
    console.log(`[${mark}] ${id}: ${name} (${actor.name.split(" ")[0]} -> ${target.name.split(" ")[0]})`);
    if (!pass) console.log(`   Expected: ${expected} | Actual: ${actual} | Detail: ${detail}`);
  }

  // Helper to extract the actual query result line (excluding transaction control output like COMMIT/BEGIN/SET)
  function getResultLine(output) {
    const lines = output.stdout.split("\n").map((l) => l.trim()).filter((l) => l && l !== "COMMIT" && l !== "BEGIN" && !l.startsWith("SET"));
    return lines.length > 0 ? lines[lines.length - 1] : "";
  }

  // --- 1. LEGITIMATE TENANT READS ---
  const ownA = runQuery(TENANT_A, `SELECT count(*) FROM leads;`);
  const countOwnA = getResultLine(ownA);
  record("TEST-01", "Tenant A reads own leads", TENANT_A, TENANT_A, "2 leads returned", `${countOwnA} leads returned`, countOwnA === "2");

  const ownB = runQuery(TENANT_B, `SELECT count(*) FROM leads;`);
  const countOwnB = getResultLine(ownB);
  record("TEST-02", "Tenant B reads own leads", TENANT_B, TENANT_B, "2 leads returned", `${countOwnB} leads returned`, countOwnB === "2");

  // --- 2. CROSS-TENANT LEAD READ (IDOR SELECT) ---
  const readBfromA = runQuery(TENANT_A, `SELECT count(*) FROM leads WHERE id = '${TENANT_B.lead1Id}';`);
  const countBA = getResultLine(readBfromA);
  record("TEST-03", "Tenant A attempts to read Tenant B lead by ID", TENANT_A, TENANT_B, "0 rows (Access Denied / Hidden by RLS)", `${countBA} rows returned`, countBA === "0");

  const readAfromB = runQuery(TENANT_B, `SELECT count(*) FROM leads WHERE id = '${TENANT_A.lead1Id}';`);
  const countAB = getResultLine(readAfromB);
  record("TEST-04", "Tenant B attempts to read Tenant A lead by ID", TENANT_B, TENANT_A, "0 rows (Access Denied / Hidden by RLS)", `${countAB} rows returned`, countAB === "0");

  // --- 3. CROSS-TENANT LEAD UPDATE (IDOR UPDATE) ---
  const updateBfromA = runQuery(TENANT_A, `UPDATE leads SET name = 'HACKED_BY_A' WHERE id = '${TENANT_B.lead1Id}';`);
  const bStateAfterUpdate = runAdminQuery(`SELECT name FROM leads WHERE id = '${TENANT_B.lead1Id}';`).stdout;
  const passUpdateBA = updateBfromA.stdout.includes("UPDATE 0") && bStateAfterUpdate === "BETA_PRIVATE_LEAD_001";
  record("TEST-05", "Tenant A attempts to update Tenant B lead", TENANT_A, TENANT_B, "UPDATE 0 & record unchanged", `Result: ${updateBfromA.stdout}, Target DB name: ${bStateAfterUpdate}`, passUpdateBA);

  const updateAfromB = runQuery(TENANT_B, `UPDATE leads SET name = 'HACKED_BY_B' WHERE id = '${TENANT_A.lead1Id}';`);
  const aStateAfterUpdate = runAdminQuery(`SELECT name FROM leads WHERE id = '${TENANT_A.lead1Id}';`).stdout;
  const passUpdateAB = updateAfromB.stdout.includes("UPDATE 0") && aStateAfterUpdate === "ALPHA_PRIVATE_LEAD_001";
  record("TEST-06", "Tenant B attempts to update Tenant A lead", TENANT_B, TENANT_A, "UPDATE 0 & record unchanged", `Result: ${updateAfromB.stdout}, Target DB name: ${aStateAfterUpdate}`, passUpdateAB);

  // --- 4. CROSS-TENANT DIRECT LEAD DELETE (IDOR DELETE) ---
  const deleteBfromA = runQuery(TENANT_A, `DELETE FROM leads WHERE id = '${TENANT_B.lead1Id}';`);
  const bStateAfterDelete = runAdminQuery(`SELECT count(*) FROM leads WHERE id = '${TENANT_B.lead1Id}';`).stdout;
  const passDeleteBA = deleteBfromA.stdout.includes("DELETE 0") && bStateAfterDelete === "1";
  record("TEST-07", "Tenant A attempts to delete Tenant B lead directly", TENANT_A, TENANT_B, "DELETE 0 & record preserved", `Result: ${deleteBfromA.stdout}, Target DB exists: ${bStateAfterDelete}`, passDeleteBA);

  const deleteAfromB = runQuery(TENANT_B, `DELETE FROM leads WHERE id = '${TENANT_A.lead1Id}';`);
  const aStateAfterDelete = runAdminQuery(`SELECT count(*) FROM leads WHERE id = '${TENANT_A.lead1Id}';`).stdout;
  const passDeleteAB = deleteAfromB.stdout.includes("DELETE 0") && aStateAfterDelete === "1";
  record("TEST-08", "Tenant B attempts to delete Tenant A lead directly", TENANT_B, TENANT_A, "DELETE 0 & record preserved", `Result: ${deleteAfromB.stdout}, Target DB exists: ${aStateAfterDelete}`, passDeleteAB);

  // --- 5. CROSS-TENANT RPC DELETE (delete_leads RPC IDOR) ---
  const rpcDelBA = runQuery(TENANT_A, `SELECT public.delete_leads(ARRAY['${TENANT_B.lead2Id}'::uuid]);`);
  const bLead2Preserved = runAdminQuery(`SELECT count(*) FROM leads WHERE id = '${TENANT_B.lead2Id}';`).stdout;
  const passRpcBA = rpcDelBA.stdout.includes("0") && bLead2Preserved === "1";
  record("TEST-09", "Tenant A calls delete_leads RPC targeting Tenant B lead", TENANT_A, TENANT_B, "Returns 0 & foreign lead preserved", `RPC returned: ${rpcDelBA.stdout}, Target exists: ${bLead2Preserved}`, passRpcBA);

  const rpcDelAB = runQuery(TENANT_B, `SELECT public.delete_leads(ARRAY['${TENANT_A.lead2Id}'::uuid]);`);
  const aLead2Preserved = runAdminQuery(`SELECT count(*) FROM leads WHERE id = '${TENANT_A.lead2Id}';`).stdout;
  const passRpcAB = rpcDelAB.stdout.includes("0") && aLead2Preserved === "1";
  record("TEST-10", "Tenant B calls delete_leads RPC targeting Tenant A lead", TENANT_B, TENANT_A, "Returns 0 & foreign lead preserved", `RPC returned: ${rpcDelAB.stdout}, Target exists: ${aLead2Preserved}`, passRpcAB);

  // --- 6. CROSS-TENANT CAMPAIGN READ & UPDATE & DELETE ---
  const readCampBA = runQuery(TENANT_A, `SELECT count(*) FROM campaigns WHERE id = '${TENANT_B.campaignId}';`);
  const countCampBA = getResultLine(readCampBA);
  record("TEST-11", "Tenant A attempts to read Tenant B campaign", TENANT_A, TENANT_B, "0 rows", `${countCampBA} rows`, countCampBA === "0");

  const updateCampBA = runQuery(TENANT_A, `UPDATE campaigns SET name = 'COMPROMISED_CAMPAIGN' WHERE id = '${TENANT_B.campaignId}';`);
  const campBName = runAdminQuery(`SELECT name FROM campaigns WHERE id = '${TENANT_B.campaignId}';`).stdout;
  record("TEST-12", "Tenant A attempts to update Tenant B campaign", TENANT_A, TENANT_B, "UPDATE 0 & preserved", `Result: ${updateCampBA.stdout}, Name: ${campBName}`, updateCampBA.stdout.includes("UPDATE 0") && campBName === "BETA_PRIVATE_CAMPAIGN_001");

  const deleteCampBA = runQuery(TENANT_A, `DELETE FROM campaigns WHERE id = '${TENANT_B.campaignId}';`);
  const campBExists = runAdminQuery(`SELECT count(*) FROM campaigns WHERE id = '${TENANT_B.campaignId}';`).stdout;
  record("TEST-13", "Tenant A attempts to delete Tenant B campaign", TENANT_A, TENANT_B, "DELETE 0 & preserved", `Result: ${deleteCampBA.stdout}, Exists: ${campBExists}`, deleteCampBA.stdout.includes("DELETE 0") && campBExists === "1");

  // --- 7. CROSS-TENANT SEQUENCE READ & MODIFY ---
  const readSeqBA = runQuery(TENANT_A, `SELECT count(*) FROM sequences WHERE id = '${TENANT_B.sequenceId}';`);
  const countSeqBA = getResultLine(readSeqBA);
  record("TEST-14", "Tenant A attempts to read Tenant B sequence", TENANT_A, TENANT_B, "0 rows", `${countSeqBA} rows`, countSeqBA === "0");

  const updateSeqBA = runQuery(TENANT_A, `UPDATE sequences SET name = 'COMPROMISED_SEQ' WHERE id = '${TENANT_B.sequenceId}';`);
  const seqBName = runAdminQuery(`SELECT name FROM sequences WHERE id = '${TENANT_B.sequenceId}';`).stdout;
  record("TEST-15", "Tenant A attempts to update Tenant B sequence", TENANT_A, TENANT_B, "UPDATE 0 & preserved", `Result: ${updateSeqBA.stdout}, Name: ${seqBName}`, updateSeqBA.stdout.includes("UPDATE 0") && seqBName === "BETA_PRIVATE_SEQUENCE_001");

  // --- 8. CROSS-TENANT WEBHOOKS & CUSTOM RULES ---
  const readHookBA = runQuery(TENANT_A, `SELECT count(*) FROM team_webhooks WHERE id = '${TENANT_B.webhookId}';`);
  const countHookBA = getResultLine(readHookBA);
  record("TEST-16", "Tenant A attempts to read Tenant B webhook", TENANT_A, TENANT_B, "0 rows", `${countHookBA} rows`, countHookBA === "0");

  const readRulesBA = runQuery(TENANT_A, `SELECT count(*) FROM team_rules WHERE team_id = '${TENANT_B.teamId}';`);
  const countRulesBA = getResultLine(readRulesBA);
  record("TEST-17", "Tenant A attempts to read Tenant B team rules", TENANT_A, TENANT_B, "0 rows", `${countRulesBA} rows`, countRulesBA === "0");

  // --- 9. TENANT ID SPOOFING IN INSERT PAYLOAD ---
  const spoofInsertA = runQuery(TENANT_A, `INSERT INTO leads (team_id, dedupe_key, name) VALUES ('${TENANT_B.teamId}', 'spoofed_by_a.com', 'SPOOFED_LEAD_A');`);
  const passSpoofA = !spoofInsertA.ok && /row-level security/i.test(spoofInsertA.stderr);
  record("TEST-18", "Tenant A attempts to spoof Tenant B ID in INSERT payload", TENANT_A, TENANT_B, "Blocked by RLS WITH CHECK policy violation", spoofInsertA.ok ? "INSERT succeeded (VULNERABILITY!)" : "Rejected with RLS policy error", passSpoofA, spoofInsertA.stderr);

  const spoofInsertB = runQuery(TENANT_B, `INSERT INTO leads (team_id, dedupe_key, name) VALUES ('${TENANT_A.teamId}', 'spoofed_by_b.com', 'SPOOFED_LEAD_B');`);
  const passSpoofB = !spoofInsertB.ok && /row-level security/i.test(spoofInsertB.stderr);
  record("TEST-19", "Tenant B attempts to spoof Tenant A ID in INSERT payload", TENANT_B, TENANT_A, "Blocked by RLS WITH CHECK policy violation", spoofInsertB.ok ? "INSERT succeeded (VULNERABILITY!)" : "Rejected with RLS policy error", passSpoofB, spoofInsertB.stderr);

  // --- 10. TENANT OWNERSHIP REASSIGNMENT ATTACK ---
  const reassignA = runQuery(TENANT_A, `UPDATE leads SET team_id = '${TENANT_B.teamId}' WHERE id = '${TENANT_A.lead1Id}';`);
  const passReassignA = !reassignA.ok && /row-level security/i.test(reassignA.stderr);
  record("TEST-20", "Tenant A attempts to reassign own lead to Tenant B", TENANT_A, TENANT_B, "Blocked by RLS WITH CHECK policy violation", reassignA.ok ? "UPDATE succeeded (VULNERABILITY!)" : "Rejected with RLS policy error", passReassignA, reassignA.stderr);

  // --- 11. MIXED-TENANT BULK OPERATION ---
  // Tenant A sends [Lead A2, Lead B2] to delete_leads. Lead A2 is removed; Lead B2 belongs to Tenant B.
  const bulkDeleteMixed = runQuery(TENANT_A, `SELECT public.delete_leads(ARRAY['${TENANT_A.lead2Id}'::uuid, '${TENANT_B.lead2Id}'::uuid]);`);
  const aLead2Count = runAdminQuery(`SELECT count(*) FROM leads WHERE id = '${TENANT_A.lead2Id}';`).stdout;
  const bLead2Count = runAdminQuery(`SELECT count(*) FROM leads WHERE id = '${TENANT_B.lead2Id}';`).stdout;
  const passBulk = bulkDeleteMixed.stdout.includes("1") && aLead2Count === "0" && bLead2Count === "1";
  record("TEST-21", "Tenant A mixed-tenant bulk delete [Lead A2, Lead B2]", TENANT_A, TENANT_B, "Only own Lead A2 deleted (1); foreign Lead B2 preserved", `Count returned: ${bulkDeleteMixed.stdout}, Lead A2 exists: ${aLead2Count}, Lead B2 exists: ${bLead2Count}`, passBulk);

  // --- 12. FOREIGN CAMPAIGN EXECUTION ATTACK ---
  const startForeignCamp = runQuery(TENANT_A, `SELECT public.start_campaign('${TENANT_B.campaignId}'::uuid, ARRAY['${TENANT_A.lead1Id}'::uuid]);`);
  const passForeignCamp = !startForeignCamp.ok && /not in the team you are signed in to/i.test(startForeignCamp.stderr);
  record("TEST-22", "Tenant A attempts to start Tenant B's campaign", TENANT_A, TENANT_B, "Blocked with 'not in the team' exception", startForeignCamp.ok ? "Campaign started (VULNERABILITY!)" : "Rejected with tenant mismatch exception", passForeignCamp, startForeignCamp.stderr);

  // --- 13. CROSS-TENANT RELATIONSHIP / FOREIGN KEY ATTACKS ---
  const foreignSeqCamp = runQuery(TENANT_A, `INSERT INTO campaigns (team_id, name, sequence_id) VALUES ('${TENANT_A.teamId}', 'ILLEGAL_CAMP_A', '${TENANT_B.sequenceId}');`);
  const passForeignSeq = !foreignSeqCamp.ok && /belongs to another team/i.test(foreignSeqCamp.stderr);
  record("TEST-23", "Tenant A attempts to link Tenant B's sequence into own campaign", TENANT_A, TENANT_B, "Blocked with 'That sequence belongs to another team' exception", foreignSeqCamp.ok ? "Foreign sequence linked (VULNERABILITY!)" : "Rejected by campaigns_check trigger", passForeignSeq, foreignSeqCamp.stderr);

  // --- 14. ROLE BOUNDARIES (VIEWER CANNOT WRITE) ---
  runAdminQuery(`
    INSERT INTO auth.users (id, email) VALUES ('a0000000-0000-0000-0000-000000000009', 'alpha-viewer@kestrel-test.local') ON CONFLICT DO NOTHING;
    INSERT INTO public.members (team_id, user_id, role, full_name, email)
    VALUES ('${TENANT_A.teamId}', 'a0000000-0000-0000-0000-000000000009', 'viewer', 'Alpha Viewer', 'alpha-viewer@kestrel-test.local')
    ON CONFLICT (team_id, user_id) DO UPDATE SET role = 'viewer';
  `);
  const VIEWER_A = { name: "Tenant A Viewer", userId: "a0000000-0000-0000-0000-000000000009" };
  const viewerRead = runQuery(VIEWER_A, `SELECT count(*) FROM leads;`);
  const countViewerRead = getResultLine(viewerRead);
  const viewerUpdate = runQuery(VIEWER_A, `UPDATE leads SET name = 'VIEWER_HACK' WHERE id = '${TENANT_A.lead1Id}';`);
  const passViewer = countViewerRead === "1" && viewerUpdate.stdout.includes("UPDATE 0");
  record("TEST-24", "Viewer role boundary: Viewer reads leads but cannot mutate", VIEWER_A, TENANT_A, "Can read team leads (1) but UPDATE returns 0", `Read: ${countViewerRead}, Update: ${viewerUpdate.stdout}`, passViewer);

  // --- 15. MEMBERSHIP REVOCATION IMMEDIATE EFFECT ---
  runAdminQuery(`DELETE FROM public.members WHERE user_id = 'a0000000-0000-0000-0000-000000000009';`);
  const removedUserRead = runQuery(VIEWER_A, `SELECT count(*) FROM leads;`);
  const countRemovedRead = getResultLine(removedUserRead);
  record("TEST-25", "Removed member access revocation immediate effect", VIEWER_A, TENANT_A, "0 rows immediately on membership removal", `${countRemovedRead} rows returned`, countRemovedRead === "0");

  // --- 16. CROSS-TENANT MAILBOX ISOLATION ---
  const readBoxBA = runQuery(TENANT_A, `SELECT count(*) FROM mailboxes WHERE id = '${TENANT_B.mailboxId}';`);
  const countBoxBA = getResultLine(readBoxBA);
  record("TEST-26", "Tenant A attempts to read Tenant B mailbox", TENANT_A, TENANT_B, "0 rows", `${countBoxBA} rows`, countBoxBA === "0");

  const updateBoxBA = runQuery(TENANT_A, `UPDATE mailboxes SET from_name = 'HACKED_BOX' WHERE id = '${TENANT_B.mailboxId}';`);
  const passUpdateBox = updateBoxBA.stdout.includes("UPDATE 0") || !updateBoxBA.ok || updateBoxBA.stderr.includes("permission denied");
  record("TEST-27", "Tenant A attempts to update Tenant B mailbox", TENANT_A, TENANT_B, "UPDATE 0 or Permission Denied", passUpdateBox ? "Blocked (UPDATE 0 or Permission Denied)" : "Update Succeeded", passUpdateBox, updateBoxBA.stderr);

  const deleteBoxBA = runQuery(TENANT_A, `DELETE FROM mailboxes WHERE id = '${TENANT_B.mailboxId}';`);
  const passDeleteBox = deleteBoxBA.stdout.includes("DELETE 0") || !deleteBoxBA.ok || deleteBoxBA.stderr.includes("permission denied");
  record("TEST-28", "Tenant A attempts to delete Tenant B mailbox", TENANT_A, TENANT_B, "DELETE 0 or Permission Denied", passDeleteBox ? "Blocked (DELETE 0 or Permission Denied)" : "Delete Succeeded", passDeleteBox, deleteBoxBA.stderr);

  // --- 17. CROSS-TENANT INBOX & MAIL REPLIES ISOLATION ---
  const readReplyBA = runQuery(TENANT_A, `SELECT count(*) FROM mail_replies WHERE id = '${TENANT_B.replyId}';`);
  const countReplyBA = getResultLine(readReplyBA);
  record("TEST-29", "Tenant A attempts to read Tenant B mail reply", TENANT_A, TENANT_B, "0 rows", `${countReplyBA} rows`, countReplyBA === "0");

  const updateReplyBA = runQuery(TENANT_A, `UPDATE mail_replies SET subject = 'HACKED_REPLY' WHERE id = '${TENANT_B.replyId}';`);
  const passUpdateReply = updateReplyBA.stdout.includes("UPDATE 0") || !updateReplyBA.ok || updateReplyBA.stderr.includes("permission denied");
  record("TEST-30", "Tenant A attempts to update Tenant B mail reply", TENANT_A, TENANT_B, "UPDATE 0 or Permission Denied", passUpdateReply ? "Blocked (UPDATE 0 or Permission Denied)" : "Update Succeeded", passUpdateReply, updateReplyBA.stderr);

  const deleteReplyBA = runQuery(TENANT_A, `DELETE FROM mail_replies WHERE id = '${TENANT_B.replyId}';`);
  const passDeleteReply = deleteReplyBA.stdout.includes("DELETE 0") || !deleteReplyBA.ok || deleteReplyBA.stderr.includes("permission denied");
  record("TEST-31", "Tenant A attempts to delete Tenant B mail reply", TENANT_A, TENANT_B, "DELETE 0 or Permission Denied", passDeleteReply ? "Blocked (DELETE 0 or Permission Denied)" : "Delete Succeeded", passDeleteReply, deleteReplyBA.stderr);

  // --- 18. CROSS-TENANT LISTS & JUNCTION ISOLATION ---
  const readListBA = runQuery(TENANT_A, `SELECT count(*) FROM lists WHERE id = '${TENANT_B.listId}';`);
  const countListBA = getResultLine(readListBA);
  record("TEST-32", "Tenant A attempts to read Tenant B list", TENANT_A, TENANT_B, "0 rows", `${countListBA} rows`, countListBA === "0");

  const updateListBA = runQuery(TENANT_A, `UPDATE lists SET name = 'HACKED_LIST' WHERE id = '${TENANT_B.listId}';`);
  const passUpdateList = updateListBA.stdout.includes("UPDATE 0") || !updateListBA.ok || updateListBA.stderr.includes("permission denied");
  record("TEST-33", "Tenant A attempts to update Tenant B list", TENANT_A, TENANT_B, "UPDATE 0 or Permission Denied", passUpdateList ? "Blocked (UPDATE 0 or Permission Denied)" : "Update Succeeded", passUpdateList, updateListBA.stderr);

  const injectListJunctionBA = runQuery(TENANT_A, `INSERT INTO list_leads (list_id, lead_id, team_id) VALUES ('${TENANT_B.listId}', '${TENANT_A.lead1Id}', '${TENANT_B.teamId}');`);
  const passInjectList = !injectListJunctionBA.ok && /row-level security/i.test(injectListJunctionBA.stderr);
  record("TEST-34", "Tenant A attempts unauthorized insert into Tenant B list_leads", TENANT_A, TENANT_B, "Blocked by RLS", passInjectList ? "Rejected with RLS policy error" : "INSERT succeeded", passInjectList, injectListJunctionBA.stderr);

  // --- 19. CROSS-TENANT OFFER PROFILES ---
  const readOfferBA = runQuery(TENANT_A, `SELECT count(*) FROM offer_profiles WHERE id = '${TENANT_B.offerId}';`);
  const countOfferBA = getResultLine(readOfferBA);
  record("TEST-35", "Tenant A attempts to read Tenant B offer profile", TENANT_A, TENANT_B, "0 rows", `${countOfferBA} rows`, countOfferBA === "0");

  const updateOfferBA = runQuery(TENANT_A, `UPDATE offer_profiles SET name = 'HACKED_OFFER' WHERE id = '${TENANT_B.offerId}';`);
  record("TEST-36", "Tenant A attempts to update Tenant B offer profile", TENANT_A, TENANT_B, "UPDATE 0", updateOfferBA.stdout, updateOfferBA.stdout.includes("UPDATE 0"));

  // --- 20. CROSS-TENANT TEAM CONFIG (ABOUT & AI) ---
  const readAboutBA = runQuery(TENANT_A, `SELECT count(*) FROM team_about WHERE team_id = '${TENANT_B.teamId}';`);
  const countAboutBA = getResultLine(readAboutBA);
  record("TEST-37", "Tenant A attempts to read Tenant B team_about", TENANT_A, TENANT_B, "0 rows", `${countAboutBA} rows`, countAboutBA === "0");

  const updateAboutBA = runQuery(TENANT_A, `UPDATE team_about SET about = 'HACKED_ABOUT' WHERE team_id = '${TENANT_B.teamId}';`);
  record("TEST-38", "Tenant A attempts to update Tenant B team_about", TENANT_A, TENANT_B, "UPDATE 0", updateAboutBA.stdout, updateAboutBA.stdout.includes("UPDATE 0"));

  const readAiBA = runQuery(TENANT_A, `SELECT count(*) FROM team_ai WHERE team_id = '${TENANT_B.teamId}';`);
  const countAiBA = getResultLine(readAiBA);
  record("TEST-39", "Tenant A attempts to read Tenant B team_ai", TENANT_A, TENANT_B, "0 rows", `${countAiBA} rows`, countAiBA === "0");

  const updateAiBA = runQuery(TENANT_A, `UPDATE team_ai SET business = 'HACKED_AI' WHERE team_id = '${TENANT_B.teamId}';`);
  record("TEST-40", "Tenant A attempts to update Tenant B team_ai", TENANT_A, TENANT_B, "UPDATE 0", updateAiBA.stdout, updateAiBA.stdout.includes("UPDATE 0"));

  // --- 21. CROSS-TENANT TELEMETRY (DOMAIN MONITOR) ---
  const readDomainBA = runQuery(TENANT_A, `SELECT count(*) FROM domain_monitor WHERE team_id = '${TENANT_B.teamId}';`);
  const countDomainBA = getResultLine(readDomainBA);
  record("TEST-41", "Tenant A attempts to read Tenant B domain_monitor", TENANT_A, TENANT_B, "0 rows", `${countDomainBA} rows`, countDomainBA === "0");

  // --- 22. SENSITIVE CREDENTIAL DEFAULT-DENY (RLS / PRIVILEGE ENFORCEMENT) ---
  const readTeamKeys = runQuery(TENANT_A, `SELECT count(*) FROM team_keys;`);
  const passKeys = !readTeamKeys.ok || readTeamKeys.stdout.includes("ERROR") || getResultLine(readTeamKeys) === "0";
  record("TEST-42", "Direct read rejection on sensitive credentials table team_keys", TENANT_A, TENANT_A, "Access denied / default-deny", passKeys ? "Rejected with permission error or 0 rows" : "Data exposed", passKeys, readTeamKeys.stderr);

  const readLemonSettings = runQuery(TENANT_A, `SELECT count(*) FROM lemon_settings;`);
  const passLemon = !readLemonSettings.ok || readLemonSettings.stdout.includes("ERROR") || getResultLine(readLemonSettings) === "0";
  record("TEST-43", "Direct read rejection on billing secrets table lemon_settings", TENANT_A, TENANT_A, "Access denied / default-deny", passLemon ? "Rejected with permission error or 0 rows" : "Data exposed", passLemon, readLemonSettings.stderr);

  // Summary
  console.log("\n================================================================================");
  const totalPassed = results.filter((r) => r.pass).length;
  console.log(`MULTI-TENANT TEST RESULTS: ${totalPassed} / ${results.length} PASSED`);
  console.log("================================================================================");

  // Clean up test fixtures after run
  cleanupMultiTenant();

  return { total: results.length, passed: totalPassed, results };
}

if (process.argv[1]?.endsWith("verify-multitenant-isolation.mjs")) {
  runAllTests().then((res) => {
    if (res.passed !== res.total) process.exit(1);
  });
}
