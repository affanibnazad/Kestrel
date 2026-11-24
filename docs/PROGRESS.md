# Kestrel — Project Progress & Verified Test Baseline

> **Status:** Authoritative Progress Tracker & Verified Test Baseline  
> **Last Updated:** 23 November 2026 (r8 Documentation Consolidation & Design Lock)  
> **Environment:** Staging Verified (`.env.staging.local` → Supabase `xjqtgvhnbyepfinqonzm`)  
> **Database:** 80 Migrations Applied Cleanly  

---

## 1. Current Verified Test Suites

All tests run against real staging data with zero mocks or route intercepts.

| Test Suite | Command | What It Verifies | Verified Count | Status |
|---|---|---|---|---|
| **Authentication & Demo Safeguards** | `npm run test:auth` | Login redirects, protected `/app` boundaries, open-redirect prevention, explicit demo isolation (`?demo=true`), 401 unauthenticated API rejection. | **13 / 13 Passed** | **PASS** |
| **Playwright UI/UX Baseline** | `npm run test:all` | Flat minimalist layout, 100% rounded pills, capsule toggles, theme switching, sidebar resize/rail, single outer outlines, Owner admin live tiles. | **26 / 26 Passed** | **PASS** |
| **QC Review Suite** | `node scripts/verify-qc-review.mjs` | First-line inbox snippets, zero demo attachments, user menu popup in collapsed rail, admin vs non-admin route guards, campaign card layout. | **13 / 13 Passed** | **PASS** |
| **TypeScript Typecheck** | `npx tsc --noEmit` | Strict TypeScript types across all source files. | **0 Errors** | **PASS** |
| **ESLint Validation** | `npm run lint` | Next.js and React ESLint rules. | **0 Warnings / 0 Errors** | **PASS** |
| **Production Build** | `npm run build` | Next.js Turbopack optimized production build (92 static & dynamic routes). | **Compiled in 6.5s** | **PASS** |

---

## 2. Infrastructure & Database Status

| Component | Status | Details |
|---|---|---|
| **Migrations** | **80 Migrations** | `001_initial_schema.sql` through `080_...sql` in `supabase/migrations/`. |
| **Remote Staging Project** | **Active** | Remote Supabase staging instance `xjqtgvhnbyepfinqonzm` with verified test users and admin role. |
| **Multi-Tenant RLS** | **100% Enforced** | 54 tables with Row Level Security. Cross-tenant access blocked. |
| **Admin Role Isolation** | **Verified (A1)** | Platform admin (`staging-admin@kestrelleads.com`) accesses Owner portal; regular users are redirected to Home. |

---

## 3. Parked Features (r9 Complete)

In accordance with r9, parked features have been moved out of the active user interface:
- **Standalone AI Chat**: Moved from `src/app/kestrel-ai-chat/` to `parked/kestrel-ai-chat/` (kept in git). Route redirects to `/`.
- **Direct Send**: "Write Email" button and unprompted direct composition pane hidden from Replies (`inbox-view.tsx`).
- **Desktop Connect App**: `.dmg`/`.exe` download card hidden in Integrations (`mcp-view.tsx`). Direct terminal MCP instructions kept.
- **Autopilot (Automations)**: Sidebar nav hidden; `/app?view=autopilot` redirects to Home; `/api/autopilot/tick` returns 404.
- **Database Tables**: All related database tables stay intact. Zero tables dropped.

---

## 4. Documentation Reorganization (r8 Complete)

- Single source of truth per topic: `docs/DESIGN.md`, `docs/PROGRESS.md`, `docs/BLUEPRINT.md`.
- Legacy and duplicate audit files preserved in `docs/archive/`.
- Universal developer rules and boundaries maintained in `AGENTS.md`.

---

## 5. UI Polish List

Pending visual polish items approved for future iteration:
- **Service Catalog Group Spacing**: 16px gap between field groups in Service Catalog (`about-view.tsx`).
- **Service Catalog Section Titles**: Bigger, more distinct section title typography.
- **Proof Row Inputs**: Wider proof row inputs (text is currently cut off in client/result inputs).

