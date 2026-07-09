# Codebase Structure

**Analysis Date:** 2026-07-09

## Directory Layout

```
.planning/codebase/
├── .github/                 # CI workflows and platform config
├── .next/                   # Next.js build artifacts (generated)
├── cloudflare/              # Cloudflare-related deployment assets/scripts
├── docs/                    # Product and runtime documentation
├── public/                  # Static assets
├── src/                     # Application source
│   ├── app/                 # Next.js routes, pages, API handlers
│   ├── components/          # UI components
│   └── lib/                 # Shared domain/integration services
│       └── automation/      # Scanner automation pipeline
├── supabase/                # Supabase configuration and DB-related files
├── tests/                   # Unit and E2E test suites
│   └── e2e/                 # Browser/test harness specs and screenshots
├── .planning/               # GSD mapping and planning artifacts
├── node_modules/            # Dependencies (generated)
└── package*.json             # Dependency declarations and lockfile
```

## Directory Purposes

**`.github`:**
- Purpose: Repository automation and CI hooks.
- Contains: GitHub workflow definitions, platform metadata.
- Key files: `.github/workflows/*`

**`public`:**
- Purpose: Static images and browser-facing metadata.
- Contains: PNG assets and favicon manifests.
- Key files: `public/logo-*.png` (if present), `public/icon.png`, `public/favicon.ico`

**`src`:**
- Purpose: All runtime application code.
- Contains: routing, UI, domain services, and automation pipeline.
- Key files: `src/app`, `src/components`, `src/lib`

**`src/app`:**
- Purpose: Route-first application structure using Next.js App Router.
- Contains: Server-rendered pages, metadata files, and API routes.
- Key files: `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/api/reports/route.ts`, `src/app/admin/actions.ts`

**`src/app/admin`:**
- Purpose: Administrative pages and actions.
- Contains: admin route pages and action helpers.
- Key files: `src/app/admin/page.tsx`, `src/app/admin/login/page.tsx`, `src/app/admin/compile/page.tsx`, `src/app/admin/actions.ts`

**`src/app/api`:**
- Purpose: Server route handlers for public, admin, and cron actions.
- Contains: report API, admin control API, keepalive/source-preview cron API.
- Key files: `src/app/api/reports/route.ts`, `src/app/api/admin/scan/route.ts`, `src/app/api/cron/keepalive/route.ts`

**`src/components`:**
- Purpose: UI layer and reusable widgets.
- Contains: shared controls, scanner views, and visual outputs.
- Key files: `src/components/NavLinks.tsx`, `src/components/AdminControls.tsx`, `src/components/scanner/PublicScannerView.tsx`, `src/components/scanner/AdminScannerView.tsx`

**`src/lib`:**
- Purpose: Core business logic and integrations.
- Contains: authentication/session utilities, moderation, query builders, Supabase adapter, automation domain.
- Key files: `src/lib/session.ts`, `src/lib/queries.ts`, `src/lib/supabase.ts`, `src/lib/officialPatch*.ts`

**`src/lib/automation`:**
- Purpose: Modular scanner execution chain.
- Contains: budget, scheduling, search/relevance/extraction, promotion, memory, display formatting.
- Key files: `src/lib/automation/run.ts`, `src/lib/automation/schedule.ts`, `src/lib/automation/search.ts`, `src/lib/automation/extract.ts`, `src/lib/automation/promote.ts`, `src/lib/automation/runDisplay.ts`

**`supabase`:**
- Purpose: Supabase-side support files.
- Contains: SQL and support snippets for remote environment.
- Key files: `supabase/config.toml` (if tracked), migration scripts.

**`tests`:**
- Purpose: Behavioral coverage for app routes and automation behavior.
- Contains: unit tests in `tests/*.test.ts`, Playwright specs in `tests/e2e`.
- Key files: `tests/adminStatusRoute.test.ts`, `tests/automationRun.test.ts`, `tests/reportsRoute.test.ts`, `tests/e2e/public-visual.spec.ts`

**`docs`:**
- Purpose: Product and architecture documentation.
- Contains: runbooks and planning references.
- Key files: `docs/*.md`

**`.planning/codebase`:**
- Purpose: Generated GSD mapping documents for future planning stages.
- Contains: stack/integration/architecture/conventions docs.
- Key files: `.planning/codebase/ARCHITECTURE.md`, `.planning/codebase/STRUCTURE.md`

## Key File Locations

**Entry Points:**
- `src/app/layout.tsx`: Global shell and shared metadata.
- `src/app/page.tsx`: Public dashboard entry.
- `src/app/admin/page.tsx`: Admin dashboard entry.
- `src/app/report/page.tsx`: Public report submission entry.

**Configuration:**
- `next.config.ts`: Runtime/build settings.
- `tsconfig.json`: TypeScript path and module options.
- `eslint.config.mjs`, `vitest.config.ts`, `playwright.config.ts`: Lint/test/automation settings.
- `package.json`: Scripts and dependencies.

**Core Logic:**
- `src/lib/queries.ts`: Dashboard and public data reads.
- `src/lib/automation/run.ts`: Scan orchestration entry.
- `src/lib/officialPatch.ts`: Current patch state helpers.
- `src/app/admin/actions.ts`: Mutating admin actions.

**API and Jobs:**
- `src/app/api/reports/route.ts`: Report intake.
- `src/app/api/admin/scan/route.ts`: Scan trigger endpoint.
- `src/app/api/admin/login/route.ts`: Admin session issue endpoint.
- `src/app/api/cron/keepalive/route.ts`: Cron scheduler trigger.

**Testing:**
- `tests/*.test.ts`: Library, route, and unit coverage.
- `tests/e2e/*.spec.ts`: Browser-level feature validation.
- `tests/e2e/__screenshots__/*`: Baseline visual assets.

## Naming Conventions

**Files:**
- Route directories use kebab-case (`admin/login`, `api/admin/export`).
- UI components use PascalCase (`AdminControls.tsx`, `DossierOutput.tsx`).
- Service modules use camelCase and domain descriptors (`adminGuard.ts`, `cacheTags.ts`, `reddit.ts`).
- Migration/orchestrator utility names prefer descriptive nouns + verbs (`run.ts`, `officialPatch.server.ts`).

**Directories:**
- Route group directories reflect feature boundaries (`admin`, `issues`, `report`, `scanner`, `api/cron`, `api/admin`).
- Shared modules are grouped under `src/lib` and `src/lib/automation`.
- Test folders split by scope (`tests` root + `tests/e2e`).

## Where to Add New Code

**New Feature (public or admin):**
- New pages/components: `src/app/<route>/page.tsx`
- Shared view widgets: `src/components`
- Route actions and API handlers: `src/app/admin/actions.ts` (for admin) or `src/app/api/.../route.ts` (for endpoint)

**Automation Enhancements:**
- Add orchestrator behavior in `src/lib/automation` if related to scan flow (`run.ts` for coordination, domain files for specific stages).
- Keep new stage modules small and single-purpose.

**Shared Business Logic:**
- Add to `src/lib/<domain>.ts` and call from routes/actions via explicit imports.
- Prefer explicit, narrow utility exports over broad object bags.

**Tests:**
- Unit and service tests: `tests/<feature>.test.ts`.
- API tests: corresponding `tests/*Route*.test.ts`.
- Visual/interaction tests: `tests/e2e/*.spec.ts` plus `tests/e2e/__screenshots__/`.

**Third-Party Config or Deployment Adjustments:**
- Update `next.config.ts`, provider variables in `.env.local.example`, and any provider-specific docs under `docs/`.

## Special Directories

**`.next`:**
- Purpose: Build output cache.
- Generated: Yes
- Committed: No

**`node_modules`:**
- Purpose: Installed dependencies
- Generated: Yes
- Committed: No

**`tests/e2e/__screenshots__`:**
- Purpose: Deterministic screenshot artifacts for visual tests
- Generated: Yes
- Committed: Sometimes (for baseline snapshots)

**`.planning`:**
- Purpose: Planning metadata consumed by GSD phases
- Generated: Yes
- Committed: Yes

---

*Structure analysis: 2026-07-09*
