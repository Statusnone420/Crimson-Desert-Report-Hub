# Launch Checklist

This is the plain-English checklist for getting Crimson Desert Report Hub live without leaking secrets.

Do not commit real keys, dashboard screenshots with visible keys, `.env.local`, or local machine paths. Put real values only in provider dashboards such as Vercel, Supabase, Cloudflare, Tavily, and OpenRouter.

**Production database authorization:** this is a human launch runbook, not standing permission for an agent to mutate Supabase. Creating or reviewing migration files is always allowed; applying them, running direct SQL, or using `supabase db push` is forbidden unless the owner explicitly authorizes that production database change in the current message. After an authorized apply, record the migration name and verification result in the handoff.

## What The Repo Already Provides

- Next.js public site and admin pages.
- Supabase migrations in `supabase/migrations`.
- Cloudflare Worker Cron configuration in `cloudflare/scanner-cron/` for waking the protected keepalive route.
- Official Pearl Abyss patch-note metadata sync.
- Capped source radar with deterministic preview and pause/resume controls.
- Anonymous report intake with optional local save/config helper.
- Anonymous one-tap confirmations with patch-family stance changes and atomic rate limiting.
- Unit tests, build checks, and Playwright visual regression coverage.
- Public privacy, security, and contributing docs.

## Required Human Setup

### 1. Supabase

Create one Supabase project for production.

After explicit production authorization, run every SQL file in `supabase/migrations` in timestamp order, oldest first:

1. `20260705192906_schema.sql`
2. `20260705192920_seed_clusters.sql`
3. `20260705192942_automation_signals.sql`
4. `20260705192950_service_role_data_api_grants.sql`
5. `20260705193031_approved_excerpts_report_index.sql`
6. `20260705194620_lock_public_tables_to_server_role.sql`
7. `20260705201242_automation_settings.sql`
8. `20260705230801_official_patch_notes.sql`
9. `20260706000000_clarify_seed_watchlist.sql`
10. `20260706100000_automation_run_funnel.sql`
11. `20260706110000_automation_rejected_candidates.sql`
12. `20260706120000_patch_claimed_fixes.sql`
13. `20260706175304_automation_run_progress.sql`
14. `20260706210720_scanner_memory_quarantine.sql`
15. `20260706214048_rejected_candidate_source_published_at.sql`
16. `20260709171437_issue_cluster_lifecycle.sql`
17. `20260709210222_issue_confirmations.sql`
18. `20260709210229_visibility_override_guards.sql`
19. `20260709212531_visibility_write_lock_order.sql`
20. `20260709234750_visibility_override_baseline.sql`
21. `20260710001212_visibility_refresh_revision.sql`

The confirmation migration adds exact claimed-patch provenance, `issue_confirmations`, the private hashed-attempt ledger, and the `record_issue_confirmation` RPC. That RPC atomically rechecks public issue visibility, enforces the 20-writes-per-network/hour limit, and returns `recorded`, `rate_limited`, or `unknown_issue`. The visibility-guard migration makes force-public/force-hidden cluster state durable and adds the service-role override RPC. The lock-order follow-up serializes confirmation and cluster/source visibility writes before row locks, closing the concurrent scan/admin deadlock path. The visibility-baseline follow-up preserves engine-owned state across forced overrides. The visibility-revision follow-up keeps that automatic baseline current, makes approved-report promotion transactional, and applies each cluster/source refresh atomically only when its input revision is still current. Do not deploy code that queries those objects before the authorized migrations are verified.

Recovery status (2026-07-09): all five recovery migrations above were explicitly authorized, applied successfully to the remote Supabase project, and aligned locally to the assigned versions shown in this list. This recorded success does not authorize any future migration or direct SQL operation.

Copy these values into Vercel environment variables:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

The service role key is private server-only access. Never expose it in browser code, GitHub issues, screenshots, docs, or public drives.

Optional Supabase GitHub integration settings:

- Repository: this GitHub repo.
- Working directory: `.`
- Production branch: `main`
- Deploy to production: on.

Do not enable paid branching unless you intentionally upgrade Supabase.

### 2. Vercel

Import the GitHub repo into Vercel and deploy from `main`.

Required Vercel environment variables:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ADMIN_PASSWORD`
- `SESSION_SECRET`
- `CRON_SECRET`

Generate `SESSION_SECRET` and `CRON_SECRET` as long random strings. A 64-character hex string is fine.

Security follow-up TODO:

- Replace the raw `ADMIN_PASSWORD` comparison with a slow password verifier such as Node `crypto.scrypt`, store the verifier in Vercel as something like `ADMIN_PASSWORD_SCRYPT`, and rotate the current admin password. This addresses GitHub CodeQL `js/insufficient-password-hash` alerts #3 and #4.

The public site URL should be:

```text
https://crimsonreporthub.com
```

Keep the Vercel-provided `vercel.app` URL as a fallback/internal deployment URL, but use the custom domain for public links.

Cloudflare DNS records for the custom domain:

| Type | Name | Target | Proxy |
| --- | --- | --- | --- |
| `CNAME` | `@` | `b6d6a250ac14c9bf.vercel-dns-017.com` | DNS only |
| `CNAME` | `www` | `b6d6a250ac14c9bf.vercel-dns-017.com` | DNS only |

If Cloudflare offers Vercel Domain Connect, you can use that instead of adding the records by hand. After DNS is saved, run:

```bash
vercel domains verify crimsonreporthub.com --scope statusnones-projects
vercel domains verify www.crimsonreporthub.com --scope statusnones-projects
```

### 3. Tavily

The official Pearl Abyss patch-note source needs no setup. It is public web metadata and is synced during real scanner runs.

Tavily is the web-search provider. It keeps the source radar alive at N=0 and discovers public issue pages that can be mapped into questions. Scanner links remain leads, never player evidence.

Set in Vercel:

- `TAVILY_API_KEY`

Stay inside Tavily's free allocation. The real-scan ledger is hard-capped at 1,000 credits/month, and the scheduled posture is approximately one base search credit per run. A scan may spend at most two additional credits on basic extraction for promising thin pages. Reddit context reads normalize the public URL to `old.reddit.com`; this remains Tavily web discovery and does not use Reddit API. Protected previews are bounded and deterministic but do not write the scan ledger, so include their credits when manually confirming the Tavily account remains below 1,000. Do not buy a paid upgrade.

### 4. OpenRouter

OpenRouter turns public source snippets into structured issue data.

Set in Vercel:

- `OPENROUTER_API_KEY`
- `OPENROUTER_AUTOMATION_MODEL=deepseek/deepseek-v4-flash`
- `OPENROUTER_FREE_MODEL=openrouter/free`
- `AUTOMATION_BUDGET_USD_MONTHLY=2`

High-value scanner extraction and official fix-claim mapping accept only `deepseek/deepseek-v4-flash`. Software caps that lane at $2 per UTC month and sends per-request price ceilings of $0.10 per million prompt tokens and $0.20 per million completion tokens. Routine report moderation and dossier prose use `openrouter/free`, an explicit `:free` model, or deterministic fallback.

Create a dedicated OpenRouter key for this deployment. In the OpenRouter dashboard, give that key a monthly limit of $2 or lower with monthly reset, then verify the setting manually before enabling automation and after any rotation. Record the verification in the release handoff. The repository cannot inspect the provider dashboard, so this checklist does not claim the limit is already configured.

### 5. Reddit Policy

Reddit API is permanently off. Do not create or configure Reddit API credentials, direct subreddit monitoring, or Devvit. The only supported Reddit path is Tavily public-web discovery: `site:reddit.com` results may receive bounded basic extraction after normalization to `old.reddit.com`.

### 6. Cloudflare Turnstile

Turnstile is a free bot/spam check for the public report form. It is like CAPTCHA, but usually invisible to normal users.

The site works without Turnstile. Without it, the app still has server validation and IP-hash rate limiting, but public report spam is easier.

To add Turnstile:

1. Open Cloudflare Dashboard.
2. Go to `Application security` -> `Turnstile`.
3. Create a widget for the production hostname.
4. Add `crimsonreporthub.com` as an allowed hostname.
5. Add the Vercel `vercel.app` deployment hostname too if you want Turnstile to work on preview/fallback URLs.
6. Copy the public site key into Vercel as `NEXT_PUBLIC_TURNSTILE_SITE_KEY`.
7. Copy the private secret key into Vercel as `TURNSTILE_SECRET_KEY`.
8. Redeploy Vercel.

The app already validates Turnstile tokens server-side when `TURNSTILE_SECRET_KEY` exists.

Turnstile protects full report submissions only. One-tap confirmations accept enum-only input and use same-origin checks, a salted network hash, one-voice upserts, an atomic 20-writes-per-network/hour ledger, and distinct-network display thresholds. Do not add a confirmation captcha unless observed abuse justifies the documented escalation follow-up.

## First Production Run

Use this order so bad sources do not publish automatically.

1. Visit `/`, `/issues`, `/report`, `/about`, and the public `/scanner` source radar.
2. Open the footer `Admin` control or `/admin/login`.
3. Enter `ADMIN_PASSWORD`.
4. Open `/scanner`; the same route should now render the authenticated operator view.
5. Click `Test scan without publishing`.
6. Run the protected no-write, deterministic-extraction preview:

```bash
curl -H "Authorization: Bearer <CRON_SECRET>" \
  "https://crimsonreporthub.com/api/cron/source-preview?queries=1"
```

7. Confirm the preview is finding real issue reports, not patch notes, reviews, guides, or unrelated videos.
8. Confirm mapped scanner items are framed as lead questions, never evidence.
9. Only then click `Run capped scan now`.
10. Refresh the public dashboard.
11. On a public issue, submit a confirmation and verify that the selected stance is acknowledged while totals remain server-authored and refresh from the server.

## Ongoing Controls

- Use the authenticated `/scanner` view to pause/resume scans, run previews, inspect radar leads, and rescue items from the expiring rejected archive.
- Keep `AUTOMATION_BUDGET_USD_MONTHLY=2`, Tavily at or below 1,000 monthly credits, automation pinned to `deepseek/deepseek-v4-flash`, and routine AI on `openrouter/free`/`:free` or deterministic fallback. Confirm the dedicated OpenRouter key still has a provider-side monthly reset limit of $2 or lower; this is a manual dashboard check.
- Use `/admin` to approve/reject direct player reports.
- Use `/admin` exceptions to lock/clear lifecycle state only when needed.
- Use `Force public` or `Force hidden` for an immediate atomic visibility change; the service-role RPC and database guards preserve that choice across concurrent scanner writes. `Auto` clears the override and immediately re-runs the shared promotion engine for that cluster and its source rows. Public pages revalidate after the action.
- Use `/admin/compile` to generate a Pearl Abyss-ready dossier.

## Confirmation Board Checks

- Reports are evidence, confirmation taps are player signals, and scanner links are leads.
- One network has one current stance per issue per patch family. A later tap replaces that stance and may change platform/exact patch without adding a second voter.
- A confidently mapped official fix stores the exact claimed patch version and starts its clock. A claim from `1.13.00` must never render as a claim from `1.13.01`.
- Only `Still happening` and `Fixed for me` taps at or after the clock answer the poll while that exact patch is current.
- Only structured reports filed for that exact patch and submitted after the clock count as post-claim report evidence. Scanner links always remain leads.
- Confirm that hidden or missing issues return `unknown_issue` from the transactional confirmation RPC without consuming a rate-ledger write.
- The private confirmation-attempt ledger contains only salted hashes and timestamps. The RPC serializes concurrent writes and rejects the next otherwise-valid write after 20 accepted writes for a hash in a trailing hour.
- The browser may remember the selected stance after success, but it never fabricates an optimistic total. Public counts come from server aggregates.

## Local Save/Config Helper

The report page can inspect selected Crimson Desert save/config files in the browser.

It can extract settings such as DLSS/upscale mode, Frame Generation, VSync, and HDR from `user_engine_option_save.xml`.

Privacy boundaries:

- Raw files are not uploaded by the helper.
- The browser submits only visible sanitized text fields.
- Local folder/account-looking path segments are stripped before text is inserted.
- Players can delete or edit the generated text before submitting.

## Final Verification Commands

Run these before cutting a release or merging a PR:

```bash
npm run lint
npm test
npm exec tsc -- --noEmit
npm run build
npm run test:e2e
```

Run a secret scan before pushing:

```bash
rg -n "(sb_secret_|sk-or-|tvly-|SUPABASE_SERVICE_ROLE_KEY|OPENROUTER_API_KEY|TAVILY_API_KEY)" .
```

Only placeholder names should appear in docs or examples. Real secret values must not appear.
