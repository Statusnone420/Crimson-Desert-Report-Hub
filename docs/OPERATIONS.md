# Operations Guide

This is the public maintainer guide for running Crimson Desert Report Hub safely. It documents provider boundaries and authorized actions. It intentionally does not publish private query packs, prompt templates, ranking weights, or moderation heuristics.

## Environment ownership

| Place | Store here | Never store here |
| --- | --- | --- |
| Local `.env.local` | Local-only development values. | A committed key, screenshot, or copied production secret. |
| Vercel | Production environment variables and deployment settings. | Private run notes in source control. |
| Supabase | Database, migration history, and server-side schema. | Ad-hoc production SQL outside an approved migration workflow. |
| Cloudflare | DNS, Turnstile, and the scheduled scanner Worker secret. | Application credentials in public Worker code. |
| GitHub | Source, tests, public docs, and review history. | Keys, passwords, private URLs, or raw user submissions. |

## Provider configuration

### Supabase

The application uses Supabase for reports, issue clusters, confirmations, source leads, patch metadata, observations, automation history, and scanner settings. The Vercel deployment needs:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

The service-role key is server-only. It must never reach browser code or a public log.

Migrations live in [`supabase/migrations`](../supabase/migrations). Their filenames are the local history contract. Use the Supabase CLI from the repository:

```powershell
npx --yes supabase login
npx --yes supabase link --project-ref <project-ref>
npx --yes supabase migration list
```

Applying a migration is an owner-authorized release action, not a consequence of reviewing a pull request. After explicit authorization, use the linked CLI workflow, inspect the resulting migration list, and record the verification in the release handoff. If history drifts, use `supabase migration repair`; do not create empty alias migrations or edit `supabase_migrations.schema_migrations` by hand.

### Vercel

Vercel serves the Next.js application and protected API routes. Required production variables are:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ADMIN_PASSWORD`
- `SESSION_SECRET`
- `CRON_SECRET`

Optional or provider-backed variables are documented in [`.env.local.example`](../.env.local.example). The public domain is `https://crimsonreporthub.com`; use the Vercel project dashboard for the current DNS target rather than copying a time-sensitive provider value into documentation.

Public pages may render a safe empty state when server credentials are absent during a build. Protected admin and cron routes fail closed instead.

### Cloudflare

The Worker in [`cloudflare/scanner-cron`](../cloudflare/scanner-cron) is a scheduled-only wake-up trigger for `/api/cron/keepalive`. It has no public fetch endpoint and stores only `CRON_SECRET`.

```powershell
npx wrangler secret put CRON_SECRET --config cloudflare/scanner-cron/wrangler.jsonc
npx wrangler deploy --config cloudflare/scanner-cron/wrangler.jsonc
```

The application, not the Worker, owns scanner policy, budget accounting, and publishing decisions.

### Turnstile

Turnstile is optional spam protection for full report submissions:

- `NEXT_PUBLIC_TURNSTILE_SITE_KEY`
- `TURNSTILE_SECRET_KEY`

Add the production hostname to the widget configuration. The report form remains functional without Turnstile because server validation and rate boundaries still apply. Confirmation taps do not call Turnstile on the normal path.

## Automation posture

- Official patch notes provide patch context and claimed-fix metadata.
- Tavily provides bounded public-web discovery. Real scans stay within the persisted 1,000-credit monthly scan budget, including permitted context extraction. The protected no-write preview also consumes Tavily search credits but does not write the scan ledger; count every preview query against the provider-side 1,000-credit allocation when checking monthly usage.
- High-value provider usage is approved, server-side, and capped at `$2` per UTC month. `OPENROUTER_AUTOMATION_MODEL` defaults to `openai/gpt-5.6-luna`, which is restricted to the first-party OpenAI provider with no automatic provider or model fallback; `deepseek/deepseek-v4-flash` is the explicit manual rollback and retains its ZDR route. The request ceiling is model-specific, so a price above the configured Luna ceiling fails closed.
- Routine moderation and dossier prose use approved low-cost or deterministic fallback paths configured by maintainers.
- Reddit API access and direct subreddit monitoring are permanently off.
- Scheduled scans are patch-aware and policy-controlled. The public contract is the budget and privacy boundary; the search and ranking strategy remains implementation detail.

The protected no-write source preview checks Tavily discovery without publishing:

```bash
curl -H "Authorization: Bearer <CRON_SECRET>" \
  "https://crimsonreporthub.com/api/cron/source-preview?queries=1"
```

It is bounded and deterministic, and it does not write public data or the persisted scan ledger.

When a paid model or its provider routing changes, authenticate on the Vercel preview and use **Test AI provider route** on `/scanner`. That preview-only check sends synthetic text through the configured model with one LLM call and a `$0.005` ceiling. It does not use Tavily or the database, it treats deterministic fallback as failure, and its endpoint cannot call the provider outside Vercel preview.

Preview requests are capped at two Tavily search queries and are intended for occasional connectivity checks, not repeated quota-free probes.

## Admin workflow

1. Open `/admin/login` or the footer `Admin` link.
2. Authenticate with the current `ADMIN_PASSWORD`.
3. Use the admin report queue to approve, reject, or excerpt direct reports.
4. Use `/scanner` to inspect run health, pause/resume scheduled scans, run a no-publish test, or run an authorized capped scan.
5. Use exception controls only for real lifecycle or visibility problems. `Auto` returns a cluster to the engine-owned baseline.
6. Use `/admin/compile` when a maintainer needs an evidence dossier for official support.

Raw reports, rejected candidates, network hashes, and individual confirmation rows are private. Publishing a lead or excerpt is a moderation decision, not an automatic consequence of discovery.

## Production smoke test

After a deployment:

1. Visit `/`, `/issues`, `/report`, `/scanner`, and `/about`.
2. Confirm the Patch Brief shows official context and honest N=0 copy when appropriate.
3. Check the public scanner view, then authenticate and check the operator view.
4. Run the protected no-write source preview before a real scan.
   If paid model or provider routing changed, also run **Test AI provider route** from the authenticated Vercel-preview scanner. Confirm that one generation reached the expected provider; a green deterministic fallback is not sufficient proof.
5. If exercising intake, submit a controlled test report and moderate it deliberately.
6. On a public issue, submit one confirmation and verify that the result refreshes from server totals.
7. Confirm the hosting checks, migration list, and scheduled trigger are green before calling the release complete.

## When something is wrong

- Pause scheduled scans before investigating a provider or publishing problem.
- Preserve evidence and run history; do not delete rows to make a dashboard look healthy.
- Hide or reject questionable excerpts and leads while the cause is investigated.
- Do not raise a provider cap, add a provider, enable Reddit API, or change publishing thresholds as an emergency workaround.
- Rotate any exposed credential immediately and remove it from the public conversation or commit history through the normal security process.

## Release verification

```powershell
npm run lint
npm test
npm exec tsc -- --noEmit
npm run build
npm run test:e2e
npm run test:e2e:n0
git diff --check
```

Also inspect `git status --short`, the final diff, the relevant provider check, and the linked Supabase migration list. See [Security](../SECURITY.md) before sharing logs or screenshots.
