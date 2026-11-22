# KESTREL — Independent Audit Reviewer Handoff

> **Repository:** https://github.com/affanibnazad/Kestrel  
> **Prepared For:** Independent Technical Reviewer (ChatGPT)  
> **Date:** 22 November 2026  
> **Author:** Antigravity AI Engineering Assistant  
> **Founder:** Affan Ibn Azad (Norven Studio)  

---

## 1. Executive Summary

This handoff document provides a concise, structured entry point for an external independent technical reviewer (ChatGPT) conducting an architectural and security audit of the **Kestrel** platform.

The current code reflects the completed **Phase 1.5 Production Readiness Baseline** plus the recent **Embedded AI Chat Bot Integration** inside the primary dashboard view (`src/app/app/assistant-view.tsx`).

---

## 2. Current Git State & Verification Coordinates

- **GitHub Repository**: `https://github.com/affanibnazad/Kestrel`
- **Active Branch**: `main`
- **Latest Development Phase Completed**: **Phase 1.5 Production Readiness Baseline** (with outstanding security requirements preserved in `docs/KESTREL_SECURITY_BACKLOG.md`).
- **Clean Build Status**: Next.js 16.4.6 production build passed (**93 / 93 routes compiled**, 0 TypeScript errors).
- **ESLint Status**: 0 errors, 1 cosmetic warning (`router` unused in `src/app/app/shell.tsx:150:9`).
- **Security Tests Status**:
  - `npm run test:multitenant`: **25 / 25 Passed** (PostgreSQL RLS boundaries).
  - `npm run test:all`: **177 / 177 Passed** (Security headers, SSRF, asset integrity, path traversal).
  - Browser tests (`test:auth`, `test:errors`, `test:navigation`): `ERR_MODULE_NOT_FOUND` (Playwright package not installed locally).

---

## 3. How to Run the Project Locally

### 3.1 Prerequisites
- Node.js `v20.x` or `v22.x` (verified running on Node.js `v24.13.1`).
- npm `v10.x` or higher.

### 3.2 Installation & Build
```bash
# Clone the repository
git clone https://github.com/affanibnazad/Kestrel.git
cd Kestrel

# Install dependencies
npm install

# Run TypeScript static type check
npx tsc --noEmit

# Run ESLint check
npm run lint

# Compile optimized production build
npm run build
```

### 3.3 Running the Development & Preview Servers
```bash
# Start local development server on port 3333
npm run dev

# Or start the compiled production server on port 3333
npm run start
```

### 3.4 Navigating in Demo Preview Mode
Without connecting a live Supabase database instance, the dashboard is fully inspectable using the synthetic demo sandbox:
- **Full Dashboard Overview**: `http://localhost:3333/app?preview=1`
- **Campaigns Pipeline**: `http://localhost:3333/app?preview=1&view=campaigns`
- **Leads & Enrichment**: `http://localhost:3333/app?preview=1&view=leads`
- **Unified Inbox & Replies**: `http://localhost:3333/app?preview=1&view=inbox`
- **Embedded Kestrel AI Chat**: `http://localhost:3333/app?preview=1&view=ai`
- **Standalone AI Chat**: `http://localhost:3333/kestrel-ai-chat`
- **Sign-in Screen**: `http://localhost:3333/login`

---

## 4. Key Review Focus Areas for the Independent Auditor

The independent auditor is invited to focus review on the following critical architectural and security surfaces:

1. **PostgreSQL RLS Policies (`supabase/migrations/`)**:
   - Inspect the 69 SQL migrations, specifically `001_accounts.sql`, `009_access.sql`, `016_campaigns.sql`, and `069_grant_my_team_id.sql`.
   - Verify that all tenant queries enforce `WHERE team_id = my_team_id()`.
   - Review the remaining uncertified tables noted in `L-04`.
2. **Edge Proxy Perimeter Defense (`src/proxy.ts`)**:
   - Verify host header filtering, open redirect prevention, and SSRF address validation.
3. **Download Route Path Traversal Defense (`src/app/app/download/[file]/route.ts`)**:
   - Verify token whitelisting and rejection of arbitrary directory paths.
4. **View Error Containment (`src/components/view-error-boundary.tsx`)**:
   - Verify component error boundary lifecycle and recovery actions.
5. **Outstanding Security Backlog Items (`docs/KESTREL_SECURITY_BACKLOG.md`)**:
   - Review the 5 active limitations (`L-01` through `L-05`) and their required verification criteria before production launch.
