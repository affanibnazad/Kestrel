# Page Rules 04: Email Accounts Page

The Email Accounts page manages connected sending mailboxes, warmup ramps, daily sending volumes, and account health.

---

## 1. Key Components
- Primary View: `src/app/app/mailboxes-view.tsx`
- Verification & Test Engine: `src/app/api/mail/test/route.ts` & `src/lib/answer-mail.ts`

---

## 2. Layout & Status Rules

| Element | Specification |
|---|---|
| **Filter Tabs** | Capsule toggle pill with: `All`, `Ready`, `Problem`, `Paused`. |
| **Account Cards** | Flat rounded cards with 1px border. Zero drop shadows. |
| **Status Indicators** | Green dot for `Ready`, Amber dot for `Warming / Paused`, Red dot for `Problem`. |
| **Sending Volume Bar** | Clean progress bar showing sent today vs daily limit (e.g. `18 / 25`). |
| **Health Score** | Percentage score (e.g. `90%`). Green for ≥85%, amber for 70–84%, red for <70%. |
| **Connect Buttons** | Rounded capsule buttons `+ Add Google account` or `+ Add SMTP/IMAP`. |

---

## 3. Account Safety Rules
- Daily volume increases gradually (warmup ramp of +2 emails per day).
- If bounces exceed 1%, status changes to `Problem` and sending pauses automatically.
