# Page Rules 06: Your Business & Deliverability

These pages manage core company branding, the offer playbook, DNS records, and email suppression lists.

---

## 1. Key Components
- Your Business Profile: `src/app/app/about-view.tsx` & `src/lib/about.ts`
- Deliverability Health: `src/app/app/deliverability-view.tsx`
- Do Not Contact (DNC): `src/app/app/dnc-view.tsx` & `src/lib/dnc.ts`

---

## 2. Your Business Rules
- **Modes**: Agency, Solo creator, White-label partner.
- **Offer Playbook**:
  - One-line statement: *"We're a small post-production studio that agencies use when video work piles up."*
  - Proof points: Real client cases and verified stats.
  - Banned words filter: Automatically flags buzzwords (elevate, leverage, seamless, cutting-edge).

---

## 3. Deliverability & DNC Rules
- **DNS Records Check**:
  - Validates **SPF** (`v=spf1 ...`), **DKIM**, and **DMARC** (`v=DMARC1; p=none`).
  - Displays clear DNS setup instructions if any record is missing.
- **Do Not Contact (DNC)**:
  - Table showing blocked emails and domains.
  - Quick action buttons: `Add new`, `Import CSV`, `Export CSV` (capsule buttons).
  - Suppression is enforced automatically across all campaigns before sending.
