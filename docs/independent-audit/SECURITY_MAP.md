# KESTREL — Security Implementation Code Map

> **Repository:** https://github.com/affanibnazad/Kestrel  
> **Prepared For:** Independent Technical Audit (ChatGPT)  
> **Date:** 22 November 2026  
> **Classification:** Security Code Map / Audit Preparation  

---

> [!WARNING]
> **AUDIT DISCLAIMER**:
> This document is a **code map**, identifying where security controls are implemented in the Kestrel codebase. It is **NOT** a security approval, certification, or penetration test sign-off. It does not claim that these implementations are bug-free, complete, or impenetrable.

---

## 1. Security Control Mapping Matrix

| Security Domain | Specific Control | Implementing Source Files | Function / Implementation Details |
|---|---|---|---|
| **Authentication** | Magic Link & OAuth Sign-in | `src/app/login/page.tsx`<br>`src/app/login/form.tsx`<br>`src/app/auth/callback/route.ts` | Supabase GoTrue Auth client calls with PKCE code exchange and token caching. |
| **Authentication** | Server-side User Validation | `src/lib/supabase/server.ts`<br>`src/app/app/page.tsx` | `currentUser()` reads session cookies via `@supabase/ssr`; redirects to `/login` if absent. |
| **Session Management** | Cookie Storage & Refresh | `src/lib/supabase/server.ts` | Secure, HTTP-only cookie handlers managing access and refresh tokens. |
| **Authorization & RBAC** | Role Verification (Owner) | `src/app/api/billing/checkout/route.ts`<br>`src/app/app/owner-view.tsx` | Asserts `account.role === "owner"` before allowing billing mutations or team seat alterations. |
| **Authorization & RBAC** | Role Verification (Viewer Read-Only) | `src/app/app/shell.tsx`<br>`src/app/app/inbox-view.tsx`<br>`src/app/app/campaigns-view.tsx` | Prop `editable` disabled when role is `viewer`; mutating UI controls hidden or disabled. |
| **Tenant Isolation** | PostgreSQL Row Level Security | `supabase/migrations/` (001–069) | 100% of 54 tables have RLS enabled (`relrowsecurity = true`) enforcing `WHERE team_id = my_team_id()`. |
| **Tenant Isolation** | Forward RLS Migration (DEF-03) | `supabase/migrations/069_grant_my_team_id.sql` | Grants `EXECUTE` on `public.my_team_id(boolean)` to `authenticated` role. |
| **Tenant Isolation** | Stale Client State Elimination | `src/app/app/campaigns-view.tsx`<br>`src/app/app/inbox-view.tsx`<br>`src/app/app/sequences-view.tsx` | `reqGenRef` and `activeTeamRef` discard in-flight async responses when team switches. |
| **Privileged Database Code** | SECURITY DEFINER Execution | `supabase/migrations/` (various) | 212 functions marked `SECURITY DEFINER`; 100% have explicit `SET search_path = public` (or vault/extensions). |
| **API Perimeter Defense** | Host Header Whitelisting | `src/proxy.ts` | Regex `OWN_HOSTS` matches incoming `Host` header; redirects unauthorized hosts with HTTP 308. |
| **API Perimeter Defense** | Rate Limiting & SSRF Guard | `src/proxy.ts` | Intercepts target URLs; blocks local/internal private IP ranges (127.0.0.1, 10.0.0.0/8, 192.168.0.0/16). |
| **API Perimeter Defense** | HMAC Webhook Verification | `src/app/api/billing/webhook/route.ts` | Verifies cryptographic signature header against webhook signing secret before processing. |
| **File Permissions & Traversal** | Path Traversal Protection | `src/app/app/download/[file]/route.ts` | Whitelists exact token identifiers (`extension`, `kit`, `mcp`); blocks `..`, `%2F`, absolute paths. |
| **Binary Verification** | SHA-256 Checksum Validation | `src/app/connect/update/route.ts`<br>`public/verifier/server.mjs` | Compares downloaded binaries against signed SHA-256 metadata hashes before distribution. |
| **Secrets & Keys Isolation** | Environment Variable Hygiene | `src/lib/supabase/config.ts`<br>`.gitignore`<br>`.env.example` | Zero server secrets (SMTP passwords, Stripe keys, Resend tokens) prefixed with `NEXT_PUBLIC_`. |
| **UI Fault Isolation** | View Error Boundaries | `src/components/view-error-boundary.tsx`<br>`src/app/app/shell.tsx` | Traps runtime exceptions in individual views; prevents complete dashboard white-screen crash. |

---

## 2. PostgreSQL Row Level Security (RLS) Policy Architecture

All 54 tables in the schema enforce Row Level Security:

1. **`team_id` Ownership**: Every tenant record is stamped with a non-nullable `team_id` UUID referencing `accounts.id`.
2. **Helper Function Evaluation**:
   - `public.my_team_id()`: Returns the active team UUID for `auth.uid()`.
   - `public.is_member(team_id uuid)`: Evaluates whether `auth.uid()` has an active row in `team_members`.
   - `public.can_edit(team_id uuid)`: Asserts whether the member has `owner`, `admin`, or `member` role (blocking `viewer`).
3. **Defense Against IDOR**:
   - `SELECT` policies: `USING (team_id = my_team_id())`
   - `INSERT` policies: `WITH CHECK (team_id = my_team_id() AND can_edit(team_id))`
   - `UPDATE` policies: `USING (team_id = my_team_id() AND can_edit(team_id))`
   - `DELETE` policies: `USING (team_id = my_team_id() AND can_edit(team_id))`

---

## 3. Storage & Download Restriction Implementation

- **Restricted Endpoint**: `src/app/app/download/[file]/route.ts`
- **Access Rule**: Requires an authenticated user session (`currentUser()`); unauthenticated callers receive HTTP 307 redirect to `/login`.
- **Token Whitelist**: Only pre-compiled, static export files (`extension`, `kit`, `mcp`) are served. Arbitrary file path requests or path traversal attempts return HTTP 307 or 404.

---

## 4. Secret & Credential Boundary

- **Client Code**: Only reads `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
- **Server Code**: Accesses private credentials (`RESEND_API_KEY`, `MAIL_SERVER_SECRET`, `ANTHROPIC_API_KEY`, `VERIFIER_SECRET`) strictly within serverless route handlers (`src/app/api/`).
- **Git Tracking**: `.gitignore` excludes all `.env*` files (except `.env.example`), private tokens (`.vercel-token`, `.resend-key`, `.mail-secret`, etc.), and temporary files.
