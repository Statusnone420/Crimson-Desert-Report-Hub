# Technology Stack

**Analysis Date:** 2026-07-09

## Languages

**Primary:**
- TypeScript (>=5.0, inferred from `typescript` compiler and config) - all application and API code under `src/` and shared libraries under `src/lib/`

**Secondary:**
- SQL (PostgreSQL DDL) - database migrations in `supabase/migrations/*.sql`

## Runtime

**Environment:**
- Node.js (Next.js runtime) - configured in CI and used by app and tooling, see `.github/workflows/ci.yml` and `.github/workflows/hourly-scan.yml`

**Package Manager:**
- npm (lockfile present)
- Lockfile: `package-lock.json`

## Frameworks

**Core:**
- Next.js `16.2.10` - app router and API routes in `src/app/`
- React `19.2.4` - UI components in `src/components/`, `src/app/`
- React DOM `19.2.4` - rendering runtime under `src/app/`

**Testing:**
- Vitest `^3.2.4` - configured in `vitest.config.ts`
- Playwright `1.56.1` (test package) - configured in `playwright.config.ts`

**Build/Dev:**
- TypeScript `^5.9.2` - configured in `tsconfig.json`
- ESLint via `eslint.config.mjs` and `eslint` package for lint checks in CI
- Tailwind/PostCSS stack via `@tailwindcss/postcss` and `autoprefixer` for styling

## Key Dependencies

**Critical:**
- `next` `16.2.10` - frontend framework and API route host (`src/app`)
- `@supabase/supabase-js` `^2.110.0` - data persistence client in `src/lib/supabase.ts`
- `zod` `^4.4.3` - schema/validation helpers used across route and service inputs
- `tailwindcss` `4.1.12` and `@tailwindcss/postcss` - style pipeline

**Infrastructure:**
- `@radix-ui/*` packages (`react-dialog`, `react-context-menu`) - UI primitives in form and admin components
- `@tanstack/react-query` `^5.84.2` - client data-loading patterns
- `nodemailer` `^6.10.1` - potential outbound notification support in `package.json` (not a mandatory runtime path in every request)

## Configuration

**Environment:**
- Environment values are read at runtime through `process.env` checks in `src/lib/env.ts`, `src/lib/supabase.ts`, `src/lib/turnstile.ts`, and route handlers.
- Required runtime flags are defined and validated in `src/lib/env.ts`.

**Build:**
- `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `vitest.config.ts`, `playwright.config.ts`, `tailwind.config.ts`, `postcss.config.mjs`

## Platform Requirements

**Development:**
- Node.js 22 in CI matrix (`.github/workflows/ci.yml`)
- Windows and macOS test matrix in CI (`.github/workflows/ci.yml`)

**Production:**
- Vercel project metadata in `.vercel/project.json`
- Scheduled execution via Cloudflare Worker in `cloudflare/scanner-cron/`

---

*Stack analysis: 2026-07-09*
