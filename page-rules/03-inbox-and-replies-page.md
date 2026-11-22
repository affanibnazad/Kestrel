# Page Rules 03: Inbox & Replies Page

The Inbox (Unibox) aggregates responses across all connected email accounts, categorizes intent, and provides a rich reply composer.

---

## 1. Key Components
- Primary Inbox View: `src/app/app/inbox-view.tsx`
- Conversation Box & Editor: `src/app/app/reply-box.tsx`
- Scheduled Sending Engine: `src/lib/answer-mail.ts`

---

## 2. Layout & UI Specifications

| Feature | Design Standard |
|---|---|
| **2-Card Floating Inbox** | Left card: Thread list + 56px slim icon navigation rail. Right card: Active message thread & composer. |
| **Icon Rail** | 56px width, centered icons with tooltips. Icons remain fully visible when sidebar is collapsed. |
| **Snooze Dropdown** | Capsule pill trigger with single outer line. Zero nested inner button shapes. |
| **Filter Tabs** | Capsule toggle pills: `All Mails`, `Unread`, `Archive`. |
| **Composer Formatting** | Clean editor toolbar: Font size `Normal` button (28px height, 10px/24px padding with custom chevron), Bold, Italic, Link, Lists, Alignments. |
| **Unified Send Button** | Integrated capsule pill combining `Send Message` and schedule clock icon with continuous gradient ramp (`#6366F1` to `#8B5CF6`). |
| **Send Later Popover** | Dropdown options: Tomorrow 9:00 AM, Monday 9:00 AM, Custom date & time. Never clipped by card borders. |

---

## 3. Outreach Communication Rules
- First replies never mention pricing, packages, or trials.
- Conversational goal: securing a 15-minute introductory call.
