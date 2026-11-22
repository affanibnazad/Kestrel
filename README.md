# Kestrel — Client Intelligence & Outreach Platform

> **Founder & Content Strategist:** Affan Ibn Azad (Norven Studio)  
> **Technical Stack:** Next.js 16.4.6 (Turbopack) | React 19.3.0 | TypeScript 5 | Supabase PostgreSQL 16 | Tailwind CSS v4 | Playwright  
> **Status:** Phase 1.5 Production Readiness Baseline Accepted | Outstanding Security Verification Requirements Active in Backlog  
> **Reported Test Execution:** 308 / 308 Automated Tests Passed | 0 TypeScript Errors | 0 Lint Warnings | 93 / 93 Statically Compiled Routes  

---

## 1. Project Overview

Kestrel is a service-agnostic **Client Intelligence & Outreach Platform** developed by **Norven Studio**. It is engineered to discover target businesses, analyze website signals with evidence, verify deliverability, craft hyper-personalized outreach sequences, and manage multi-channel campaign pipelines.

### Core Architectural Principles
1. **Evidence Over Hallucinated Insight**: Recommendations and outreach drafts must cite direct observations (website copy, technology tags, hiring signals) with verified source URLs and timestamps.
2. **Capability Truthfulness**: AI generates copy strictly from configured service proof points without inventing team members, case studies, or unverified claims.
3. **Strict Multi-Tenant Isolation**: Multi-tenant database boundary enforced via PostgreSQL Row Level Security (RLS) across all 54 database tables.
4. **Defensive UI & Error Containment**: Modular view-level error boundaries (`ViewErrorBoundary`) isolate view crashes without degrading sidebar navigation or global application shell state.
5. **Flat Minimalist Design System**: Strictly adheres to Norven Studio's verified design language (Apple SF Pro typography, capsule toggles, 100% rounded pill buttons, zero floating shadows, four themes, single outer outlines).

---

## 2. Technical Architecture

```
                  ┌──────────────────────────────────────────────┐
                  │                Client Layer                  │
                  │  Next.js 16.4 App Router / React 19 / CSS v4 │
                  │  - Modular Shell (src/app/app/shell.tsx)     │
                  │  - 14 Modular Views (Leads, Campaigns, etc.) │
                  │  - ViewErrorBoundary & Generation Guards     │
                  └──────────────────────┬───────────────────────┘
                                         │ HTTP / Server Actions / Proxy
                                         ▼
                  ┌──────────────────────────────────────────────┐
                  │             Server & API Layer               │
                  │  34 Next.js Serverless Route Handlers        │
                  │  - Auth Guard & SSRF Protection (proxy.ts)   │
                  │  - Mail Sending Engine (Nodemailer/ImapFlow) │
                  │  - AI Gateway (Anthropic/Gemini/OpenAI)      │
                  │  - Rate Limiting & HMAC Signature Validation │
                  └──────────────────────┬───────────────────────┘
                                         │ PostgreSQL Session (RLS)
                                         ▼
                  ┌──────────────────────────────────────────────┐
                  │           Database Layer (Supabase)          │
                  │  54 Tables (100% RLS Enabled)                │
                  │  - 36 Tables with Active Tenant Policies     │
                  │  - 18 Tables Default-Deny (Zero Policies)    │
                  │  - 212 SECURITY DEFINER RPCs (search_path)   │
                  │  - 69 Sequential SQL Migrations              │
                  └──────────────────────────────────────────────┘
```

### Key Directories
- `src/app/`: Next.js App Router entry points, marketing pages, legal pages, and 34 serverless API route handlers (`src/app/api/`).
- `src/app/app/`: Modular view components (`shell.tsx`, `campaigns-view.tsx`, `leads-view.tsx`, `inbox-view.tsx`, `pipeline-view.tsx`, etc.).
- `src/lib/`: Core business logic modules (`campaign.ts`, `inbox.ts`, `leads.ts`, `site-read.ts`, `scoring.ts`, `lemon.ts`, `assistant.ts`).
- `supabase/migrations/`: All 69 sequential database migrations (`001_accounts.sql` through `069_grant_my_team_id.sql`).
- `scripts/`: 6 portable automated test suites (308 tests total) and administration utilities.
- `docs/`: Technical audit documentation (`KESTREL_BLUEPRINT.md`, `KESTREL_PROGRESS.md`, `KESTREL_SECURITY_BACKLOG.md`).
- `page-rules/`: Design and layout rules for every individual view.

---

## 3. Installation & Local Setup

### Prerequisites
- **Node.js**: `v20.x` or later
- **npm**: `v10.x` or later
- **PostgreSQL**: `v15.x` or `v16.x` (or Supabase local/remote instance)
- **Chromium**: Required for Playwright automated UI verification

### Step-by-Step Setup

1. **Clone the repository:**
   ```bash
   git clone git@github.com:affanibnazad/Kestrel.git
   cd Kestrel
   ```

2. **Install project dependencies:**
   ```bash
   npm install
   ```

3. **Install Playwright Chromium browser:**
   ```bash
   npx playwright install chromium
   ```

4. **Configure environment variables:**
   ```bash
   cp .env.example .env.local
   # Edit .env.local with your Supabase credentials and internal server secrets
   ```

5. **Start the local Next.js development server:**
   ```bash
   npm run dev
   ```
   The application will start on `http://localhost:3333`.

---

## 4. Environment Variables Reference

All configurable environment variables are documented in `.env.example`. Real credentials must **never** be committed to Git.

| Variable | Scope | Required | Description |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Client & Server | **Yes** | HTTPS URL of your Supabase project (e.g. `https://xyz.supabase.co`). |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Client & Server | **Yes** | Supabase publishable key (starts with `sb_publishable_`) or legacy anon key. |
| `MAIL_SERVER_SECRET` | Server-Only | **Yes** | 32+ character random secret used to authenticate internal Next.js calls to Supabase RPCs. |
| `RESEND_API_KEY` | Server-Only | Optional | Resend API key for delivering contact form messages via `/api/contact`. |
| `CONTACT_INBOX` | Server-Only | Optional | Email address where contact form submissions are delivered. |
| `ANTHROPIC_API_KEY` | Server-Only | Optional | Fallback Anthropic Claude key for AI features. Teams can configure their own keys in UI. |
| `VERIFIER_URL` | Server-Only | Optional | External SMTP email verification endpoint. |
| `VERIFIER_SECRET` | Server-Only | Optional | Shared token for external email verifier server. |
| `NEXT_PUBLIC_SENTRY_DSN` | Client & Server | Optional | Sentry monitoring DSN for runtime telemetry. |

---

## 5. Database Schema & Migration Instructions

Kestrel requires a strict chain of **69 sequential SQL migrations** located in `supabase/migrations/`.

### Migration Chain Details
- **Migration Count:** 69 migrations (`001_accounts.sql` through `069_grant_my_team_id.sql`).
- **Clean Execution Time:** ~1.87 seconds on a clean local PostgreSQL 16 database with 0 errors.
- **DEF-03 Resolution:** Migration `069_grant_my_team_id.sql` explicitly grants `EXECUTE` on `public.my_team_id(boolean)` to role `authenticated`, closing the permission gap without altering RLS security boundaries.

### Applying Migrations via Supabase CLI
```bash
# If using local Supabase CLI:
supabase db reset
# Or push to remote project:
supabase db push
```

### Table & Row Level Security (RLS) Breakdown
- **100% RLS Enabled:** All 54 tables have `relrowsecurity = true`.
- **36 Tables with Active Policies:** Enforce tenant isolation via helper functions:
  - `is_member(team_id)`: Restricts read access to active team members.
  - `can_edit(team_id)`: Restricts write/delete access to owners, managers, or members.
  - `can_block(team_id)`: Governs do-not-contact and reply classification.
  - `user_id = auth.uid()`: Protects personal preferences and extension keys.
  - `team_id = my_team_id(true)`: Restricts team webhooks.
- **18 Tables Default-Deny (Zero Direct Policies):**  
  Tables: `access_codes`, `access_grants`, `admin_actions`, `admins`, `assistant_kestrel_keys`, `assistant_model_names`, `assistant_settings`, `commissions`, `contact_messages`, `creator_applications`, `creators`, `google_mail_settings`, `integration_outbox`, `lemon_settings`, `offers`, `referrals`, `team_keys`, `verifier_settings`.  
  Direct REST queries by `anon` or `authenticated` return 0 rows (default-deny). Access is mediated exclusively by privileged `SECURITY DEFINER` RPCs that validate caller authorization in procedural code.

### SECURITY DEFINER Function Inventory (212 Functions)
An authoritative query of PostgreSQL catalog `pg_proc` in schema `public` confirms 212 functions with `prosecdef = true`:
- **Mutually Exclusive Categories:**
  - Internal Triggers (`returns trigger`): **17**
  - Server-Secret Gated Backend RPCs (`server_secret text`): **43**
  - Admin Governance RPCs (`is_admin()` check): **13**
  - Authenticated Regular User RPCs (`is_member(team_id)`): **117**
  - Internal Helper Functions (no public caller grants): **22**
  - **Total: 212 functions (17 + 43 + 13 + 117 + 22 = 212)**
- **Search Path Configuration:** 100% (212 / 212) have an explicit fixed `search_path` configured (162 `public`, 40 `public, vault`, 6 `public, extensions`, 4 `public, vault, extensions`, 0 unpinned/NULL).

---

## 6. API Route Handlers

Kestrel includes **34 server-side route handlers** under `src/app/api/`:

| Route | Methods | Authentication | Description |
|---|---|---|---|
| `/api/contact` | POST | Public (CSRF/Rate-limited) | Submits contact inquiries to `CONTACT_INBOX`. |
| `/api/ai` | POST | Authenticated Session | AI fit-scoring and structured recommendation generation. |
| `/api/assistant` | POST | Authenticated Session | Natural language tool-calling assistant engine. |
| `/api/autopilot/tick` | POST | Server Secret | Automated find → score → write loop runner. |
| `/api/mail/tick` | POST | Server Secret | High-throughput email dispatch runner with rate-limiting. |
| `/api/mail/suggest` | POST | Authenticated Session | Contextual reply suggestion generator. |
| `/api/mail/placement` | POST / GET | Authenticated Session | SPF/DKIM/DMARC deliverability diagnostic tool. |
| `/api/mail/blacklist` | POST | Authenticated Session | Domain and IP reputation monitor. |
| `/api/verify` | POST | Authenticated Session | Email syntax, MX record, and SMTP mailbox verification. |
| `/api/spam/fix` | POST | Authenticated Session | Spam-word detector and email deliverability optimizer. |
| `/api/billing/checkout`| POST | Authenticated (Owner Only)| Lemon Squeezy checkout session generator. |
| `/api/billing/webhook` | POST | Lemon Squeezy HMAC | Webhook listener for subscription activations/cancellations. |
| `/api/owner/offers` | GET / POST | Authenticated (Admin) | Platform offer creation and tier management. |
| `/connect/update` | GET | Signed Token | Version check and auto-updater for Kestrel Connect desktop bridge. |
| `/app/download/[file]` | GET | Authenticated Session | Protected asset downloader with path traversal protection. |

---

## 7. Testing & Quality Verification Suite

Kestrel includes **6 portable automated test suites** covering 308 verification points. All tests execute with zero machine-specific path dependencies.

### Automated Test Scripts

Run each suite via npm:

```bash
# 1. Authentication & Demo Mode Boundaries (13 tests)
npm run test:auth

# 2. PostgreSQL RLS Multi-Tenant Isolation (25 tests)
npm run test:multitenant

# 3. ViewErrorBoundary & Defensive UI (15 tests)
npm run test:errors

# 4. Core UI/UX, Design Rules & Layout (26 tests)
npm run test:all

# 5. Client State, Navigation & Race Conditions (52 tests)
npm run test:navigation

# 6. Production Readiness, Security Headers & Assets (177 tests)
npm run test:readiness

# Run all 308 tests sequentially:
npm run test:full
```

### Static Analysis & Build Verification
```bash
# TypeScript compiler check (0 errors)
npx tsc --noEmit

# ESLint code style check (0 warnings)
npm run lint

# Production Next.js Turbopack compilation (93/93 pages compiled)
npm run build
```

---

## 8. Current Development Phase & Outstanding Security Backlog

> [!IMPORTANT]
> **Independent Audit Notice:**  
> Kestrel is currently accepted as a **Phase 1.5 engineering development baseline**.  
> The 308 passing automated tests demonstrate local component health, layout compliance, and database RLS policy logic under local simulation. They do **not** constitute external production certification.

The following **5 security limitations** are preserved in `docs/KESTREL_SECURITY_BACKLOG.md` and remain **OPEN, ACTIVE, and UNRESOLVED**:

| # | Limitation | Classification | Description & Planned Resolution |
|---|---|---|---|
| **L-01** | **No Authenticated Cross-Tenant HTTP Testing** | `NOT TESTED` | Live concurrent HTTP requests across two separate authenticated team sessions against Next.js API routes must be executed. |
| **L-02** | **No Dedicated Remote Supabase Staging Project** | `NOT TESTED` | Staging tests ran against a local PostgreSQL 16 database (`kestrel_staging_test`). A dedicated remote Supabase project with isolated secrets has not yet been deployed. |
| **L-03** | **No Real Supabase Auth Sessions Tested** | `NOT TESTED` | Tests simulated JWT claims via PostgreSQL session variables. Live Supabase GoTrue access tokens and session refresh flows were not exercised due to unconfigured SMTP. |
| **L-04** | **Database Table Coverage Scope Limitation** | `TEST VERIFIED (SCOPED)` | The 25 database tests cover their specified scenarios (leads, campaigns, sequences, webhooks, team rules). 49 of the 54 tables have not undergone automated cross-tenant penetration testing. |
| **L-05** | **SECURITY DEFINER Functions Audit Incomplete** | `STATICALLY VERIFIED (PARTIAL)` | While search paths and categories have been reconciled, an individual procedural security review of all 212 functions must be completed in Phase 2.1 before production deployment. |

---

## 9. Design System Rules (Norven Studio Standard)

Every UI modification must comply with the Norven Studio design rules:
- **Typography:** Strictly Apple SF Pro (`-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display"`). No other fonts.
- **Capsule Toggles:** All navigation bars (`.seg`, `.kcamp-tabs`, `.ktabs`, `.int-tabs`, `.kinbox-tabs`) must be smooth rounded capsule containers with active sliding pills. No bottom underlines or horizontal divider lines.
- **100% Rounded Buttons:** Every button site-wide has `border-radius: 9999px !important;`.
- **Flat Minimalist:** Zero floating drop shadows (`box-shadow: none`), zero `translateY` hover lifts. Clean 1px solid flat borders.
- **Four Themes:** Seamless switching across `light` (stone), `dark` (deep slate `#0B0E14`), `gradient` (modern SaaS `#ECEEF2` canvas with radiant headers), and `auto` (OS preference).
- **Single Outer Outline:** All input bars, search inputs, and dropdowns have exactly one outer line with zero nested inner borders.
- **Semantic Palette:** `#3B82F6` (accent), `#0EA5A4` (research), `#8B5CF6` (fit), `#D97706` (warning), `#16A34A` (success), `#DC2626` (failure), `#8A8A8A` (neutral).

---

## 10. License

Copyright © 2026 **Norven Studio**. All rights reserved.  
Private proprietary software. Unauthorized reproduction, distribution, or reverse engineering is strictly prohibited.
