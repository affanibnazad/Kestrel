# KESTREL — Known Issues, Technical Debt & Outstanding Limitations

> **Repository:** https://github.com/affanibnazad/Kestrel  
> **Prepared For:** Independent Technical Audit (ChatGPT)  
> **Date:** 22 November 2026  
> **Classification:** Known Issues & Technical Debt Registry  

---

## 1. Outstanding Security Limitations (L-01 through L-05)

From the authoritative project records (`docs/KESTREL_SECURITY_BACKLOG.md`), the following 5 security limitations remain **OPEN, ACTIVE, and UNRESOLVED**:

| Limitation ID | Description | Classification | Current State & Impact |
|---|---|---|---|
| **L-01** | **No Authenticated Cross-Tenant HTTP Testing** | `NOT TESTED` | Live HTTP requests between two concurrent authenticated user sessions have not been executed against Next.js API routes. Testing has only validated PostgreSQL RLS directly. |
| **L-02** | **No Dedicated Remote Supabase Staging Project** | `NOT TESTED` | Staging tests ran against a local PostgreSQL 16 test database (`kestrel_staging_test`). A separate remote Supabase staging environment with isolated credentials does not yet exist. |
| **L-03** | **No Real Supabase Auth Sessions Tested** | `NOT TESTED` | Tests simulated JWT claims directly in local PostgreSQL. Real Supabase GoTrue access tokens and session refresh flows were not exercised due to unconfigured SMTP. |
| **L-04** | **Database Table Coverage Scope Limitation** | `TEST VERIFIED (SCOPED)` | The 25 database tests cover their specified scenarios (leads, campaigns, sequences, webhooks, team rules). 49 of the 54 tables have not undergone automated cross-tenant penetration testing. |
| **L-05** | **SECURITY DEFINER Functions Review Incomplete** | `STATICALLY VERIFIED (PARTIAL)` | 6 core privileged functions were tested in Phase 1.2. The full authoritative catalog inventory of 212 application `SECURITY DEFINER` functions requires individual verified security reviews. |

---

## 2. Environment & Dependency Issues

### 2.1 Missing Playwright Dependency in Local `node_modules`
- **Symptom**: Executing `npm run test:auth`, `npm run test:errors`, or `npm run test:navigation` fails with `ERR_MODULE_NOT_FOUND: Cannot find package 'playwright'`.
- **Status**: `OPEN` (Identified during Audit Preparation).
- **Impact**: Automated browser-level integration testing cannot run locally until `playwright` dependencies are installed.

### 2.2 ESLint Unused Variable Warning
- **Symptom**: Running `npm run lint` generates 1 warning:
  `src/app/app/shell.tsx:150:9 - warning 'router' is assigned a value but never used @typescript-eslint/no-unused-vars`.
- **Status**: `OPEN` (Preserved without modification per audit rules).
- **Impact**: Purely cosmetic; does not prevent compilation or execution.

---

## 3. Architecture & Functional Limitations

### 3.1 Background Email Sending Requires External Crons
- **Description**: Scheduled email sends and warmup ticks are driven by `/api/mail/tick`.
- **Limitation**: Next.js route handlers are serverless and do not run a continuous internal daemon. An external cron trigger (e.g. Vercel Cron, Google Cloud Scheduler, or local curl script) must ping `/api/mail/tick` on a cadence for outbound email processing to occur.
- **Status**: `UNVERIFIED IN REMOTE PRODUCTION`.

### 3.2 AI Chat Multi-Turn State Persistence
- **Description**: The embedded Kestrel AI chat component (`assistant-chat.tsx`) stores conversational turns in browser `localStorage` (`kestrel-ai-chat-v1`).
- **Limitation**: Chat conversation history is client-scoped to the device browser and is not currently persisted to PostgreSQL across different machines.
- **Status**: `DOCUMENTED ARCHITECTURAL LIMITATION`.

### 3.3 Offline Synthetic Data Fallback
- **Description**: When navigating the application with `?preview=1` or when Supabase credentials are not supplied, the application loads mock data (`demoLeads()`).
- **Limitation**: While useful for design inspection, mock mode bypasses real database error states and network latencies.
- **Status**: `DOCUMENTED WORKAROUND`.

---

## 4. Historical Defect Status Summary

| Defect ID | Historical Issue | Resolution State in Code |
|---|---|---|
| **DEF-01** | Unhandled view exceptions caused white-screen app crash | **RESOLVED**: `ViewErrorBoundary` implemented in `src/components/view-error-boundary.tsx` and wrapped around all views in `src/app/app/shell.tsx`. |
| **DEF-02** | Stale lead and campaign data leaked across fast team switches | **RESOLVED**: Generation counters (`reqGenRef`) and team reference guards implemented in `campaigns-view.tsx`, `inbox-view.tsx`, and `sequences-view.tsx`. |
| **DEF-03** | RLS policy permission denied error on `public.my_team_id` | **RESOLVED**: Migration `069_grant_my_team_id.sql` committed and applied, granting `EXECUTE` on `my_team_id(boolean)` to `authenticated`. |
| **DEF-04** | Unauthenticated `/app` allowed mock access without login redirect | **RESOLVED**: Auth guard implemented in `src/app/app/page.tsx` redirecting unauthenticated users to `/login?next=...` unless explicit `?preview=1` or `?demo=1` is provided. |
