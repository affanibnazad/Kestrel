# Kestrel — Design System & Visual Specification

> **Status:** Canonical Design Baseline & Master Specification  
> **Updated:** 23 November 2026 (r8 Design Lock)  
> **Framework:** Kestrel V2 Design System (`:root[data-look="v2"]` in `src/app/globals.css`)  
> **Standard:** Clean Premium SaaS Workspace (Apple SF Pro Native, Flat Minimalist, Restrained Blue Accent)

---

## 1. Non-Negotiable Core Rules

| Rule | Specification | Implementation in `globals.css` |
|---|---|---|
| **Typography** | **Apple SF Pro Native only** (`-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display"`). No Inter, Roboto, or web font imports. | Universal selector on `body, button, input, select, textarea, h1-h6`. |
| **Capsule Toggles** | All tablists (`.seg`, `.kcamp-tabs`, `.ktabs`, `.int-tabs`, `.br-filters`, `.kinbox-tabs`) must be smooth rounded capsule containers with interactive active pills. **Zero bottom underlines. Zero divider lines.** | `border-radius: 9999px !important; border-bottom: none !important;` |
| **100% Rounded Buttons** | Every single button site-wide has `border-radius: 9999px !important;` (pills and round action buttons). | Universal selector targeting all buttons, `.btn`, `.kbtn`, `.kcamp-add`. |
| **Flat Minimalist** | Zero floating drop shadows (`box-shadow: none !important`), no `translateY` hover lifts. Clean 1px solid flat borders. | Universal reset eliminating card elevation and hover translate. |
| **Single Outer Outline** | Inputs, search bars, and dropdowns (like Snooze) must have **only one outer line**. Zero inner nested boxes or stroke rings. | Inner `input` elements have `border: 0; background: transparent; outline: none; box-shadow: none;`. |
| **Four Themes** | Clean separation of: `light` (warm stone `#F9F9F8`), `dark` (deep slate `#0B0E14`), `gradient` (modern SaaS `#ECEEF2` canvas with radiant headers and pure white cards), and `auto` (OS mode). | Never mix white-on-white text or dark-on-dark text. |
| **Semantic Palette** | `#3B82F6` (accent), `#0EA5A4` (research), `#8B5CF6` (fit), `#D97706` (warning/opportunity), `#16A34A` (success), `#DC2626` (failure/blocked), `#8A8A8A` (neutral). | Tokenized CSS variables in `globals.css`. |

---

## 2. Typography Hierarchy

- **Page Titles (`h1`)**: 22px–24px, 600 weight.
- **Section Headers (`h2`)**: 16px–18px, 600 weight.
- **Card Titles (`b`, `h3`)**: 14px–15px, 600 weight.
- **Body Text (`p`, `span`)**: 13.5px–14.5px, 400–500 weight.
- **Micro / Captions (`small`)**: 11.5px–12.5px, 400 weight.

---

## 3. Four Color Themes

| Theme | Canvas Background | Card Background | Primary Text | Secondary Text | Accent |
|---|---|---|---|---|---|
| **Light** | Warm stone `#F9F9F8` | `#FFFFFF` | `#1F1E1C` | `#6B7280` | `#3B82F6` |
| **Dark** | Pure deep slate `#0B0E14` | `#141822` | `#F3F4F6` | `#94A3B8` | `#3B82F6` |
| **Gradient (SaaS)** | Modern grayish `#ECEEF2` | White body + multi-color radiant top mesh | `#0F172A` | `#64748B` | `#6366F1` / `#8B5CF6` |
| **Auto** | Matches OS preference | Matches OS preference | Matches OS preference | Matches OS preference | Dynamic |

---

## 4. Design Lock

- **Rule**: No visual changes (colors, spacing, fonts, borders, or layout positioning) may be made without Affan's explicit written approval in chat.
- **Automated Verification**: `scripts/verify-design-lock.mjs` runs 16 Playwright visual snapshot checks (8 views × light/dark) and fails if any pixels shift without updated baselines.
- **Baselines Update**: Run `node scripts/verify-design-lock.mjs --update-baselines` ONLY after Affan's written confirmation.

---

## 5. Master Screen Inventory

| Screen Name | Route / Identifier | Component Entry Point | Status |
|---|---|---|---|
| **Home (Overview)** | `/app?view=home` | `src/app/app/home-kit.tsx` | Active |
| **Leads Directory** | `/app?view=leads` | `src/app/app/shell.tsx` | Active |
| **Pipeline (Kanban)** | `/app?view=pipeline` | `src/app/app/pipeline-view.tsx` | Active |
| **Campaigns List** | `/app?view=campaigns` | `src/app/app/campaigns-view.tsx` | Active |
| **Campaign Detail** | `/app?view=campaigns&c=<id>` | `src/app/app/campaign-detail.tsx` | Active |
| **Sequences & Templates** | `/app?view=sequences` | `src/app/app/sequences-view.tsx` | Active |
| **Replies (Inbox)** | `/app?view=inbox` | `src/app/app/inbox-view.tsx` | Active (Direct send parked in r9) |
| **Email Accounts** | `/app?view=mailboxes` | `src/app/app/mailboxes-view.tsx` | Active |
| **Your Business (About)** | `/app?view=about` | `src/app/app/about-view.tsx` | Active |
| **Deliverability** | `/app?view=placement` | `src/app/app/placement-view.tsx` | Active |
| **Integrations** | `/app?view=get` / `view=mcp` | `src/app/app/connections-keys.tsx`, `mcp-view.tsx` | Active (Desktop download hidden in r9) |
| **Kestrel AI** | `/app?view=ai` | `src/app/app/ai-view.tsx` | Active |
| **Plan & Billing** | `/app?view=plan` | `src/app/app/account-panel.tsx` | Active |
| **Team Management** | `/app?view=team` | `src/app/app/account-panel.tsx` | Active |
| **Owner Admin** | `/app?view=owner` | `src/app/app/owner-view.tsx` | Active (Admin only) |
| **Autopilot** | `/app?view=autopilot` | `src/app/app/autopilot-view.tsx` | **Parked (r9)** |
| **Standalone AI Chat** | `/kestrel-ai-chat` | `parked/kestrel-ai-chat/` | **Parked (r9)** |
