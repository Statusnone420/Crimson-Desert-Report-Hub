# Architecture

**Analysis Date:** 2026-07-09

## System Overview

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│                          Next.js App Router Frontend                         │
├───────────────────────┬──────────────────────┬───────────────────────────────┤
│ Public Pages           │ Admin Pages          │ API Routes                    │
│ `src/app/page.tsx`     │ `src/app/admin/*.tsx` │ `src/app/api/**/*.ts`         │
│ `src/app/issues/page.tsx`                                              │
│ `src/app/report/page.tsx`                                              │
│ `src/app/scanner/page.tsx`                                             │
└──────────────┬────────┴──────────────┬───────┴──────────────┬──────────────────┘
               │                       │                      │
               ▼                       ▼                      ▼
        ┌───────────────────────────────────────────────────────────────┐
        │                 Shared Domain Services                         │
        │ `src/lib/*.ts`, `src/components/*.tsx`, `src/lib/automation`   │
        └───────────────────────────────────────────────────────────────┘
                          │                │
                          ▼                ▼
        ┌───────────────────────────────────────────────────────┐
        │        Persistence + External Integrations           │
        │ `src/lib/supabase.ts`, `src/lib/officialPatch*.ts`,     │
        │ `src/lib/reddit.ts`, `src/lib/turnstile.ts`, caches     │
        └───────────────────────────────────────────────────────┘
                          │
                          ▼
        ┌───────────────────────────────────────────────────────┐
        │          Supabase Database + Cron-Scheduled Jobs       │
        │         (issue store, clusters, scan runs, jobs)      │
        └───────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| App Shell | Global layout, metadata, global CSS, and route registration | `src/app/layout.tsx`, `src/app/globals.css`, `src/app/robots.ts`, `src/app/sitemap.ts` |
| Public Pages | Read-only dashboard, issue list, scanner overview, report submission entry | `src/app/page.tsx`, `src/app/issues/page.tsx`, `src/app/scanner/page.tsx`, `src/app/report/page.tsx`, `src/app/about/page.tsx` |
| Admin Pages | Scan controls, policy toggles, login, compile/output and monitoring UIs | `src/app/admin/page.tsx`, `src/app/admin/login/page.tsx`, `src/app/admin/compile/page.tsx`, `src/app/admin/source-monitor/page.tsx` |
| API Ingestion | Validates and persists public report payloads | `src/app/api/reports/route.ts` |
| Admin API | Authenticated control surface for scan lifecycle and operator actions | `src/app/api/admin/login/route.ts`, `src/app/api/admin/scan/route.ts`, `src/app/api/admin/status/route.ts`, `src/app/api/admin/scan/status/route.ts`, `src/app/api/admin/export/route.ts` |
| Cron API | Scheduled maintenance and scanner trigger endpoints | `src/app/api/cron/keepalive/route.ts`, `src/app/api/cron/source-preview/route.ts` |
| Shared Components | Presentation primitives and role-specific views | `src/components/NavLinks.tsx`, `src/components/SubmitButton.tsx`, `src/components/scanner/PublicScannerView.tsx`, `src/components/scanner/AdminScannerView.tsx` |
| Action Server Functions | Admin mutations and side effects from UI flows | `src/app/admin/actions.ts` |
| Query Layer | Cached read models for pages and dashboard slices | `src/lib/queries.ts`, `src/lib/aggregates.ts` |
| Claim/Issue Domain | Source and cluster claim flow, evidence structures | `src/lib/claims.ts`, `src/lib/evidence.ts`, `src/lib/evidenceLadder.ts`, `src/lib/patchWatch.ts` |
| Automation Orchestrator | Orchestrates scan planning, scheduling, extraction, promotion | `src/lib/automation/run.ts`, `src/lib/automation/runDisplay.ts` |
| Automation Subsystems | Budgeting, eligibility, search, extraction, dedupe, promotion | `src/lib/automation/*.ts` |
| Data Layer | Supabase session + client wrapper; cache helpers and tag strategy | `src/lib/supabase.ts`, `src/lib/cacheTags.ts`, `src/lib/revalidate.ts` |
| Security & Gatekeeping | Session/hmac guards and preview/env/runtime protections | `src/lib/session.ts`, `src/lib/adminGuard.ts`, `src/lib/previewGuard.ts`, `src/lib/env.ts` |

## Pattern Overview

**Overall:** Route-first, service-oriented architecture inside a single Next.js app.

**Key Characteristics:**
- Route groups are the primary boundary (`src/app/...` for request entry and feature views).
- Business logic is extracted into `src/lib` modules, with orchestration split in `src/lib/automation`.
- Caching/revalidation and moderation happen at the route boundary before persisted writes.
- Background behavior is represented as HTTP cron handlers + scheduler state stored in the same domain data model.

## Layers

**Presentation Layer:**
- Purpose: Render pages and collect operator/user input.
- Location: `src/app/*`, `src/components/*`
- Contains: Server-rendered React pages and client islands.
- Depends on: Query services and admin actions.
- Used by: Operators and public users.

**Application/API Layer:**
- Purpose: Validate request shapes, enforce auth/guards, route to domain services.
- Location: `src/app/api/*`, `src/app/admin/actions.ts`
- Contains: Route handlers, form handlers, cache tag revalidation calls, export actions.
- Depends on: Query/data services and automation modules.
- Used by: Presentation and scheduled invocations.

**Domain Layer:**
- Purpose: Apply business rules for reports, moderation, patch tracking, claims, evidence, scanner decisions.
- Location: `src/lib/*.ts`, `src/lib/automation/*.ts`
- Contains: Pure/async service functions and bounded domain steps.
- Depends on: Validation, environment, external clients, persistence.
- Used by: API routes and action handlers.

**Infrastructure Layer:**
- Purpose: External service access and persistence.
- Location: `src/lib/supabase.ts`, `src/lib/reddit.ts`, `src/lib/turnstile.ts`, `src/lib/reddit.server.ts`, `src/lib/officialPatch.server.ts`
- Contains: database client config, adapters, third-party integrations, environment fallbacks.
- Depends on: env helpers (`src/lib/env.ts`) and external credentials.
- Used by: Domain layer services.

## Data Flow

### Primary Public Report Path

1. User opens reporting UI in `src/app/report/page.tsx` and submits `ReportForm` (`src/app/report/ReportForm.tsx`).
2. Form issues `POST /api/reports` handled by `src/app/api/reports/route.ts`.
3. Route validates payload through `src/lib/reportSchema.ts` and moderation checks in `src/lib/moderation.ts`.
4. Data is normalized and persisted through `src/lib/supabase.ts` client calls.
5. Cache tags in `src/lib/revalidate.ts` / `src/lib/cacheTags.ts` are updated; public read paths refresh from `src/lib/queries.ts`.

### Scanner and Scan Run Path

1. Operator triggers scan manually from admin UI or server action.
2. Protected endpoints in `src/app/api/admin/scan/route.ts` or `src/app/admin/actions.ts` enforce `src/lib/adminGuard.ts` and `src/lib/session.ts`.
3. Scan entry calls `startAutomationScan` in `src/lib/automation/run.ts`.
4. Orchestration executes `schedule → settings → search → memory → relevance → extract → route/promote` modules.
5. Outcomes are written to scan and cluster tables through persistence helpers; run display uses `src/lib/automation/runDisplay.ts`.
6. `/api/admin/status`, `/api/admin/scan/status`, and `/api/admin/export` expose operational state and artifacts.

### Cron-Driven Path

1. External scheduler calls `GET /api/cron/keepalive` and `GET /api/cron/source-preview`.
2. Cron handlers check policy and schedule state (`src/lib/automation/schedule.ts`, `src/lib/previewGuard.ts`).
3. On allow, they call into `runAutomationMonitor` / `startAutomationScan`; failed/blocked runs are recorded via skip/error metadata.

### State Management

- Primary state source is Supabase tables (`src/lib/queries.ts` and `src/lib/automation/*.ts` read/write assumptions).
- In-memory state is only transient per request; run summaries are derived on demand.
- Cache-derived state is controlled using Next cache tags (`src/lib/cacheTags.ts`) and `unstable_cache`.

## Key Abstractions

**Automation run:**
- Purpose: Encapsulate one full scan execution from gating to publication.
- Examples: `src/lib/automation/run.ts`, `src/lib/automation/runDisplay.ts`, `src/lib/automation/route.ts`
- Pattern: Stepwise pipeline with explicit status/result codes and fallback branches.

**Patch context:**
- Purpose: Track current patch and claimed fix signals used by moderation and routing.
- Examples: `src/lib/officialPatch.ts`, `src/lib/officialPatch.server.ts`, `src/lib/claims.ts`
- Pattern: Shared canonical state fetched and cached with revalidation hooks.

**Scan candidates / messages:**
- Purpose: Represent prefiltering, extraction, and publish outcomes in human-readable form.
- Examples: `src/lib/evidenceLadder.ts`, `src/lib/evidence.ts`, `src/lib/automation/runDisplay.ts`
- Pattern: Enumerated code mapping with deterministic summary logic.

## Architectural Constraints

- Server/client boundary is explicit: only components/pages marked with `"use client"` render interactive state.
- Route handlers are the mandatory integration boundary for external calls (HTTP, cron, and admin actions).
- Secrets and runtime toggles are centralized through `src/lib/env.ts`; runtime behavior changes via environment config.
- Scan behavior is intentionally conservative: missing credentials/config leads to deterministic fallbacks instead of hard fail.
- No dedicated background worker process exists; automation runs via cron endpoint invocation or admin-triggered request.

## Anti-Patterns

**Observed:** Large orchestration method chaining risk in automation runner (`src/lib/automation/run.ts`) can make path-level tracing harder when one code path mutates many counters and statuses.
**Why it matters:** Debugging skipped/held/publish transitions requires coordinated knowledge of many modules.
**Do this instead:** Keep `run.ts` as coordinator only; factor high-coupling transitions into narrower helpers with explicit return contracts in `src/lib/automation` modules.

## Error Handling

**Strategy:** Route-level guard + typed validation + fallback behavior.

**Patterns:**
- API responses return explicit JSON status for denied auth, unavailable credentials, and validation failures.
- Inputs are validated at ingress (`src/lib/reportSchema.ts`, `src/lib/env.ts`) before mutation.
- Non-critical dependencies often degrade gracefully (e.g., fallback extraction path, delayed publish paths), while critical ones rethrow through route responses.

## Cross-Cutting Concerns

**Logging:** Lightweight runtime logging through route/domain module logs and explicit returned status summaries; cache/reportability is surfaced to admin views.

**Validation:** JSON schema checks, moderation heuristics, and API guard checks are centralized in shared library modules before writes.

**Authentication:** Browser cookies + HMAC token session abstraction in `src/lib/session.ts`, with admin checks wrapped through `src/lib/adminGuard.ts` and `src/app/admin/login/route.ts`.

---

*Architecture analysis: 2026-07-09*
