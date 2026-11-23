# Kestrel Admin Portal Plan

Status: planned · Written 23 Nov 2026 · Owner of this plan: Affan

## 1. Why

Today "Owner" means two different things:
- the **platform admin** (Kestrel itself: Affan), and
- the **team owner** (a customer who runs their own team).

The Owner page is shown to every user. When the database refuses a non-admin, the page shows
made-up numbers (38 people, $2,840/month, "David Kim", "Claire Dupont"). Real data stays protected
by the database, but the page is confusing and dishonest. This plan separates the two worlds.

## 2. Two separate worlds

| | Platform Admin (Kestrel) | Team Owner (customer) |
|---|---|---|
| Who | Affan, later support staff | The person who runs a team using Kestrel |
| Sees | All teams, users, revenue, usage, health | Only their own team |
| Where | Separate Admin Portal: `/admin`, later `admin.kestrelleads.com` | Inside the app: Settings → Team / Billing |
| Login | Admin account + 2-step verification required | Normal login |

## 3. Roles

| Level | Role | Can do |
|---|---|---|
| Platform | Super admin | Everything: AI keys, prices, plans, suspend teams |
| Platform | Support (later) | See users, answer messages, reset limits. No money, no keys. |
| Platform | Finance viewer (later) | Revenue reports only |
| Team | Owner | Billing, invite/remove members, team settings, export/delete own team data |
| Team | Manager | Campaigns, leads, sequences, mailboxes |
| Team | Member / Viewer | Work / read only |

Platform roles live in their own table (not the team `members` table). Every platform check
happens in the database (SECURITY DEFINER + role check), never only in the UI.

## 4. Admin Portal sections

| # | Section | Answers |
|---|---|---|
| 1 | Overview | Sign-ups today/7d/30d, active users, paying teams, MRR, trial → paid % |
| 2 | Who is coming | Every person: source, country, "heard from", plan, last active, leads, emails sent |
| 3 | Growth funnel | Sign-up → Your business filled → mailbox connected → first campaign → first reply → paid |
| 4 | Usage & AI cost | AI cost per team, email-finder calls, emails per day |
| 5 | Deliverability & abuse | High bounce / spam teams, auto-paused mailboxes, suspicious sign-ups |
| 6 | Revenue | Subscriptions, failed payments, refunds, offer codes used |
| 7 | Support | Contact messages, reply from one place |
| 8 | System health | Background jobs, errors (Sentry), failed sends |
| 9 | Controls | Change plan/access, suspend team, feature flags per team, reset limits, AI keys/models, offers, announcements |
| 10 | Admin audit log | Every admin action: who, what, when. Append-only. |

Already exists inside today's Owner page (move, don't rebuild): People, Usage, Access codes,
Creators, Offers, Assistant (AI keys), Google sign-in, Email verifier, Messages.

## 5. Safety rules

- No fake or sample data outside demo mode. On error: an honest message.
- No "log in as user". At most a read-only "view as", always written to the audit log.
- Admin portal requires 2-step verification.
- Every new table: RLS + a cross-tenant test on staging before live.
- Staging first, always. Nothing runs on live without a before/after check.

## 6. Build order

| Step | Work | Done when |
|---|---|---|
| A1 | Hide Owner from non-admins, remove fake fallback data, find all other hardcoded sample data | Non-admin: no Owner nav, `/app?view=owner` → Home; no fake data anywhere |
| A2 | Split roles: `platform_admins` table (super_admin / support / finance), database checks | Old `is_admin` replaced; tested on staging with 3 users |
| A3 | Move Owner → `/admin` portal: own layout, 2-step login, admin audit log | `/admin` reachable only by platform admins; every action logged |
| A4 | Who is coming + growth funnel | Real numbers match the database |
| A5 | Revenue + usage/AI cost + health + abuse | Each number traced to its source |
| A6 | Controls: suspend team, feature flags, limits, announcements | Each control logged and reversible |
| A7 | Team Owner settings cleaned up (customer side) | Owner sees only own team; tests prove it |
| A8 | Support inbox | Messages + replies in one place |
