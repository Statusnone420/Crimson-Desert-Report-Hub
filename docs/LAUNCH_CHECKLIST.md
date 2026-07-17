# Launch Checklist

This checklist gets a new or refreshed deployment online without turning provider access into source-control material. It is a human runbook; it is not standing permission for an agent to mutate a hosted database or deploy a provider change.

## Before changing anything

- [ ] Confirm the intended branch, target environment, and owner for the release.
- [ ] Read the current [README](../README.md), [Architecture](ARCHITECTURE.md), and [Operations Guide](OPERATIONS.md).
- [ ] Confirm the worktree and diff contain no .env files, keys, credentials, private dashboard links, or raw submissions.
- [ ] Confirm the public product contract still separates reports, player signals, radar leads, and official context.

## 1. Supabase

- [ ] Create or identify the intended Supabase project.
- [ ] From the repository, authenticate and link the CLI:

  ~~~powershell
  npx --yes supabase login
  npx --yes supabase link --project-ref <project-ref>
  npx --yes supabase migration list
  ~~~

- [ ] Review the ordered files under [supabase/migrations](../supabase/migrations).
- [ ] Compare the local migration list with the target project before deploying code that reads new tables or columns.
- [ ] Obtain explicit owner authorization in the release conversation before applying migrations.
- [ ] Apply through the linked Supabase migration workflow, not an ad-hoc SQL editor query.
- [ ] Run npx --yes supabase migration list again and record the result.
- [ ] If history is already applied but versions drift, use the supported supabase migration repair workflow. Do not add empty duplicate files or edit the migration-history table directly.
- [ ] Verify the required tables, constraints, and server-only grants with a read-only check.

## 2. Vercel

- [ ] Connect the GitHub repository and deploy the intended production branch.
- [ ] Configure these production variables in Vercel:

  ~~~text
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
  ADMIN_PASSWORD
  SESSION_SECRET
  CRON_SECRET
  ~~~

- [ ] Add the optional Turnstile, Tavily, and OpenRouter variables only when the corresponding provider is intentionally enabled.
- [ ] Confirm the custom domain crimsonreporthub.com and redirect behavior in the Vercel dashboard.
- [ ] Do not copy provider secrets into GitHub, issue comments, screenshots, or local handoffs.

## 3. Cloudflare scheduler

- [ ] Confirm the DNS and optional Turnstile configuration in Cloudflare.
- [ ] Store the same protected CRON_SECRET in the Worker:

  ~~~powershell
  npx wrangler secret put CRON_SECRET --config cloudflare/scanner-cron/wrangler.jsonc
  npx wrangler deploy --config cloudflare/scanner-cron/wrangler.jsonc
  ~~~

- [ ] Confirm the Worker is scheduled-only and forwards to the production keepalive route.
- [ ] Confirm a missing or invalid secret fails closed.

## 4. Provider safety

- [ ] Keep Tavily within the documented 1,000-credit monthly ceiling.
- [ ] Keep high-value provider usage software-capped at $2 per UTC month and verify the provider-side limit manually.
- [ ] Configure a dedicated OpenRouter key with a provider-side monthly limit of $2 or lower and verify that setting manually.
- [ ] Keep routine AI work on a free route or deterministic fallback.
- [ ] Confirm Reddit API credentials and direct subreddit monitoring are absent.

## 5. First production smoke test

- [ ] Open /, /issues, /report, /scanner, and /about.
- [ ] Confirm the current official patch link and N=0 states are honest.
- [ ] Open /scanner anonymously, then authenticate and verify the operator view.
- [ ] Run the protected no-write preview before a real scan:

  ~~~bash
  curl -H "Authorization: Bearer <CRON_SECRET>" \
    "https://crimsonreporthub.com/api/cron/source-preview?queries=1"
  ~~~

- [ ] Review the preview for relevance without publishing it.
- [ ] Run a capped scan only after the preview and provider checks are acceptable.
- [ ] If exercising report intake, use test data and moderate it intentionally.
- [ ] Confirm a player confirmation refreshes from server totals.

## 6. Merge and release gate

- [ ] Narrow tests pass.
- [ ] Lint, typecheck, unit tests, build, E2E, and N=0 E2E pass.
- [ ] Visual checks are reviewed when UI changes.
- [ ] git diff --check is clean.
- [ ] The target Supabase migration list matches the repository.
- [ ] Vercel, scheduler, and database checks are green.
- [ ] The release handoff records the exact commit, provider checks, migration verification, and any remaining owner action.
