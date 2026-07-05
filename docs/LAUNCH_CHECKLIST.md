# Launch Checklist

This is the plain-English checklist for getting Crimson Desert Report Hub live without leaking secrets.

Do not commit real keys, dashboard screenshots with visible keys, `.env.local`, or local machine paths. Put real values only in provider dashboards such as Vercel, Supabase, Cloudflare, Tavily, OpenRouter, and Reddit.

## What The Repo Already Provides

- Next.js public site and admin pages.
- Supabase migrations in `supabase/migrations`.
- Vercel cron configuration in `vercel.json`.
- Official Pearl Abyss patch-note metadata sync.
- Budget-capped automation with source preview and pause/resume controls.
- Anonymous report intake with optional local save/config helper.
- Unit tests, build checks, and Playwright visual regression coverage.
- Public privacy, security, and contributing docs.

## Required Human Setup

### 1. Supabase

Create one Supabase project for production.

Run every SQL file in `supabase/migrations` in timestamp order, oldest first:

1. `20260705192906_schema.sql`
2. `20260705192920_seed_clusters.sql`
3. `20260705192942_automation_signals.sql`
4. `20260705192950_service_role_data_api_grants.sql`
5. `20260705193031_approved_excerpts_report_index.sql`
6. `20260705194620_lock_public_tables_to_server_role.sql`
7. `20260705201242_automation_settings.sql`
8. `20260705230801_official_patch_notes.sql`

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

Tavily is the web-search provider. It lets the scanner find public issue reports without waiting for users to submit reports.

Set in Vercel:

- `TAVILY_API_KEY`

The app caps searches per run and has a monthly budget knob. Start conservative.

### 4. OpenRouter

OpenRouter turns public source snippets into structured issue data.

Set in Vercel:

- `OPENROUTER_API_KEY`
- `OPENROUTER_FREE_MODEL=openrouter/free`
- `AUTOMATION_BUDGET_USD_MONTHLY=5`

`openrouter/free` keeps routing on free models where possible. The app also refuses non-free OpenRouter model names unless the configured model is explicitly marked free.

### 5. Reddit

Reddit is optional. The site can launch without Reddit API credentials because Tavily can still discover public Reddit web pages.

If you want direct Reddit monitoring, set:

- `REDDIT_CLIENT_ID`
- `REDDIT_CLIENT_SECRET`
- `REDDIT_USER_AGENT`

Use a user agent like:

```text
web:crimson-desert-report-hub:v1.0 (by /u/YOUR_REDDIT_USERNAME)
```

Important: do not run `npm create devvit`, `npm run dev`, or Reddit-hosted app commands for this website. Devvit is Reddit's own app platform; this project is an external Next.js website.

If Reddit approval is pending, leave the Reddit env vars empty and launch with Tavily first.

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

## First Production Run

Use this order so bad sources do not publish automatically.

1. Visit `/`, `/issues`, `/report`, and `/about`.
2. Open the footer `Owner` control or `/admin/login`.
3. Enter `ADMIN_PASSWORD`.
4. Open `/admin/source-monitor`.
5. Click `Test scan without publishing`.
6. Run the protected no-write preview:

```bash
curl -H "Authorization: Bearer <CRON_SECRET>" \
  "https://crimsonreporthub.com/api/cron/source-preview?queries=1"
```

7. Confirm the preview is finding real issue reports, not patch notes, reviews, guides, or unrelated videos.
8. Only then click `Run capped scan now`.
9. Refresh the public dashboard.

## Ongoing Controls

- Use `/admin/source-monitor` to pause or resume scheduled scans.
- Use `AUTOMATION_BUDGET_USD_MONTHLY` as the one-number cost knob.
- Set `AUTOMATION_BUDGET_USD_MONTHLY=0` to stop paid search and paid extraction work.
- Use `/admin` to approve/reject direct player reports.
- Use `/admin/compile` to generate a Pearl Abyss-ready dossier.

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
