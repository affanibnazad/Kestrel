# Page Rules 07: How to Build Part-by-Part

This guide provides a step-by-step developer tutorial for adding or modifying pages in Kestrel modularly.

---

## 1. How Page Routing Works

The entire app is managed through the central shell:
```text
src/app/app/page.tsx   → Initializes account and theme (Light, Dark, Gradient, Auto)
src/app/app/shell.tsx  → Controls sidebar navigation, layout state, and view switching
```

When a user clicks a sidebar item, `shell.tsx` renders the corresponding view component:
- `view === "home"` → `<HomeView />`
- `view === "campaigns"` → `<CampaignsView />`
- `view === "leads"` → `<LeadsView />`
- `view === "pipeline"` → `<PipelineView />`
- `view === "inbox"` → `<InboxView />`
- `view === "mailboxes"` → `<MailboxesView />`
- `view === "ai"` → `<AssistantView />`
- `view === "bot_room"` → `<BotRoom />`
- `view === "about"` → `<AboutView />`
- `view === "deliverability"` → `<DeliverabilityView />`
- `view === "analytics"` → `<AnalyticsView />`
- `view === "dnc"` → `<DncView />`

---

## 2. Step-by-Step: Adding a New Page or Part

Follow these 4 steps to add any new section:

### Step 1: Create the View Component
Create a new file in `src/app/app/<feature>-view.tsx`:
```tsx
"use client";

import { useState } from "react";

export default function NewFeatureView({ account, toast }: { account: any; toast: (t: string) => void }) {
  const [tab, setTab] = useState<"tab1" | "tab2">("tab1");

  return (
    <div className="app-page">
      <header className="head">
        <div>
          <h1>My New Feature</h1>
          <span className="sub">Describe what this page does in one simple line</span>
        </div>
        <div className="head-actions">
          {/* Always use capsule toggle tablist */}
          <div className="seg" role="tablist">
            <button type="button" role="tab" aria-selected={tab === "tab1"} className={tab === "tab1" ? "on" : ""} onClick={() => setTab("tab1")}>
              First Part
            </button>
            <button type="button" role="tab" aria-selected={tab === "tab2"} className={tab === "tab2" ? "on" : ""} onClick={() => setTab("tab2")}>
              Second Part
            </button>
          </div>
        </div>
      </header>

      {/* Main content with flat 1px border cards */}
      <div className="kd-card">
        {tab === "tab1" ? <p>First part content</p> : <p>Second part content</p>}
      </div>
    </div>
  );
}
```

### Step 2: Register in `shell.tsx`
1. Open `src/app/app/shell.tsx`.
2. Import your component:
   ```tsx
   import NewFeatureView from "./new-feature-view";
   ```
3. Add the item to navigation list (`NAV_ITEMS`):
   ```tsx
   { id: "new_feature", label: "New Feature", icon: "sparkle", group: "Setup" }
   ```
4. Add the render branch in `shell.tsx`:
   ```tsx
   : view === "new_feature" ? <NewFeatureView account={account} toast={setToast} />
   ```

### Step 3: Apply Universal Styles
- Tab buttons automatically inherit the capsule toggle rules.
- Action buttons must use `className="btn go"` or `className="btn"` (automatically rounded to `9999px`).
- Never add drop shadows or underlines.

### Step 4: Verify the Build
Run:
```bash
npx next build
```
Ensure 0 compilation errors.
