# Page Rules 01: Campaigns Page

The Campaigns page manages cold outreach email campaigns, statuses, lead sequences, and sending schedules.

---

## 1. Key Components
- Primary View: `src/app/app/campaigns-view.tsx`
- Detail & Sequence Editor: `src/app/app/campaign-detail.tsx`
- Sequence Generation Engine: `src/lib/sequence.ts`

---

## 2. Page Structure & Rules

| Section | Specifications & Rules |
|---|---|
| **Header** | Title "Campaigns", subtitle with active counts, and a primary rounded capsule button `+ Add campaign`. |
| **Status Filter Tabs** | Capsule toggle pill with options: `All`, `Sending`, `Not started`, `Paused`, `Stopped`, `Finished`. No bottom underlines. |
| **Search Bar** | Single outer rounded outline. No blue rectangular focus box. Clean search placeholder `Search campaigns…`. |
| **Campaign Cards** | Flat 1px border. No beige extra banners. Clean metrics: `Sent`, `Open %`, `Reply %`, `Bounce %`. One-line summary. |
| **Add Campaign Flow** | Modal popup with step-by-step tabs: Campaign Name → Select Leads (excludes leads already in other campaigns via `chosen.used`) → Sequence Setup → Schedule. |

---

## 3. Sequence & Safety Safeguards
- Follow-up delays default to 3–5 business days.
- Bounces exceeding 1% display a verification recommendation alert.
- Email merge variables (`{{FIRST_NAME}}`, `{{ICEBREAKER}}`, `{{ONE_LINE}}`, `{{QUESTION}}`) are sanitized and validated.
