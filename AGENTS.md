# Kestrel Clean App: Rules for Any AI Assistant

You are helping **Affan Ibn Azad**, founder of **Norven Studio**, build and grow the Kestrel outreach web platform.

---

## 1. How to talk to Affan
- English is not his first language. Use **short, simple sentences** and **tables**.
- Give clear next steps. One step at a time.
- Call him a founder, content strategist or motion designer. Not "entrepreneur", not just "video editor".
- He wants things built step by step, approved stage by stage.

---

## 2. Core Design Rules (Never Break These)

| Rule | Requirement |
|---|---|
| **Typography** | Apple SF Pro only (`-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display"`). No other fonts. |
| **Capsule Toggles** | All tablists (`.seg`, `.kcamp-tabs`, `.ktabs`, `.int-tabs`, `.br-filters`, `.kinbox-tabs`) must be smooth rounded capsule containers with interactive active pills. **No bottom underlines. No horizontal divider lines.** |
| **100% Rounded Buttons** | Every single button site-wide has `border-radius: 9999px !important;` (pills and round action buttons). |
| **Flat Minimalist (Zero Floating Shadows)** | No floating drop shadows (`box-shadow: none`), no `translateY` hover lifts. Clean 1px solid flat borders. |
| **Four Themes** | Clean separation of: `light` (warm stone), `dark` (deep slate `#0B0E14`), `gradient` (modern SaaS `#ECEEF2` canvas with radiant headers and pure white cards), and `auto` (OS mode). Never mix white-on-white text or dark text on dark surfaces. |
| **Single Outer Outline** | Inputs, search bars, and dropdowns (like Snooze) must have **only one outer line**. Zero inner nested boxes or stroke rings. |
| **Semantic Palette** | `#3B82F6` (accent), `#0EA5A4` (research), `#8B5CF6` (fit), `#D97706` (opportunity/warning), `#16A34A` (success), `#DC2626` (failure/blocked), `#8A8A8A` (neutral). |

---

## 3. How This Codebase is Organized

This is a clean, production-ready copy of Kestrel with **zero build cache, zero temporary logs, and zero dead code**.

- `src/app/app/` holds all modular page view components (`shell.tsx`, `campaigns-view.tsx`, `leads-view.tsx`, `inbox-view.tsx`, etc.).
- `src/app/globals.css` holds universal design tokens and verified styling rules.
- `page-rules/` holds detailed specifications for every single page. Before modifying or adding any page, consult the corresponding file in `page-rules/`.
- `PROGRESS.md` tracks all verified tasks up to date.
- Admin portal plan: `docs/ADMIN_PORTAL_PLAN.md` (platform admin and team owner are separate; no fake data outside demo mode).

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
