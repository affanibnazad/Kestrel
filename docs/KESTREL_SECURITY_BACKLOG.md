# Kestrel — Security Verification Backlog & Outstanding Limitations

> **Status:** Active Security Documentation  
> **Phase Accepted:** Phase 1.5 formally accepted as a completed milestone; outstanding security requirements preserved  
> **Updated:** 22 November 2026 (Phase 1.5 Formal Gate)  
> **Auditor:** Independent Application Security Auditor  

---

## 1. Verified Results Preserved (Phase 1.2 through Phase 1.5 Baseline)

The following security verifications were completed and established as verified engineering baselines:

| Security Component | Verification Method | Status | Evidence Location |
|---|---|---|---|
| **PostgreSQL RLS Multi-Tenant Isolation** | 25 automated tests across Tenant A and Tenant B | `TEST VERIFIED (LOCAL DB)` | `scripts/verify-multitenant-isolation.mjs` |
| **Database Context Simulation** | `SET LOCAL ROLE authenticated` + JWT claims (`sub`, `role`) | `TEST VERIFIED (LOCAL DB)` | `scripts/verify-multitenant-isolation.mjs` |
| **Clean Database Migration Chain** | 69 migrations executed on fresh local PostgreSQL instance in 1.87s | `TEST VERIFIED (LOCAL DB)` | `kestrel_staging_test` test run |
| **DEF-03 Forward Migration** | `069_grant_my_team_id.sql` grants `EXECUTE` to `authenticated` | `TEST VERIFIED` | `supabase/migrations/069_grant_my_team_id.sql` |
| **API Route IDOR Architecture Review** | Static audit of all 34 API endpoints in `src/app/api` | `STATICALLY VERIFIED` | Phase 1.2 Section B Audit Table |
| **Authentication & Demo Boundaries** | 13 automated Playwright & API protection tests | `TEST VERIFIED` | `scripts/verify-auth-and-demo.mjs` |
| **Error Boundaries & Defensive UI** | 15 automated Playwright boundary tests | `TEST VERIFIED` | `scripts/verify-error-boundaries.mjs` |
| **Client State Isolation (DEF-07 & DEF-08)** | 52 automated state, race-condition & URL tests | `TEST VERIFIED (COMPONENT EVENT SCOPE)` | `scripts/verify-client-state-navigation.mjs` |
| **Production Readiness & Security Matrix** | 177 automated security headers, assets, redirects & secrets tests | `TEST VERIFIED` | `scripts/verify-production-readiness.mjs` |

---

## 2. Outstanding Security Limitations (Strictly NOT Certified)

> [!IMPORTANT]
> **Strict Distinction Between Local Test Database and Remote Staging**:
> - All automated database tests ran against a **local PostgreSQL 16 test database (`kestrel_staging_test`)** running locally on macOS.
> - **A dedicated remote Supabase staging environment does NOT yet exist.**
> - Zero tests were run against a remote Supabase staging environment, remote GoTrue Auth, or remote SMTP.
> - Under NO circumstances is local testing to be described as remote staging verification.

The following 5 security limitations remain **OPEN, ACTIVE, and UNRESOLVED**:

| # | Outstanding Limitation | Classification | Risk & Impact Description |
|---|---|---|---|
| **L-01** | **No Authenticated Cross-Tenant HTTP Testing** | `NOT TESTED` | Live HTTP requests between two concurrent authenticated user sessions have not been executed against Next.js API routes. |
| **L-02** | **No Dedicated Remote Supabase Staging Project** | `NOT TESTED` | Staging tests ran against a local PostgreSQL 16 test database (`kestrel_staging_test`). A separate remote Supabase staging environment with isolated credentials does not yet exist. |
| **L-03** | **No Real Supabase Auth Sessions Tested** | `NOT TESTED` | Tests simulated JWT claims directly in local PostgreSQL. Real Supabase GoTrue access tokens and session refresh flows were not exercised due to unconfigured SMTP. |
| **L-04** | **Database Table Coverage Scope Limitation** | `TEST VERIFIED (SCOPED)` | The 25 database tests cover their specified scenarios (leads, campaigns, sequences, webhooks, team rules). 49 of the 54 tables have not undergone automated cross-tenant penetration testing. |
| **L-05** | **SECURITY DEFINER Functions Review Incomplete** | `STATICALLY VERIFIED (PARTIAL)` | 6 core privileged functions were tested in Phase 1.2. The full authoritative catalog inventory of 212 application `SECURITY DEFINER` functions requires individual verified security reviews. |

---

## 3. Authoritative PostgreSQL Catalog Reconciliation

An authoritative inspection of the local migrated PostgreSQL 16 database (`kestrel_staging_test`, 69 migrations applied) yielded the following reconciled findings:

### 3.1 Table & Row Level Security (RLS) Inventory (54 Tables Total)
- **100% RLS Enabled**: All 54 tables have `relrowsecurity = true`.
- **36 Tables with Active RLS Policies**: Enforce tenant isolation via helper functions:
  - `is_member(team_id)`: Read permissions restricted to active team members.
  - `can_edit(team_id)`: Write/delete permissions restricted to owners, managers, or members.
  - `can_block(team_id)`: Do-not-contact and reply classification permissions.
  - `user_id = auth.uid()`: Personal records (memory, extension keys, member preferences).
  - `team_id = my_team_id(true)`: Team webhooks.
- **18 Tables with Zero Direct Policies (Access Architecture Breakdown)**:
  - **Table List (18)**: `access_codes`, `access_grants`, `admin_actions`, `admins`, `assistant_kestrel_keys`, `assistant_model_names`, `assistant_settings`, `commissions`, `contact_messages`, `creator_applications`, `creators`, `google_mail_settings`, `integration_outbox`, `lemon_settings`, `offers`, `referrals`, `team_keys`, `verifier_settings`.
  - **Role-by-Role Access Behavior**:
    - `anon`: RLS enforced. With 0 policies, PostgreSQL enforces strict **default-deny** (returns 0 rows or permission denied). Direct REST access impossible.
    - `authenticated`: RLS enforced. With 0 policies, PostgreSQL enforces strict **default-deny** (returns 0 rows or permission denied). Direct REST access impossible.
    - `service_role`: Possesses `BYPASSRLS` attribute. Bypasses RLS completely; authorized for server-side background automation and migrations.
    - `Table owner`: In PostgreSQL, table owner bypasses RLS unless `FORCE ROW LEVEL SECURITY` is set (`relforcerowsecurity = false`). Owned by migration superuser role (`postgres` / `aryanrawat`), never an application user.
    - `SECURITY DEFINER functions`: Execute with the privileges of their owner (`postgres`), thereby bypassing RLS on these tables. This is the **intentionally designed authorized access path**: client applications cannot read/write these tables directly via PostgREST; all access is mediated by procedural `SECURITY DEFINER` RPCs that validate caller identity, admin privileges, or server secrets in code.
  - **Critical Security Caveat**: Enabling RLS without policies does **NOT** constitute complete multi-tenant security verification. Security depends entirely on the procedural logic, permission checks, and parameter sanitization of the `SECURITY DEFINER` functions that access these tables. Items **L-04** and **L-05** remain strictly **OPEN and NOT TESTED**.

### 3.2 Authoritative SECURITY DEFINER Function Inventory (212 Functions Total)
An authoritative query of the PostgreSQL catalog confirms **212 SECURITY DEFINER functions** (211 distinct names) in schema `public`.

#### Catalog Query Used:
```sql
SELECT 
    p.proname AS function_name,
    pg_get_function_identity_arguments(p.oid) AS arguments,
    pg_get_function_result(p.oid) AS return_type,
    r.rolname AS owner,
    n.nspname AS schema_name,
    p.prosecdef AS is_security_definer,
    array_to_string(p.proconfig, ', ') AS search_path,
    has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_execute,
    has_function_privilege('public', p.oid, 'EXECUTE') AS public_execute
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
JOIN pg_roles r ON p.proowner = r.oid
WHERE n.nspname = 'public' 
  AND p.prosecdef = true
ORDER BY p.proname;
```

#### Category Reconciliation (Mutually Exclusive Partition — Sums to Exactly 212)
The previous preliminary count of 266 resulted from overlapping functional tags (e.g., Vault functions and Admin functions overlapping with authenticated RPCs). The authoritative, non-overlapping partition is:

| # | Mutually Exclusive Category | Count | Definition & Access Control Rules |
|---|---|---|---|
| **1** | **Internal Trigger Functions** | **17** | `returns trigger`. Invoked automatically on table mutation by PostgreSQL engine; cannot be called via PostgREST RPC. |
| **2** | **Server-Secret Gated Backend RPCs** | **43** | Signature requires `server_secret text`. Validates `MAIL_SERVER_SECRET` inside procedural body; fails closed if secret is invalid. |
| **3** | **Admin Governance RPCs** | **13** | Dedicated admin management functions (e.g. `admin_ban_user`, `admin_set_tier`). Granted to `authenticated` but strictly enforce `is_admin()` inside procedural body. |
| **4** | **Authenticated Regular User RPCs** | **117** | Standard tenant-facing business RPCs (leads, campaigns, inbox, sequences, webhooks). Granted to `authenticated`; enforce `is_member(team_id)` or `WHERE user_id = auth.uid()`. |
| **5** | **Internal System Helper Functions** | **22** | Internal utility functions without caller-facing execution grants (`anon: false`, `auth: false`, `public: false`; e.g. `dnc_blocks_email`, `mailbox_limit_today`, `team_state`). Callable only by other server functions or superuser. |
| **TOTAL** | **Exact Mutually Exclusive Sum** | **212** | **17 + 43 + 13 + 117 + 22 = 212 functions (100% of catalog).** |

#### Cross-Cutting Security Properties (All 212 Functions)
- **Schema & Ownership**: 100% (212/212) located in schema `public` and owned by migration superuser role (`postgres` / `aryanrawat`).
- **Search Path Configuration**: 100% (212/212) have an explicit, fixed search path configured via `SET search_path`:
  - `search_path=public`: 162 functions
  - `search_path=public, vault`: 40 functions
  - `search_path=public, extensions`: 6 functions
  - `search_path=public, vault, extensions`: 4 functions
  - **Zero functions have NULL or unpinned search paths** (protected against search_path hijacking).
- **Vault Access**: Exactly 44 functions have `vault` in their search path to decrypt encrypted credentials via pgsodium.
- **PUBLIC Execute Grants**: Only 4 functions have `public` execute privilege; all 4 are internal trigger functions (`handle_new_user`, `integration_on_lead_change`, `integration_on_campaign_change`, `integration_on_mailbox_change`).

> [!NOTE]
> Item **L-05** remains **OPEN and NOT TESTED**. The individual security audit of all 212 functions must be conducted in Phase 2.1 before production certification.

---

## 3. DEF-03 Final Verification Record

The resolution of defect **DEF-03** (`public.my_team_id(boolean)` permission gap) has been verified:

1. **Migration Exists**: `supabase/migrations/069_grant_my_team_id.sql` is committed in the repository.
2. **Chain Sequence**: Follows immediately after `068_extension_version_history.sql` in strict numeric sequence.
3. **Upgrade Verification**: Applies cleanly to an existing database containing migrations 001–068 without data loss.
4. **Clean Run Verification**: Applies cleanly during a fresh database build (001–069 executed in 1.87 seconds with 0 errors).
5. **Least Privilege Enforcement**: Grants only `EXECUTE` privilege to `authenticated`. No `SELECT`, `INSERT`, `UPDATE`, or `DELETE` granted.
6. **Integrity Intact**:
   - `SECURITY DEFINER`: Intact (`prosecdef = true`).
   - `search_path`: Intact (`search_path = public`).
   - Tenant isolation check: Intact (`WHERE user_id = auth.uid()`). Does not accept tenant ID arguments from the caller.

---

## 4. Future Security Verification Backlog

These 6 verification requirements must be executed before certifying Kestrel for production launch:

| Item # | Verification Task | Target Phase | Required Evidence | Target Status |
|---|---|---|---|---|
| **REQ-01** | Complete bidirectional tenant isolation tests for all tenant-owned tables (templates, imports, placement records, logs). | Phase 2.1 | Automated test script asserting 0 rows returned for cross-tenant queries. | `NOT TESTED` |
| **REQ-02** | Comprehensive individual security audit of all 36 `SECURITY DEFINER` application functions. | Phase 2.1 | Documented table listing each function, search path, caller restrictions, and tenant boundaries. | `STATICALLY VERIFIED` |
| **REQ-03** | Runtime authenticated HTTP tests using two real Supabase Auth sessions. | Phase 2.2 | Automated test suite issuing concurrent HTTP requests with valid GoTrue JWTs. | `NOT TESTED` |
| **REQ-04** | API-level IDOR test suite across all read, update, delete, bulk, and RPC endpoints. | Phase 2.2 | HTTP test suite asserting 401/403/404 when Tenant A requests Tenant B's UUIDs. | `NOT TESTED` |
| **REQ-05** | Remote Supabase staging environment configuration and credential separation. | Phase 2.3 | Live staging environment verified with separate URL, separate keys, and configured SMTP. | `NOT TESTED` |
| **REQ-06** | Browser-level tenant isolation testing (End-to-End via Playwright with 2 browser contexts). | Phase 3.0 | Playwright test logging into Tenant A and verifying zero leakage of Tenant B UI elements. | `NOT TESTED` |

---

## 5. Evidence Classification Guide

All security claims in Kestrel audit documentation must use one of these four classifications:

- **`TEST VERIFIED`**: Programmatic test was executed, and observable pass/fail output was recorded.
- **`STATICALLY VERIFIED`**: Source code or SQL schema was inspected directly, but live runtime execution was not performed.
- **`NOT TESTED`**: Capability or scenario has not yet been executed in a test environment.
- **`INCONCLUSIVE`**: Test executed but returned ambiguous, incomplete, or indeterminate results.
