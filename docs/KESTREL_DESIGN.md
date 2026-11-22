# Kestrel — Design System, UX Audit & Complete Screen Inventory

> **Status:** Validated Design Baseline & UX Specification  
> **Audited Date:** 22 November 2026 (Validation Pass 2)  
> **Design Framework:** Kestrel V2 Design System (`:root[data-look="v2"]` in `src/app/globals.css`)  
> **Target Standard:** Clean Premium SaaS Workspace (Apple SF Pro Native, Flat Minimalist, Restrained Blue Accent)

---

## 1. Verified Design System Foundation (`VERIFIED`)

The Kestrel application is governed by a strict, custom design system pinned under `:root[data-look="v2"]` in `src/app/globals.css` and `src/lib/look.ts`.

### 1.1 Non-Negotiable Core Rules (from AGENTS.md)

| Category | Specification | Enforcement Mechanism | Status |
|---|---|---|---|
| **Typography** | **Apple SF Pro Native only** (`-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display"`). No Inter, Roboto, or web font imports. | Universal `globals.css` rule applied to `body, button, input, select, textarea, h1-h6`. | **TESTED** (Playwright passed) |
| **Capsule Toggles** | All tablists (`.seg`, `.kcamp-tabs`, `.ktabs`, `.int-tabs`, `.br-filters`, `.kinbox-tabs`) must be smooth rounded capsule containers with interactive active pills. **Zero bottom underlines. Zero divider lines.** | `border-radius: 9999px !important; border-bottom: none !important;` | **TESTED** (Playwright passed) |
| **100% Rounded Buttons** | Every single button site-wide has `border-radius: 9999px !important;` (pills and round action buttons). | Universal selector in `globals.css` targeting all buttons, `.btn`, `.kbtn`, `.kcamp-add`. | **TESTED** (Playwright passed) |
| **Flat Minimalist** | Zero floating drop shadows (`box-shadow: none`), no `translateY` hover lifts. Clean 1px solid flat borders. | Universal reset in `globals.css` eliminating card elevation and hover translate. | **TESTED** (Playwright passed) |
| **Single Outer Outline** | Inputs, search bars, and dropdowns (like Snooze) must have **only one outer line**. Zero inner nested boxes or stroke rings. | Inner `input` elements have `border: 0; background: transparent; outline: none; box-shadow: none;`. | **TESTED** (Playwright passed) |
| **Semantic Palette** | `#3B82F6` (accent), `#0EA5A4` (research), `#8B5CF6` (fit), `#D97706` (warning/opportunity), `#16A34A` (success), `#DC2626` (failure/blocked), `#8A8A8A` (neutral). | Tokenized CSS variables in `globals.css`. | **VERIFIED** (Inspected in globals.css) |

---

## 2. Complete Application Screen Inventory

This inventory documents all application screens from `src/app/app/shell.tsx` and public routes, clearly separating test levels:
- **Automated Playwright**: Programmatic assertion in `scripts/verify-all.mjs`.
- **Inspected Visually**: Screenshot captured and manually inspected.
- **Browser-Tested Interactively**: Tested via manual or automated click/drag interactions.
- **Not Tested**: Rendered component was not exercised during this audit.

| Screen Name | Route / View Identifier | Component Entry Point | Testing Level | Viewport & Browser | Screenshot Evidence | Layout Defects Noted | Interaction Testing | Responsive Testing |
|---|---|---|---|---|---|---|---|---|
| **Overview (Home)** | `/app?view=home` | `src/app/app/home-kit.tsx` | Automated Playwright + Inspected Visually | 1280×800 Chromium | `screenshot-home.png` | None (drag line removed) | Drag tested, double-click reset | 56px rail tested |
| **Leads List (All)** | `/app?view=leads` (`view=all`) | `src/app/app/shell.tsx` | Inspected Visually (Demo) | 1280×800 Chromium | Partial in pipeline capture | None | Review mode hotkeys (code-observed) | Rail collapse tested |
| **Pipeline (Kanban)** | `/app?view=pipeline` | `src/app/app/pipeline-view.tsx` | Automated Playwright + Inspected Visually | 1280×800 Chromium | `screenshot-pipeline.png` | None (rounded cards verified) | HTML5 drag transfer tested | Tested at 1280px |
| **Campaigns List** | `/app?view=campaigns` | `src/app/app/campaigns-view.tsx` | Automated Playwright + Inspected Visually | 1280×800 Chromium | `screenshot-campaigns.png` | None (single outer outline) | Filter tab switching tested | Tested at 1280px |
| **Campaign Detail** | `/app?view=campaigns&c=<id>` | `src/app/app/campaign-detail.tsx` | Automated Playwright + Inspected Visually | 1280×800 Chromium | `screenshot-campaign-detail.png` | None (banner removed) | Tab navigation tested | Rail collapse tested |
| **Sequences** | `/app?view=sequences` | `src/app/app/sequences-view.tsx` | Automated Static (AST & Typecheck) | N/A | None | Hydration `<button>` bug fixed | AST verified (0 nested buttons) | Untested narrow |
| **Inbound Replies (Unibox)** | `/app?view=inbox` | `src/app/app/inbox-view.tsx` | Code-Observed | N/A | None | None | Auto-collapse rail (code-observed) | Untested narrow |
| **Email Accounts** | `/app?view=mailboxes` | `src/app/app/mailboxes-view.tsx` | Code-Observed | N/A | None | None | None | Untested |
| **Your Business** | `/app?view=about` | `src/app/app/about-view.tsx` | Code-Observed | N/A | None | Video placeholders present | Form fields save (code-observed) | Untested |
| **Deliverability** | `/app?view=placement` | `src/app/app/placement-view.tsx` | Code-Observed | N/A | None | None | Seed inbox test trigger | Untested |
| **Integrations Hub** | `/app?view=get` | `src/app/app/connections-keys.tsx` | Automated Playwright + Inspected Visually | 1280×800 Chromium | `screenshot-integrations.png` | None (SaaS redesign verified) | 3 capsule tabs tested | Tested at 1280px |
| **Kestrel AI (In-App)** | `/app?view=ai` | `src/app/app/assistant-view.tsx` | Automated Playwright | 1280×720 Chromium | None | None | 3 capsule tabs tested | Rail collapse tested |
| **Autopilot** | `/app?view=autopilot` | `src/app/app/autopilot-view.tsx` | Code-Observed | N/A | None | None | Toggle switch (code-observed) | Untested |
| **Tasks** | `/app?view=tasks` | `src/app/app/tasks-view.tsx` | Code-Observed | N/A | None | None | None | Untested |
| **Analytics** | `/app?view=analytics` | `src/app/app/analytics-view.tsx` | Code-Observed | N/A | None | None | None | Untested |
| **Rules** | `/app?view=rules` | `src/app/app/rules-view.tsx` | Code-Observed | N/A | None | None | None | Untested |
| **Do-Not-Contact** | `/app?view=dnc` | `src/app/app/dnc-view.tsx` | Code-Observed | N/A | None | None | None | Untested |
| **Import & Examples** | `/app?view=import` | `src/app/app/csv-import.tsx` | Code-Observed | N/A | None | None | None | Untested |
| **Team Management** | `/app?view=team` | `src/app/app/account-panel.tsx` | Code-Observed | N/A | None | None | None | Untested |
| **Plan & Billing** | `/app?view=plan` | `src/app/app/account-panel.tsx` | Code-Observed | N/A | None | None | Checkout redirect | Untested |
| **Owner Admin** | `/app?view=owner` | `src/app/app/owner-view.tsx` | Automated Playwright + Inspected Visually | 1280×800 Chromium | `screenshot-owner.png` | None (live metrics loaded) | Rules tab click tested | Tested at 1280px |
| **Creator Affiliates** | `/app?view=creator` | `src/app/app/creators-view.tsx` | Code-Observed | N/A | None | None | None | Untested |
| **Standalone AI Chat** | `/kestrel-ai-chat` | `src/app/kestrel-ai-chat/page.tsx` | Automated Playwright + Inspected Visually | 1280×800 Chromium | `screenshot-ai-chat.png` | None (clean layout) | Starters rendered | Tested at 1280px |
| **Public Landing** | `/` | `src/app/page.tsx` | Automated Playwright | 1280×720 Chromium | None | None | Redirect to /app tested | Untested mobile |
| **Pricing Public** | `/pricing` | `src/app/pricing/page.tsx` | Not Tested | N/A | None | Unaudited | None | Untested |
| **Login Public** | `/login` | `src/app/login/page.tsx` | Not Tested | N/A | None | Unaudited | None | Untested |
| **Signup Public** | `/signup` | `src/app/signup/page.tsx` | Not Tested | N/A | None | Unaudited | None | Untested |

---

## 3. Reevaluation of the CSS Cleanup Proposal

### 3.1 Codebase Reality of `globals.css`
- **File Length**: 29,882 lines (~1.1 MB).
- **Compile Time Impact**: Turbopack compiles without warnings or errors.
- **Dead Selectors Identified**:
  - `.as-*` selectors from deleted `assistant-chat.tsx` (approx. 350 lines).
  - `.ask-fab` floating button rules (approx. 40 lines).
  - `.bot-room` legacy classes (approx. 200 lines).

### 3.2 Regression Risks of Premature Deletion
1. **Universal Button / Input Groupings**: In lines 29450–29650, `.as-send`, `.as-fab`, `.as-open` are part of comma-separated selector lists that enforce `border-radius: 9999px !important;` and `box-shadow: none !important;`. Deleting these without careful comma adjustment will corrupt the selector cascade.
2. **Dynamic Class Construction**: Several views construct class names via template literals (e.g. `` `tip${open ? " on" : ""}` ``). Unreferenced static searches can produce false positive "dead code" candidates.
3. **Portal & Modal References**: Elements rendered via `createPortal` (like `<Tip />` popover `.tip-pop`) render into `document.body` outside the React root.

### 3.3 Safe Cleanup Protocol (Recommended for Stage E)
1. **Capture Visual Baseline**: Take full-page reference screenshots across all 23 in-app views under Light, Dark, and Gradient themes.
2. **Static AST Analysis**: Run an automated script to cross-reference every CSS selector against all `.tsx` and `.ts` files, flagging only unreferenced selectors with zero wildcard or dynamic prefix matches.
3. **Isolated Canary Branch**: Remove dead selectors in small, isolated groups (e.g., `.as-*` only).
4. **Automated Pixel-Diff Verification**: Re-run the visual screenshot suite to confirm zero visual regressions before merging.
5. **No CSS Deletion During Phase 0 or Phase 1**: Maintain CSS stability during core capability expansion.
