# External Integrations

**Analysis Date:** 2026-07-09

## APIs & External Services

**Ingestion Sources:**
- Reddit API - community content collection for report sources in `src/lib/reddit.server.ts`
  - SDK/Client: direct `fetch` calls (no official SDK wrapper)
  - Auth: OAuth client credentials and basic auth in `src/lib/reddit.server.ts` using `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_USER_AGENT`

- Tavily Search API - web search and content extraction in `src/lib/automation/search.ts`
  - SDK/Client: direct `fetch` calls to `https://api.tavily.com/search` and `/extract`
  - Auth: `TAVILY_API_KEY`

**LLM/AI Processing:**
- OpenRouter API - structured extraction, moderation, and content generation in `src/lib/automation/extract.ts`, `src/lib/ai.ts`, `src/lib/moderation.ts`
  - SDK/Client: direct `fetch` calls to `https://openrouter.ai/api/v1/chat/completions`
  - Auth: `OPENROUTER_API_KEY`
  - Model routing and budget controls in `src/lib/automation/extract.ts` and `src/lib/env.ts`

- Groq API - optional chat completions fallback route in `src/lib/ai.ts`
  - SDK/Client: direct `fetch` to `https://api.groq.com/openai/v1/chat/completions`
  - Auth: `OPENROUTER_API_KEY`/provider configuration in code; Groq API key usage not present in source as an independent env variable

**Bot Protection:**
- Cloudflare Turnstile - anti-bot verification for user submissions in `src/lib/turnstile.ts` and `src/app/report/ReportForm.tsx`
  - Client script: `https://challenges.cloudflare.com/turnstile/v0/api.js`
  - Verification endpoint: `https://challenges.cloudflare.com/turnstile/v0/siteverify`
  - Auth: `TURNSTILE_SECRET_KEY`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`

**Data Sources (Public Web):**
- Official Patch Notes scraping (Pearl Abyss) for fallback source enrichment in `src/lib/officialPatch.ts`
  - Auth: none; public endpoint GETs to `https://blue-protocol.jp/patch-notes/`

## Data Storage

**Databases:**
- Supabase Postgres - central data store in `src/lib/supabase.ts` and API handlers under `src/app/api/admin/*`
  - Connection: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
  - Client: `@supabase/supabase-js`
  - Migrations: `supabase/migrations/*.sql`

**File Storage:**
- Not detected in code paths under source (`.`, `src/`, `cloudflare/`)

**Caching:**
- Not detected

## Authentication & Identity

**Auth Provider:**
- Custom admin/session auth in `src/lib/adminGuard.ts` and `src/lib/session.ts`
  - Admin access token/session created from `ADMIN_PASSWORD` and `SESSION_SECRET`
  - HMAC token validation in `src/app/api/admin/login/route.ts`

- Cron/job auth: shared secret bearer token in `src/app/api/cron/*/route.ts` and `cloudflare/scanner-cron/src/index.ts`
  - Secret: `CRON_SECRET`

## Monitoring & Observability

**Error Tracking:**
- Not detected in application source

**Logs:**
- Standard Node/runtime logging used in route handlers and scripts (`console` output and structured errors)
- Keepalive and cron execution monitoring described in `docs/OPERATIONS.md` and `.github/workflows/hourly-scan.yml`

## CI/CD & Deployment

**Hosting:**
- Vercel (project metadata and runtime assumption from `.vercel/project.json` and Next.js deployment posture)

**CI Pipeline:**
- GitHub Actions in `.github/workflows/ci.yml` and `.github/workflows/hourly-scan.yml`
  - `ci.yml` runs `npm run lint`, `npm run test`, `npm run test:e2e`, `npm run build`
  - `hourly-scan.yml` executes cron endpoint with `CRON_SECRET`

**Scheduled Workers:**
- Cloudflare Workers project in `cloudflare/scanner-cron/` with schedule in `cloudflare/scanner-cron/wrangler.jsonc`

## Environment Configuration

**Required env vars:**
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` - `src/lib/supabase.ts`
- `ADMIN_PASSWORD`, `SESSION_SECRET` - `src/lib/adminGuard.ts`, `src/lib/session.ts`
- `CRON_SECRET` - `src/app/api/cron/*/route.ts`, `cloudflare/scanner-cron/src/index.ts`
- `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_USER_AGENT` - `src/lib/reddit.server.ts`, `src/lib/env.ts`
- `TAVILY_API_KEY` - `src/lib/automation/search.ts`
- `OPENROUTER_API_KEY`, `OPENROUTER_FREE_MODEL` - `src/lib/automation/extract.ts`, `src/lib/ai.ts`
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` - `src/app/report/ReportForm.tsx`, `src/lib/turnstile.ts`
- `AUTOMATION_BUDGET_USD_MONTHLY`, `AUTOMATION_SUBREDDITS` - `src/lib/automation/*`

**Secrets location:**
- Environment file convention (`.env.local` / `.env.local.example`); never read actual secret values from repository files
- Deployment providers (Vercel, GitHub Actions, Cloudflare Worker) via secret/variable settings

## Webhooks & Callbacks

**Incoming:**
- `CRON_SECRET`-protected scheduled callbacks in `.github/workflows/hourly-scan.yml` and `cloudflare/scanner-cron/src/index.ts` hitting `src/app/api/cron/keepalive/route.ts`

**Outgoing:**
- No inbound callback webhooks detected besides scheduled job triggers
- Scheduled outbound calls from worker to app in `cloudflare/scanner-cron/src/index.ts` and from CI in `.github/workflows/hourly-scan.yml`

---

*Integration audit: 2026-07-09*
