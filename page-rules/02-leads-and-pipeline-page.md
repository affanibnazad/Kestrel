# Page Rules 02: Leads Directory & Pipeline Page

The Leads directory stores prospective agency leads, contact discovery, and scoring status. The Pipeline provides a Kanban board tracking client deals.

---

## 1. Key Components
- Leads List View: `src/app/app/leads-view.tsx`
- Lead Detail Side Panel: `src/app/app/lead-panel.tsx`
- Pipeline Kanban Board: `src/app/app/pipeline-view.tsx`
- Scoring & Rules Engine: `src/lib/scoring.ts` & `src/lib/pipeline.ts`

---

## 2. Leads Directory Rules

| Element | Rule & Standard |
|---|---|
| **Filter Tabs** | Capsule toggle list: `All leads`, `New, to review`, `Good fit`, `Named contacts`, `Hiring now`, `Kept`, `Removed`. |
| **Lead Listing Style** | Separated modern capsule cards (`border-radius: 9999px`) with clean 1px borders. Single-line contact summary. |
| **Action Bar** | Capsule buttons for `Find emails`, `Score with AI`, `Write emails`, and `Export CSV`. |
| **Lead Side Panel** | Slides in from the right. Displays company website, verified emails, personalized email drafts, QC status badge, and history log. |

---

## 3. Pipeline Kanban Board Rules

| Column | Stage Definition |
|---|---|
| **Lead** | Discovered prospects ready for initial outreach. |
| **Contacted** | Leads currently active in an automated campaign. |
| **Meeting** | Leads who replied and scheduled a discovery call. |
| **Won** | Signed clients. Prompts for deal value in dollars. |
| **Lost** | Disqualified or uninterested leads. Prompts for loss reason. |

- Cards are draggable between columns.
- Dropping a lead into **Won** or **Lost** triggers immediate state persistence via `set_lead_result`.
