<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# AGENTS.md

Guidance for AI coding agents and the people who run them. Human contributors should read [CONTRIBUTING.md](CONTRIBUTING.md) first; the same rules apply.

## Work

- Read the relevant code, tests and docs before editing. Reuse existing utilities and patterns.
- Make the smallest complete change. Keep behavior and public contracts unless the task changes them.
- Fix root causes. Never silence diagnostics, swallow failures, bypass type safety or weaken tests to pass.
- Ask before adding dependencies, tables, settings, background jobs or paid provider calls.
- Follow [docs/STYLE.md](docs/STYLE.md) for every public word: page text, articles, labels, feeds, and anything a model writes for the site.

## Protect the system

- Never hardcode, print or commit secrets, tokens, private data or sensitive logs.
- Preserve authentication, authorization, privacy and abuse controls.
- Keep raw reports, rejected candidates, private source text, network hashes, individual check-ins and provider identities out of public output. Public pages show aggregates and reviewed rows only.
- Database failures must fail or be shown as unavailable, never treated as an empty success.
- Never deploy, publish, or change production data. Applying migrations to the hosted database is a maintainer release step.

## Database

- Add migrations as new files in `supabase/migrations/`. The GitHub `migrations` check applies every migration in order on a throwaway database and runs `supabase/tests/`. A local stack (`npm run db:start`, `npm run db:reset`) is optional.
- Never link the local stack to a hosted project, and never run `supabase db push`.

## Verify

- Add focused tests for behavior changes.
- GitHub runs the full gate on every pull request: `verify` (lint, unit tests, type check, build), `browser` (all browser suites) and `migrations` (migrations and database tests). Merge only when every required check passes on the final commit.
- Before pushing, run the checks that cover your change. `npm run verify` runs the full gate locally when you need it; only one local run at a time, because its browser tests use fixed ports.
