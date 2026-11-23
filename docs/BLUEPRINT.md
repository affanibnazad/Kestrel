# Kestrel — System Architecture & Product Blueprint

> **Status:** Canonical Architecture Baseline  
> **Updated:** 23 November 2026 (r8 Foundation)  
> **Repository:** `quarry-cloud@0.1.0`  
> **Core Stack:** Next.js 16.4.6 (Turbopack), React 19.3.0, Supabase PostgreSQL, Tailwind CSS v4

---

## 1. System Architecture Overview

```mermaid
flowchart TD
    subgraph Client Layer
        Web["Web Application (Next.js 16.4 App Router)<br/>V2 Design System (Apple SF Pro, Flat Minimalist)"]
        Ext["Chromium Extension (v2.9.4)<br/>Public Leads Collector (Maps, Web, Directories)"]
        Mcp["Kestrel MCP Server (kestrel-mcp.mjs)<br/>Claude Code / Codex Integration"]
    end

    subgraph Server & API Handlers (src/app/api)
        RouteHandlers["Next.js Serverless Route Handlers<br/>33 Active Handlers (maxDuration: 60s)"]
        Proxy["Proxy / Middleware (src/proxy.ts)<br/>Auth Token Refresh & Route Protection"]
    end

    subgraph Core Business Engine (src/lib)
        LeadSteps["Lead Processing Pipeline<br/>findOne / aiOne / writeChecked / scoreEmail"]
        AssistantEng["Assistant Engine (14 Tools)<br/>Server-Side Logging & Key Isolation"]
        MailEng["Outreach Engine (Nodemailer + ImapFlow)<br/>SMTP Sending / IMAP Reply Polling"]
        SiteRead["SSRF-Guarded Web Scraper<br/>DNS Pinning & Robots.txt Compliance"]
    end

    subgraph Data & Storage Layer
        Supabase["Supabase PostgreSQL<br/>80 Migrations / 54 Tables / 100% RLS"]
        Vault["Supabase Vault (pgsodium)<br/>Encrypted Mailbox & Service Keys"]
    end

    subgraph External Gateways
        AI["AI Gateways (Anthropic / OpenAI / Gemini / NVIDIA)"]
        Finders["Enrichment (Hunter.io / Apollo / Findymail)"]
        Mailboxes["User Mailboxes (Custom SMTP/IMAP & Google OAuth)"]
    end

    Web --> Proxy --> RouteHandlers
    RouteHandlers --> LeadSteps
    RouteHandlers --> AssistantEng
    RouteHandlers --> MailEng
    LeadSteps --> AI
    LeadSteps --> Finders
    MailEng --> Mailboxes
    RouteHandlers --> Supabase
    AssistantEng --> Supabase
    MailEng --> Vault
```

---

## 2. Technical Stack & Dependencies

| Layer | Technology | Version | Location / Config |
|---|---|---|---|
| **Framework** | Next.js (App Router, Turbopack) | `16.4.6` | `next.config.ts`, `src/app/` |
| **UI Library** | React | `19.3.0` | `src/app/` |
| **CSS Engine** | Tailwind CSS v4 & Custom Tokens | `4.3.3` | `src/app/globals.css` |
| **Typography** | Apple SF Pro Native | System | `-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display"` |
| **Database** | Supabase PostgreSQL | Latest | `supabase/migrations/` (80 migration files) |
| **Client Auth/DB** | `@supabase/ssr` / `@supabase/supabase-js` | `0.12.7` / `2.118.0` | `src/lib/supabase/` |
| **Email Protocols** | Nodemailer (SMTP) / ImapFlow (IMAP) | `10.2.1` / `2.9.1` | `src/lib/mail-connect.ts` |
| **AI Client SDK** | `@anthropic-ai/sdk`, REST Gateways | `1.8.0` | `src/lib/assistant-engine.ts`, `src/lib/ai.ts` |
| **Icons** | Lucide React | `1.65.0` | `src/components/ui.tsx` |
| **Error Monitoring** | Sentry Next.js (Dormant until DSN set) | `11.16.0` | `src/lib/sentry-options.ts`, `src/instrumentation.ts` |

---

## 3. Database Architecture & Multi-Tenant Security

1. **80 Migrations**: All database schema changes are managed sequentially in `supabase/migrations/001_initial_schema.sql` through `080_...sql`.
2. **54 Tables**: All tenant tables enforce strict PostgreSQL Row Level Security (RLS) linked to `team_id`.
3. **Multi-Tenant Isolation**: RLS policies enforce `is_member(team_id)`, `can_edit(team_id)`, or `my_team_id()`. Direct cross-tenant access is blocked at the database engine level.
4. **Key Security (Vault)**: Mailbox passwords and third-party API keys are encrypted at rest using Supabase Vault (`pgsodium`). Plaintext keys are never stored in plain table columns or client payloads.
5. **SSRF Guard**: External website scraping (`src/lib/site-read.ts`) enforces DNS resolution validation to prevent requests to loopback (`127.0.0.1`), private RFC 1918 subnets, or cloud metadata endpoints.
