# Kestrel UI Redesign Plan (v1)

Status: proposed · 24 Nov 2026 · Owner: Affan
References: (1) Connections screenshot = the look and depth. (2) n8n-style workflow = the Lead Brain node canvas.
Rule books used: design-review, spacing-audit, make-a-type-scale, find-animation-opportunities, desktop-to-mobile, better-interface. They were written for Figma; we use their RULES in code, not the Figma steps.


## 0. Update 24 Nov (overrides section 1 where different)

- THREE themes for the WHOLE app (every page, not only Settings): Light (solid), Dark (solid), Gradient.
- Exact visual target: docs/ui-reference/connections.html (switch themes top right). Copy its tokens, not only the page.
- Buttons: compact pills (height 34, radius 999, padding 0 16, 14px/500) like the current "Add campaign". Connect / Set up: Light + Gradient = WHITE #ffffff, text #1d1d22, 0.2px gray outline #8a8d96 (hover #f4f4f7). Dark = solid gray #3a3a3a, text #ececec, border #4a4a4a. Main action button (one per page, e.g. "Add campaign"), pipeline circles and active toggles: LIGHT = black #111113 with white text · DARK = white #ffffff with black text · GRADIENT = purple #5b54e8 with white text.
- Cards and rows: rounded 14, own border, 36px icon tile.
- "Connected" status: green pill with dot (gradient in Gradient theme).
- Gradient theme: soft page washes + each card gets its OWN corner wash. Never the same color twice on one screen. Palette: purple #ebe3ff, blue #dcebff, peach #ffe7d4, green #d8f4e5, pink #ffe0ea, yellow #fff1c7. Assign by card index on the page.
- Light and Dark: solid only, no gradients.
- Design lock becomes 9 pages x 3 themes = 27 baselines.
- Gradient theme detail (approved 24 Nov): page base #fbfbfd; every color feathers into WHITE (one color per card, no second color). "Connected" badge: LIGHT = black pill (#111113), white text, white dot. GRADIENT = white → its own card's color, 0.2px outline in the card's color, dot = darker card color. DARK = white pill (#ffffff), black text, black dot. Light + Gradient LOCKED 24 Nov.
- References: docs/ui-reference/connections.html (Settings / Connections) and docs/ui-reference/app-shell.html (sidebar + Settings). These files are the source of truth for the look.
- Sidebar (final): Outreach = Home, Leads, Campaigns, Sequences, Replies, Pipeline · Tools = Find leads, Kestrel AI, Tasks, Analytics (+ Lead Brain at U5) · Bottom = Guide, Owner (admin only, until A3), Settings. Email accounts, Your business, Deliverability, Integrations move into Settings.
- EVERY button, search bar, input and badge in the whole app uses the reference styles (pill shapes, same sizes). No page keeps old button or search styles.
- COLOR = MEANING (updated 24 Nov, replaces "never the same color twice"): in the Gradient theme a card's color comes from its group or state, so items of the same kind share one color.
  - Pipeline: Prepare stages purple #d6c6ff · Outreach stages blue #c2dbff · Close orange (Apple, pastel) · Won green (Apple) · Lost red (Apple). Stage circles = main button color (black in Light, white in Dark, purple in Gradient), solid, no outline. Phases shown one at a time: Prepare · Outreach · Close · Won · Lost (toggle, arrows, swipe). PIPELINE LOCKED 24 Nov (docs/ui-reference/pipeline.html).
  - Leads (v4, 24 Nov evening): rows are WHITE slim pills (~68px, all the same size) — no fit color on rows; fit shows only in the Fit pill (Apple colors). Row = Business (round avatar, name + globe icon to website, category · city) · Offer (icon in circle + name) · Contact 2 lines (mail icon colored by check: green checked / orange may bounce / red will bounce; phone) · Social (bare brand icons) · Fit pill · Approval pill (Approved green / Review orange / Rejected red, menu with those 3 only) · more. Approval uses the EXISTING live column outreach_approved (true = Approved); Rejected = existing Removed; Review = neither. NO new column. Reference: docs/ui-reference/leads.html.
  - Offers (Settings → Your business): each offer has an icon picked from 50 Lucide icons (list in docs/ui-reference/offers.html), shown in a circle. OFFERS LOCKED 24 Nov.
  - POSITIVE STATUS PILL ("Active", "Approved", "Connected"-type labels): GRADIENT = solid Apple green #34C759, white text · LIGHT = black #111113, white text · DARK = white #ffffff, black text.
  - Campaigns: Sending blue · Not started purple · Paused peach · Stopped red · Finished green.
  - Replies: Interested green · Meeting blue · Not now peach · Not interested red · No label purple. Reference docs/ui-reference/replies.html. AI label shown as "Kestrel AI" only, never a model name. Icon tabs + icon filters, 3 equal-height panes, sent = blue chat bubble (Gradient: #2f6bff→#5b54e8), details under the bubble (Opened ×, Clicked, seen avatar), Spam check is a button. REPLIES LOCKED 24 Nov.
  - Settings/Connections rows (no state): neighbours never share a color.
- References added: docs/ui-reference/leads.html (U2), docs/ui-reference/offers.html, docs/ui-reference/pipeline.html (flight path, U3), docs/ui-reference/replies.html.
- STATUS COLORS = APPLE SYSTEM PALETTE (Affan, always): green #34C759, orange #FF9500, yellow #FFCC00, red #FF3B30, blue #007AFF (dark theme: #30D158, #FF9F0A, #FFD60A, #FF453A, #0A84FF). Colored TEXT on light backgrounds uses Apple's accessible variants: green #248A3D, orange #C93400, red #D70015. Pastel card washes are these colors mixed with white (green #beedca, orange #ffddad, red #ffc4c1, yellow #ffea94). Never use other reds, greens or yellows.
- Rule: a sidebar item only if people open it daily; set-once things live in Settings.

- PAGE BACKGROUND (24 Nov): every app page uses the Pipeline/Replies background — ONE full-page wash on the page itself (Gradient: feathered washes on #fbfbfd; Light/Dark: solid). No boxed panel around the page, no hard edges, no gray strips. Cards/rows sit directly on it. The LEFT SIDEBAR shares the same background (transparent, no own color, no blur), separated only by a 1px border, so the wash runs across sidebar + page as one. Exception: Settings keeps its own Settings layout.
- RESPONSIVE: every page prompt includes phone (390) and tablet (768) layouts. Shell rules in U1c.

## 1. Design rules (tokens) — taken from reference (1)

| Token | Dark | Note |
|---|---|---|
| Page | #1a1a1a | |
| Panel / card | #1f1f1f | one step lighter than page |
| Raised (side panel, popover) | #262626 | |
| Border | #333333, 1px | the "depth" in the reference comes from borders, not shadows |
| Selected nav item | #3a3a3a | |
| Text | #ececec | |
| Text secondary | #a3a3a3 | descriptions |
| Text muted | #8a8a8a | group labels ("Find leads") — check 4.5:1 |
| Success | text #3fb950 on #1c2b1f | "Connected" |
| Warning / danger | amber / red, same pattern | always with a word, never color alone |

Light mode gets the same structure with its own values (design lock has light + dark).

Radius (concentric): button + input 10 · list group / card 12 · side panel 16 · outer settings shell 20 · status badge 8.
Buttons: height 40, padding 0 18, 1px border #4a4a4a, transparent ("Connect" in the reference). Primary: filled #ececec, text #1a1a1a. One primary per view. Press: scale 0.96, 150 ms.
Search: height 48, radius 10, 1px border, 16px text, search icon left.
List rows (the reference pattern): icon 20 · name 16 · description 14 secondary · status or button right · row height 64 · rows divided by 1px border inside a 12-radius group.
Type (Inter, 1.2 ratio): 12 · 14 · 16 · 20 · 24 · 32. Body 16/1.5, headings 1.2. Weights 400 + 500 only (600 for page titles).
Spacing: 4/8 grid only: 4 · 8 · 12 · 16 · 24 · 32 · 48. Gap between groups ≥ 2× gap inside a group.
Icons: LUCIDE ONLY (lucide-react, already in the app), stroke 1.5, currentColor. Never hand-drawn or another set. No emoji, no letter tiles. Brand logos (Instagram, Facebook, YouTube, LinkedIn) come from the app's own GLYPH set in biz.tsx.
Focus: visible 2px ring on :focus-visible everywhere. Targets ≥ 40px.
Motion: only press feedback (150 ms), side panel open (200 ms ease-out), accordion (200 ms). Nothing on nav/tabs. Respect prefers-reduced-motion.

## 2. Shared components (build once, use everywhere)

Button (default / primary / danger / icon-only) · Input · Search · Select · Switch · Badge · ListGroup + Row · SidePanel · Settings shell (left menu + content) · App nav · Empty state · Error message · Page header.
No page may use its own one-off styles after this.

## 3. Settings structure

Left menu: General · Your business · Team · Plan and billing · Connections · Email accounts · Notifications · Privacy and data.
Connections groups: Find leads · Send and track · Use Kestrel elsewhere · Advanced: your own AI key (one collapsed row).
Customers never see AI companies or models. Admin AI settings only in Owner → AI.

## 4. Lead Brain node canvas — reference (2)

Look: dark dotted canvas, pan + zoom. Nodes are square tiles (64×64, radius 14) with an icon in the middle and the name UNDER the tile. Small port dots on left/right. Real curved bezier lines between ports. Branches fan out and merge. AI nodes have sub-nodes underneath joined by dashed lines (owner view only).

Flow, left to right:

New leads → Collect fans out to [Website · Google profile · Social links · YouTube · Job pages] → Merge → Signals (code) → Read (AI) ⇢ sub-node: fast model → Quote check (code) → Match score (code) ⇢ sub-node: Service Catalog weights → Explain (AI) → You approve (wait node) → Angle (code) → Write (AI) ⇢ sub-nodes: strong model + Your voice → QC (code + AI) → Ready to send → Campaign

Live state per node: count badge on the tile · ring color = idle / running / done / error · a small dot travels along a line when a lead moves (only while jobs run) · click a node → side panel (who does it, time limit, leads inside, last runs, errors; approve buttons on the wait node).
Customer view: same canvas, AI sub-nodes hidden, every AI node labelled "Kestrel AI". (Open question: customers may get only a simple status list instead.)
Data: needs `ai_runs` (AI-1) and the job queue (AI-4). NO fake live data in the real app. Built last.

## 5. Build order

| Step | Work | Done when |
|---|---|---|
| U0 | Tokens + shared components (section 1–2), light + dark | Component page on staging; Affan approves the look |
| U1 | App nav + whole Settings area + Connections page | Old Integrations page gone; no model names for customers |
| U2 | Leads list + lead detail | Same components, no one-off styles |
| U3 | Campaigns, Inbox, Home | Same |
| U4 | Owner pages incl. Owner → AI | Old Assistant + Included AI screens gone |
| U5 | Lead Brain node canvas | After AI-1 + AI-4; real data only |

Each step: staging first → design-review check (contrast, focus, spacing on 4/8, states: hover/focus/empty/error/loading) → mobile check at 390 px → design lock baselines re-taken with Affan's OK → deploy.
Antigravity rules unchanged: no mocks, no live deploy without approval, raw screenshots as proof, "NOT RUN" if not run.
