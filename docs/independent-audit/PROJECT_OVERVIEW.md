# KESTREL — Project Overview & Functional Specification

> **Repository:** https://github.com/affanibnazad/Kestrel  
> **Prepared For:** Independent Technical Audit (ChatGPT)  
> **Date:** 22 November 2026  
> **Classification:** Technical Documentation / Audit Preparation  

---

## 1. What Kestrel Is

**Kestrel** is a service-agnostic **Client Intelligence & Outreach Web Platform** created by **Affan Ibn Azad** (founder of **Norven Studio**). It is engineered for motion designers, content strategists, agencies, and studio founders to identify high-fit target prospects, analyze brand signals with evidence, verify deliverability, orchestrate multi-step email sequences, and manage client communications through a unified pipeline.

The platform emphasizes evidence-based outreach (grounding claims in observed prospect signals rather than generic templates), automated quality control (QC hold gates before emails are sent), multi-mailbox rotation to preserve deliverability, and multi-tenant workspace isolation enforced at the PostgreSQL database level.

---

## 2. Core Functional Modules (Features in Code)

Every feature documented below exists directly in the repository source code:

| Module | Location | Implemented Capabilities |
|---|---|---|
| **Shell & Layout Engine** | `src/app/app/shell.tsx` | Draggable collapsible sidebar, folded icon rail, universal capsule toggles, 4 themes (`light`, `dark`, `gradient`, `auto`), top AI search bar, and `ViewErrorBoundary` fault containment. |
| **Leads & Pipeline Management** | `src/app/app/leads-view.tsx`<br>`src/app/app/pipeline-view.tsx` | Search, filtering, bulk import/export (CSV), Hunter.io integration, verified deliverability checks, status tracking, and 7-stage Kanban conversion pipeline. |
| **Campaigns & Outreach** | `src/app/app/campaigns-view.tsx`<br>`src/app/app/campaign-detail.tsx` | Multi-campaign lifecycle (draft, running, paused, done), recipient assignment, sequence attachment, send pacing, bounce tracking, and A/B variant split testing. |
| **Email Sequences & Templates** | `src/app/app/sequences-view.tsx`<br>`src/lib/sequence.ts` | Step-by-step sequence creation, delay timers (days/weekdays), subject/body interpolation, and integrated spam score evaluation (`spam-check.tsx`). |
| **Unified Inbox & Replies** | `src/app/app/inbox-view.tsx`<br>`src/app/app/reply-box.tsx` | 2-card floating inbox, conversation threading, reply classification (positive, objection, neutral, not interested), follow-up cancellation, and "Send Later" answer scheduling. |
| **Kestrel AI & Chat Bot** | `src/app/app/assistant-view.tsx`<br>`src/app/app/assistant-chat.tsx`<br>`src/app/kestrel-ai-chat/` | Embedded AI chat bot inside the dashboard canvas, standalone chat page, multi-model selection (Kestrel Pro, Fast, Thinking), thinking process inspector, search receipts, and multi-lead score/write tools. |
| **Mailbox Rotation & Placement** | `src/app/app/mailboxes-view.tsx`<br>`src/app/app/placement-view.tsx` | SMTP/IMAP account configuration, OAuth token exchange (Google Mail), daily send quotas, warmup schedule monitoring, SPF/DKIM/DMARC checks, and inbox placement verification. |
| **Autopilot & Bot Room (QC)** | `src/app/app/autopilot-view.tsx`<br>`src/app/app/bot-room.tsx` | Automated background lead scoring and drafting, Writer Bot, QC Bot with manual review hold, and activity audit logging (`ai-activity-view.tsx`). |
| **Team Management & Billing** | `src/app/app/owner-view.tsx`<br>`src/app/app/account-panel.tsx` | Role-based team seats (`owner`, `admin`, `member`, `viewer`), invite codes, Stripe/LemonSqueezy checkout and webhook handlers, and usage quotas. |
| **Public Marketing & Documentation** | `src/app/` (various routes) | Static landing page (`/`), Features (`/features`), Pricing (`/pricing`), Security (`/security`), Help center (`/help`), Legal/DPA (`/dpa`, `/terms`, `/privacy`), and Auth (`/login`, `/signup`). |

---

## 3. Technology Stack

| Layer | Technology | Version / Configuration | Purpose |
|---|---|---|---|
| **Framework** | Next.js | `16.4.6` (Turbopack, App Router) | SSR, SSG, streaming Suspense, serverless route handlers. |
| **Runtime** | React | `19.3.0` | Modern React compiler, client components, server actions. |
| **Language** | TypeScript | `^5.0.0` | Strict static typing, 0 TS build errors. |
| **Styling** | Tailwind CSS / CSS Modules | `4.3.3` | Apple SF Pro typography, custom CSS tokens (`globals.css`), capsule toggles, 9999px pill buttons. |
| **Database** | PostgreSQL | `16` (via Supabase) | Relational persistence, 54 tables, Row Level Security (RLS). |
| **Migrations** | Supabase Migrations | 69 SQL files (`supabase/migrations/`) | Deterministic database schema evolution (`001` through `069`). |
| **Mail Engine** | Nodemailer / ImapFlow | `^6.9.0` / `^1.0.0` | SMTP sending, IMAP inbox monitoring, OAuth2 tokens. |
| **AI Providers** | Anthropic, OpenAI, Gemini, Groq | SDKs / REST | Multi-provider LLM orchestration for leads scoring and email generation. |
| **Testing** | Node.js / Playwright | Custom suites + Playwright | 177 readiness assertions + 25 RLS tests + browser automation. |

---

## 4. Major Application Modules & Interactions

```
                         ┌────────────────────────────────────────────────────────┐
                         │                      USER BROWSER                      │
                         │   Next.js 16 Client App (App Router + React 19)        │
                         └───────────┬────────────────────────────────┬───────────┘
                                     │                                │
                      Public Routes  │                 Auth & API     │
                    (/, /login, etc) │                 Requests       │
                                     ▼                                ▼
                         ┌──────────────────────┐         ┌──────────────────────┐
                         │  Next.js Edge Proxy  │         │  Route Handlers      │
                         │  (src/proxy.ts)      │         │  (src/app/api/*)     │
                         │  - Host validation   │         │  - 34 endpoints      │
                         │  - SSRF guard        │         │  - HMAC webhooks     │
                         │  - Redirect logic    │         │  - Rate limiting     │
                         └───────────┬──────────┘         └──────────┬───────────┘
                                     │                               │
                                     └──────────────┬────────────────┘
                                                    │
                                                    ▼
                                     ┌──────────────────────────────┐
                                     │     PostgreSQL 16 Database   │
                                     │     (Supabase Cloud/Local)   │
                                     │  - 54 Tables (100% RLS)      │
                                     │  - 212 SECURITY DEFINER RPCs │
                                     │  - Migration 001 - 069       │
                                     └──────────────────────────────┘
```

1. **Client Interaction**: Users interact with the single-page dashboard shell (`src/app/app/shell.tsx`). View transitions happen client-side using URL search parameters (`?view=leads`, `?view=campaigns`, `?view=ai`).
2. **View Fault Isolation**: Each view is wrapped in a `ViewErrorBoundary` component. If one view encounters a runtime crash, the boundary catches it, displays a recovery UI, and leaves the sidebar and other views fully operational.
3. **API & Data Flow**: Authenticated requests query Supabase using the browser client (`supabaseBrowser()`) for direct RLS-enforced queries, or dispatch to serverless route handlers (`/api/*`) for privileged operations (sending email, signing webhook payloads, communicating with AI gateways).
4. **Data Isolation Boundary**: PostgreSQL enforces tenant isolation across all tables. Even if client code is manipulated, queries only return rows belonging to the authenticated user's `team_id`.
