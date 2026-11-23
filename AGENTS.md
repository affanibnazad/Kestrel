# Kestrel Clean App: Rules for Any AI Assistant

You are helping **Affan Ibn Azad**, founder of **Norven Studio**, build and grow the Kestrel outreach web platform.

---

## 1. How to talk to Affan
- English is not his first language. Use **short, simple sentences** and **tables**.
- Give clear next steps. One step at a time.
- Call him a founder, content strategist, or motion designer. Not "entrepreneur", not "video editor".
- He wants things built step by step, approved stage by stage.

---

## 2. Safety & Engineering Rules (Strict)
- **Live Database Boundary**: NEVER run commands against the live Supabase project (`psocpxaphnfgbxpnkonk`) — no curl, no node -e, no scripts.
- **Passwords & Keys**: Never print, echo, or type API keys or passwords in commands.
- **Staging Only**: Test users and commands run only against staging via `.env.staging.local`.
- **Zero Fake Data**: No mock data, hardcoded sample rows, fake numbers, or fake behavior outside demo mode.
- **Demo Mode Boundary**: Demo mode operates ONLY when logged out AND `KESTREL_ALLOW_DEMO=true` (e.g. `/app?demo=true`).
- **Real Tests Only**: Tests must use real staging data. Never use mocks or route intercepts.
- **No Unapproved Deploy/Push/SQL**: No deploy, git push, or live SQL without Affan's explicit OK.
- **Report Only Means Zero Changes**: When Affan asks for a report, change nothing, edit nothing, delete nothing.
- **Never Delete Files**: Move retired or legacy files to `docs/archive/` via `git mv`.
- **Admin Integrity**: Never change `is_admin` or alter admin users yourself. Affan handles admin roles via SQL.
- **Honesty First**: If you do not know something, say "unknown" — never guess or invent facts.
- **Design Lock**: Never change layout, spacing, colors, or fonts without Affan's written OK.

---

## 3. Core Design Rules (Never Break These)

| Rule | Requirement |
|---|---|
| **Typography** | Apple SF Pro Native only (`-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display"`). No other fonts. |
| **Capsule Toggles** | All tablists (`.seg`, `.kcamp-tabs`, `.ktabs`, `.int-tabs`, `.br-filters`, `.kinbox-tabs`) must be smooth rounded capsule containers with interactive active pills. **No bottom underlines. No horizontal divider lines.** |
| **100% Rounded Buttons** | Every single button site-wide has `border-radius: 9999px !important;` (pills and round action buttons). |
| **Flat Minimalist** | Zero floating drop shadows (`box-shadow: none`), no `translateY` hover lifts. Clean 1px solid flat borders. |
| **Single Outer Outline** | Inputs, search bars, and dropdowns (like Snooze) must have **only one outer line**. Zero inner nested boxes or stroke rings. |
| **Four Themes** | Clean separation of: `light` (warm stone), `dark` (deep slate `#0B0E14`), `gradient` (modern SaaS `#ECEEF2` canvas with radiant headers and pure white cards), and `auto` (OS mode). Never mix white-on-white text or dark text on dark surfaces. |
| **Semantic Palette** | `#3B82F6` (accent), `#0EA5A4` (research), `#8B5CF6` (fit), `#D97706` (warning), `#16A34A` (success), `#DC2626` (failure), `#8A8A8A` (neutral). |

---

## 4. Where Things Are

Before changing any page, read its file in `page-rules/`.

| Topic | Primary Document | Description |
|---|---|---|
| **Design System** | `docs/DESIGN.md` | Master design specification, CSS tokens, themes, and screen inventory. |
| **Project Progress** | `docs/PROGRESS.md` | Authoritative progress status, active test suites, and verified milestones. |
| **System Blueprint** | `docs/BLUEPRINT.md` | Architecture, data model, security boundaries, and infrastructure. |
| **Admin Portal** | `docs/ADMIN_PORTAL_PLAN.md` | Platform admin requirements, role isolation, and billing ops. |
| **Page Rules** | `page-rules/*.md` | Detailed UX rules for specific screens (Campaigns, Leads, Inbox, etc.). |
| **Archived Docs** | `docs/archive/` | Historical audits and retired specs (kept in git, never deleted). |

---

## 5. Codebase Structure
- Modular page view components live in `src/app/app/` (`shell.tsx`, `campaigns-view.tsx`, `leads-view.tsx`, `inbox-view.tsx`, etc.).
- Universal design tokens and resets live in `src/app/globals.css`.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
