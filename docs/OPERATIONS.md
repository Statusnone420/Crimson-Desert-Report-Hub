# Operations Guide

This guide is for deploying and running Crimson Desert Report Hub without committing secrets.

## Environments

Keep real values in hosting/provider dashboards only:

- Local machine: `.env.local` for development only.
- Vercel: Project Settings -> Environment Variables.
- Supabase: Project dashboard and database migrations.
- GitHub: repository source code only; no API keys, passwords, or `.env` files.

## Required Services

### Supabase

Supabase stores reports, issue clusters, confirmation stances, the event-pruned confirmation-attempt ledger, automation runs, scanner leads, official patch metadata, and scanner settings.

Required Vercel env vars:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Important: the service role key must never be exposed in browser code or committed to GitHub.

Migration files live in `supabase/migrations` and must be applied in timestamp order. See [LAUNCH_CHECKLIST.md](LAUNCH_CHECKLIST.md) for the complete ordered inventory.

**Authorization boundary:** creating or reviewing a migration file is not permission to apply it. Agents and automation must never run direct SQL, `supabase db push`, or any remote migration tool unless the owner explicitly authorizes that production database change in the current message. Record the applied migration and verification result in the handoff after an authorized apply.

Apply required additive migrations before deploying app code that selects their new columns. In particular, the lifecycle columns precede `20260709210222_issue_confirmations.sql`, which adds confirmations, exact claimed-patch provenance, the atomic rate-limit ledger, and its service-role RPC. `20260709210229_visibility_override_guards.sql` adds the visibility override RPC and durability triggers; `20260709212531_visibility_write_lock_order.sql` makes one global transaction advisory lock the first lock for confirmation and cluster/source visibility writes; `20260709234750_visibility_override_baseline.sql` preserves the engine-owned public/private baseline across forced overrides; `20260710001212_visibility_refresh_revision.sql` keeps automatic ownership current, promotes approved reports transactionally, and revision-checks atomic cluster/source refreshes; `20260710005327_visibility_restore_recompute.sql` corrects legacy forced-value restore baselines from engine-owned evidence. All six recovery migrations were explicitly authorized, applied, and verified on 2026-07-09; future database changes still require fresh authorization.

The `official_patch_notes` table stores only compact Pearl Abyss patch metadata: board number, title, patch version, official URL, publish time, and a short summary. It does not store the full patch article.

### Vercel

Vercel hosts the Next.js app and scheduled cron route.

Required Vercel env vars:

- `ADMIN_PASSWORD`
- `SESSION_SECRET`
- `CRON_SECRET`
- all Supabase required vars

The scheduled scan runs through `/api/cron/keepalive`. That route requires `Authorization: Bearer <CRON_SECRET>`.

Public dashboard data is cached server-side for five minutes and revalidated after report, moderation, scanner, and patch-metadata writes. This keeps weak mobile connections from waiting on every Supabase read.

The public pages `/`, `/issues`, and `/report` are built as five-minute ISR pages. If Supabase service credentials are missing during a public build, those pages render a safe empty shell with fallback patch metadata instead of failing the build. Protected admin pages and API routes still require the real environment variables and fail closed.

Custom domain:

```text
https://crimsonreporthub.com
```

Cloudflare should point both `crimsonreporthub.com` and `www.crimsonreporthub.com` to Vercel with DNS-only records. The current Vercel Domain Connect recommendation for this project is:

```text
CNAME  @    b6d6a250ac14c9bf.vercel-dns-017.com
CNAME  www  b6d6a250ac14c9bf.vercel-dns-017.com
```

The app permanently redirects `www.crimsonreporthub.com` and the old Vercel production hostname to `https://crimsonreporthub.com`.

### Turnstile

Cloudflare Turnstile protects the public report form from spam. The site still runs without it, but public submission is safer with it configured.

Vercel env vars:

- `NEXT_PUBLIC_TURNSTILE_SITE_KEY`
- `TURNSTILE_SECRET_KEY`

Add every production hostname to the Turnstile widget's allowed hostnames.

Production hostname:

```text
crimsonreporthub.com
```

## Capped Automation Providers

### Official Pearl Abyss Patch Notes

No API key is required. Real scanner runs fetch the public Pearl Abyss announcements page, store the current patch metadata in Supabase, and use that version when planning source searches. The dashboard links directly to the official patch note.

No-write source previews may fetch Tavily, but they use deterministic extraction and never call OpenRouter. They intentionally do not update the persisted patch row, public dashboard counters, or automation run ledger. Each preview is capped at two search queries, but those queries still consume the Tavily account allocation; include them when checking provider-side monthly usage.

### Tavily

Tavily provides general web search results for Crimson Desert issue queries.

Vercel env var:

- `TAVILY_API_KEY`

Real scans use small capped searches and cannot exceed the built-in 1,000-credit monthly scan ledger. Scheduled posture is approximately one base search credit per run. A scan may spend at most two additional Tavily credits on basic extraction for promising trusted pages whose search snippets are too thin; Reddit URLs are normalized to `old.reddit.com` before that bounded context read. Every real-scan search and extraction credit counts against the same ledger. Protected previews are deterministic and bounded per request but are not written to that ledger, so maintainers must include their credits when confirming the Tavily account remains within 1,000 total monthly credits. Do not buy a Tavily upgrade. If the funnel proves search starvation, document it and seek a new owner decision; the current ceiling remains 1,000.

Public Reddit pages may appear through Tavily `site:reddit.com` queries. Bounded follow-up context reads use Tavily basic extraction against `old.reddit.com`; this is still public-web discovery, not Reddit API access.

### OpenRouter

OpenRouter extracts structured issue data from source snippets.

Vercel env vars:

- `OPENROUTER_API_KEY`
- `OPENROUTER_AUTOMATION_MODEL=deepseek/deepseek-v4-flash`
- `OPENROUTER_FREE_MODEL=openrouter/free`

The provider contract has two lanes:

- High-value scanner extraction and official fix-claim mapping accept only `deepseek/deepseek-v4-flash`. The software caps this lane at $2 per UTC month. Each request is bounded by provider-routing ceilings of $0.10 per million prompt tokens and $0.20 per million completion tokens, and the software reserves the request's worst-case cost from the remaining monthly allowance before sending it.
- Routine report moderation and dossier prose use `openrouter/free` or another explicit `:free` model. Their provider routing has zero-price ceilings and falls back safely when the free route is unavailable.

High-value automation responses must report their usage cost. A verified cost within both ceilings is recorded against the current UTC month. Missing cost data stops later LLM calls in that run and charges the request's worst-case ceiling against the monthly allowance, so a transient transport blip cannot mute the LLM lane; three or more cost-unverified runs inside 24 hours open the automation circuit until those failures age out of the window. A cost above the request or month ceiling (or any unexpected charge) opens the circuit for the rest of the UTC month. Tavily and deterministic extraction always continue. If monthly run history cannot be read, the automation run fails closed before provider work. The no-write source-preview route is always deterministic-only, so it cannot bypass the circuit. The provider-side monthly key limit in the OpenRouter dashboard remains the hard backstop this policy assumes.

Use a dedicated OpenRouter key for this deployment and configure that key in the OpenRouter dashboard with a monthly limit of $2 or lower that resets monthly. Verify the provider-side limit manually before enabling automation and after key rotation. This repository cannot inspect the OpenRouter dashboard, so the limit is a required setup check, not a setting the code can claim is already verified.

### Reddit Policy

Reddit API is permanently off. Do not create or configure Reddit API credentials, Devvit, or direct subreddit monitoring. Reddit pages enter the radar only when Tavily finds their public web URLs.

## Cost Controls

The high-value automation default is:

```env
AUTOMATION_BUDGET_USD_MONTHLY=2
```

This is a tightly bounded spend posture: Tavily remains inside its free 1,000-credit allocation; only the approved DeepSeek V4 Flash automation lane may spend money, up to $2 per UTC month; routine AI stays free or deterministic; and confirmation taps add no provider cost. Persisted policy caps and per-request ceilings are hard software controls, not authorization to raise limits or switch models. Any provider/model/cap change requires a separate owner decision and documentation update.

## Scanner Controls

Role-aware page:

```text
/scanner
```

Anonymous visitors see source health, funnel transparency, and mapped lead questions. An authenticated admin sees these controls:

- `Test scan without publishing`: writes only the run ledger.
- `Run capped scan now`: runs the real scanner within the monthly budget.
- `Pause scheduled scans`: stops cron-triggered scanning.
- `Resume scheduled scans`: allows cron-triggered scanning again.

Manual runs are intentionally still available while scheduled scans are paused.

The scanner has a conservative relevance gate before anything is retained as a lead. It rejects broad patch notes, reviews, benchmarks, and `other` category extractions unless there is explicit issue language such as FPS drops, stutter, crash, freeze, input lockups, launch failures, or visual artifacts. Public scanner cards phrase mapped leads as questions. A scanner link remains a lead even when visible; only a structured report is evidence, and a confirmation tap is a player signal.

## Confirmation Board Controls

- One network has one current stance per issue per patch family.
- Re-tapping changes the stored stance, platform, exact patch, and timestamp instead of adding another voter.
- The `record_issue_confirmation` database function serializes concurrent writes per network hash and atomically enforces 20 accepted writes per trailing hour.
- Confirmation and cluster/source visibility writes also share one first transaction lock. This intentionally serializes that low-volume write boundary so a scanner write, visibility override, and confirmation public check cannot deadlock or cross in an ambiguous order.
- The private attempt ledger stores only a salted network hash and timestamp; raw IP addresses are not stored.
- Ledger rows older than one hour are pruned when a later valid confirmation runs; this is event-driven cleanup, not a guaranteed one-hour database TTL.
- A confidently mapped official fix stores the exact claimed patch version and starts its clock. The poll exists only while that exact patch is current; `1.13.00` cannot be attributed to `1.13.01`.
- Only post-clock `Still happening` / `Fixed for me` taps answer the poll. Only structured reports explicitly filed for that exact patch and submitted after the clock count as post-claim report evidence. Scanner links always remain leads.
- The confirmation RPC checks that the issue is still public inside the same transaction and returns `recorded`, `rate_limited`, or `unknown_issue`.
- Raw totals are server-authored. After a successful tap, the browser may remember the selected stance, but it does not invent an optimistic count; totals refresh from the server.
- Raw counts are honest at one response; stronger labels and filled meters require at least two distinct network hashes in the driving tally.

## Admin Access

Admin is currently a single shared password, not named user accounts.

1. Use the small `Admin` control in the footer, or open `/admin/login`.
2. Enter the `ADMIN_PASSWORD` value from Vercel.
3. Use `Review reports` for report moderation.
4. Open `/scanner` for scanner runs, pause/resume, recent radar leads, and the rejected archive.
5. Use the admin exceptions section to lock/clear lifecycle state when the system needs help.
6. Use `Force public` or `Force hidden` when a cluster must change immediately. A service-role RPC applies the forced cluster state atomically, hides associated lead rows when required, and database triggers keep concurrent scanner writes from undoing it. `Auto` clears the override and immediately re-runs the shared promotion engine for that cluster and its source rows. Public pages are revalidated after the action.
7. Use `Compile dossier` to generate the evidence dossier.

To add another human admin today, give them the admin password through a private channel and rotate `ADMIN_PASSWORD` if access should be revoked. Named admin accounts can be added later with a real auth provider, but they are intentionally not part of this low-friction launch build.

## Safe Live Preview

Use the source preview route to inspect one live search/extraction without database writes:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  "https://YOUR_DOMAIN/api/cron/source-preview?queries=1"
```

This route is protected by `CRON_SECRET`, capped to at most two search queries, and does not write to Supabase.
Because it is no-write, it does not update the public dashboard's last persisted scan, scanner leads, or automation run ledger.

## Production Smoke Test

After deploy:

1. Visit `/`, `/issues`, `/report`, and `/about`.
2. Log in at `/admin/login`.
3. Open `/scanner`; the authenticated view should show admin controls.
4. Run `Test scan without publishing`.
5. Run the protected source preview route with `queries=1`.
6. Only run `Run capped scan now` after the preview output looks relevant.

## Secret Hygiene

Before pushing:

```bash
git status --short
git diff --cached
```

Also search for accidental secrets:

```bash
rg -n "sb_secret|sk-or-|tvly-|SUPABASE_SERVICE_ROLE_KEY|OPENROUTER_API_KEY|TAVILY_API_KEY" .
```

Expected result: only placeholder names in documentation and `.env.local.example`, never real key values.
