# Page Rules 05: Kestrel AI & Bot Room

The Kestrel AI chat interface and Bot Room power AI-driven lead research, email writing, quality control, and platform assistance.

---

## 1. Key Components
- Assistant Chat: `src/app/app/assistant-chat.tsx`
- Assistant Page Container: `src/app/app/assistant-view.tsx`
- Bot Room Dialogue: `src/app/app/bot-room.tsx`
- AI Command Dispatcher: `src/lib/commands.ts`

---

## 2. Chat Interface Rules (T0.9r Standard)

| Feature | Design Standard |
|---|---|
| **User Message Bubble** | Natural right-aligned chat bubble (`border-radius: 20px 20px 4px 20px`). Zero full-width outer container bars. Zero button-in-a-box styling. |
| **Animated Magical K Avatar** | Radiant squircle badge (`linear-gradient(135deg, #4F46E5, #7C3AED, #EC4899)`), crisp white stylized K, animated aura glow, and continuous twinkling sparkle star (`✦`). |
| **Magical Thoughts Process Box** | When busy, displays `✦ Thinking magical thoughts… ✨` inside an iridescent glowing container with step-by-step progress and pulse animation. |
| **Model Selector** | Unique rounded capsule pill (`border-radius: 9999px`) with sparkle indicator (`✦ Kestrel Pro ▾`) and custom chevron. |
| **Bottom Bar Organization** | Left: File attachment clip + Voice mic icon. Center: Rounded `+ New chat` capsule button. Right: Model capsule pill + haptic send button. |
| **Gradient Text Reveal** | Assistant text reveals smoothly with a gradient fade-in and a radiant shimmer beam sweeping across the response. |

---

## 3. Bot Room Rules
- Displays real-time communication between the **Research Bot** (reads company sites) and **Writer & QC Bot** (drafts emails and verifies quality).
- Filter tabs: `All`, `Issues`, `Approvals` (rendered as capsule toggles).
- Holds flagged drafts for one-click approval via `Approve all`.
