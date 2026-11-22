# KESTREL — Technical Architecture Specification

> **Repository:** https://github.com/affanibnazad/Kestrel  
> **Prepared For:** Independent Technical Audit (ChatGPT)  
> **Date:** 22 November 2026  
> **Classification:** Technical Documentation / Audit Preparation  

---

## 1. Frontend Architecture

### 1.1 App Router & Component Hierarchy
Kestrel uses the **Next.js 16 App Router** with React 19:
- **`src/app/layout.tsx`**: Root layout establishing HTML shell, fonts (Apple SF Pro), and theme tokens.
- **`src/app/page.tsx`**: Public entry point. In production, unauthenticated users are directed to marketing pages or redirected to `/app` (which routes to `/login?next=...`).
- **`src/app/app/page.tsx`**: Server component wrapping the authenticated dashboard behind streaming Suspense. Authenticates the session via `currentUser()` and RPC `my_account`.
- **`src/app/app/client-app.tsx`**: Hydration boundary loading the interactive shell.
- **`src/app/app/shell.tsx`**: The primary application shell containing:
  - Responsive collapsible sidebar with smooth drag-to-resize handles (`SIDE_MIN: 200px`, `SIDE_MAX: 400px`).
  - Active pill indicators and theme-driven styling (`data-look="v2"`).
  - Main view switcher rendering 14 modular views (`home`, `campaigns`, `leads`, `inbox`, `sequences`, `ai`, `mailboxes`, `placement`, `analytics`, `tasks`, `owner`, `about`, `rules`, `dnc`).
  - Top header with global AI search and notification toast host.

### 1.2 View-Level Fault Containment (`ViewErrorBoundary`)
To prevent an unhandled exception in one view from crashing the entire application:
- Located at `src/components/view-error-boundary.tsx`.
- Wraps every main view in `src/app/app/shell.tsx`.
- Catches errors via `componentDidCatch`, logs diagnostic traces, and renders a localized fallback card with **"Try Again"** and **"Return to Home"** buttons.
- Automatically resets state when the user selects a different view in the sidebar.

### 1.3 Design System & Theme Engine
Defined strictly according to Norven Studio's brand rules in `src/app/globals.css`:
- **Typography**: Apple SF Pro only (`-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display"`).
- **Capsule Toggles**: Segmented controls (`.seg`, `.kcamp-tabs`, `.ktabs`, `.kinbox-tabs`) render as rounded capsule containers with interactive active pills. No bottom underlines or horizontal dividers.
- **Button Radius**: Every button site-wide has `border-radius: 9999px !important;`.
- **Flat Minimalist**: Zero floating drop shadows (`box-shadow: none`), zero `translateY` hover lifts, clean 1px solid flat borders.
- **Four Distinct Themes**: `light` (stone), `dark` (deep slate `#0B0E14`), `gradient` (modern SaaS `#ECEEF2` canvas with radiant headers and pure white cards), and `auto` (OS theme).
- **Single Outer Outline**: Inputs, search bars, and dropdowns have a single outer border with zero nested boxes.

---

## 2. Backend & Serverless API Architecture

### 2.1 Edge Proxy & Security Interceptor (`src/proxy.ts`)
Acts as the global middleware proxy for all incoming requests:
- **Host Header Validation**: Rejects requests where host does not match allowed domains (`kestrelleads.com`, `localhost`, `127.0.0.1`, `*.vercel.app`) with 308 redirect.
- **SSRF Mitigation**: Validates target hostnames and protocols on proxy and forwarding routes.
- **Authentication Route Protection**: Intercepts unauthenticated navigation to `/app` and sub-routes, redirecting to `/login?next=...` while preserving safe relative redirect destinations.
- **Standalone Chat Redirects**: Redirects legacy `/ai-chat` traffic to `/kestrel-ai-chat` with 308 status.

### 2.2 Serverless API Route Matrix (`src/app/api/`)
Contains 34 dedicated Next.js Route Handlers:
- **Mail & Deliverability Engine**:
  - `/api/mail/test`, `/api/mail/reply`, `/api/mail/schedule`: SMTP sending and scheduled answer dispatching via Nodemailer.
  - `/api/mail/tick`: Background worker endpoint processing scheduled emails, warmup ticks, and campaign sending queues.
  - `/api/mail/domain-check`, `/api/mail/placement`: DNS record inspection (SPF, DKIM, DMARC) and inbox placement monitoring.
  - `/api/mail/o`, `/api/mail/tracking-check`, `/api/mail/unsubscribe`: Open tracking pixel, click redirection, and RFC-compliant unsubscription handlers.
- **AI Gateway & Intelligence**:
  - `/api/ai`, `/api/assistant`: Multi-LLM provider routing (Anthropic Claude, OpenAI, Google Gemini, Groq, Nvidia) for email drafting and lead enrichment.
  - `/api/mcp/ai-save`, `/api/mcp/ai-task`: Model Context Protocol integration for Claude Code, Codex, and external agent tools.
- **Billing & Account Management**:
  - `/api/billing/checkout`: Session creation for Stripe / LemonSqueezy subscription management (restricted to `owner` role).
  - `/api/billing/webhook`: HMAC signature-validated webhook receiver processing subscription renewals and plan adjustments.
- **Asset Download & Binary Protection**:
  - `/api/app/download/[file]`: Secure token-gated endpoint serving Kestrel browser extension, AI Kit, and MCP connectors with path traversal mitigation.

---

## 3. Database & Persistence Architecture

### 3.1 PostgreSQL Schema on Supabase
- **54 Relational Tables**: Covering core business domains (`accounts`, `team_members`, `leads`, `campaigns`, `sequences`, `mailboxes`, `conversations`, `messages`, `scheduled_answers`, `offer_profiles`, `team_ai`, `team_webhooks`, `placement_tests`, etc.).
- **69 Versioned SQL Migrations**: Sequential migrations from `001_accounts.sql` through `069_grant_my_team_id.sql` tracked in `supabase/migrations/`.
- **100% RLS Enforcement**: Every table has `relrowsecurity = true`.
- **212 Privileged Database Functions**: Encapsulate high-security operations with explicit `SET search_path = public` to prevent search_path hijacking.

### 3.2 Tenant / Workspace Isolation Architecture
- Every tenant data row is stamped with a `team_id` UUID foreign key.
- Database functions `my_team_id()`, `is_member(team_id)`, and `can_edit(team_id)` evaluate the authenticated Supabase session `auth.uid()`.
- RLS policies restrict all `SELECT`, `INSERT`, `UPDATE`, and `DELETE` operations strictly to members of that `team_id`.
- Forward migration `069_grant_my_team_id.sql` explicitly grants `EXECUTE` privilege on `public.my_team_id(boolean)` to `authenticated` users, resolving defect DEF-03.

---

## 4. Authentication & Authorization Model

```
   [User Request] ──> [Next.js proxy.ts] ──> [currentUser() Check]
                              │                           │
                      No Active Session           Valid Supabase Session
                              │                           │
                      Explicit ?demo=1?           Load RPC my_account()
                        │           │                     │
                       YES          NO            Assign Team & Role
                        │           │             [owner|admin|member|viewer]
                  [Demo Sandbox] [Redirect to]            │
                 (is_admin:false) [/login?next=]   [PostgreSQL RLS Boundary]
```

### 4.1 Authentication Flows
1. **Email Magic Links**: Passwordless sign-in via Supabase GoTrue Auth sending secure one-time tokens.
2. **Google OAuth**: One-click authentication with work email or personal Google accounts.
3. **Session Management**: Secure, HTTP-only cookie tokens managed through `@supabase/ssr`.

### 4.2 Role-Based Access Control (RBAC)
Four distinct roles are supported per workspace:
- **`owner`**: Complete authority over billing, team member invites, role changes, deletion, and workspace settings.
- **`admin`**: Full operational authority over campaigns, leads, mailboxes, and AI settings; cannot modify billing or remove the owner.
- **`member`**: Standard operational access to create and edit campaigns, review replies, and score leads.
- **`viewer`**: Read-only access to view analytics, leads, and inbox conversations; cannot mutate data or trigger email sends.

---

## 5. Third-Party Integrations & External Services

| Service | Integration Point | Purpose |
|---|---|---|
| **Supabase** | `src/lib/supabase/` | Authentication, PostgreSQL database, storage, and RLS enforcement. |
| **Anthropic (Claude)** | `src/lib/ai.ts`<br>`src/app/api/assistant` | Lead scoring, email drafting, and conversational AI assistant. |
| **OpenAI / Gemini / Groq / Nvidia** | `src/lib/ai.ts` | Multi-model fallback options for automated content generation. |
| **Hunter.io** | `src/lib/hunter.ts`<br>`src/app/app/leads-view.tsx` | Domain email discovery and prospect enrichment. |
| **Stripe / LemonSqueezy** | `src/app/api/billing/` | Automated subscription checkout and plan lifecycle management. |
| **Google Mail (OAuth2)** | `src/app/api/mail/oauth/google/` | Direct Gmail / Google Workspace mailbox connection for outbound sends. |
