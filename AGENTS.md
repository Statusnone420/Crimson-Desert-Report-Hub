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

## Protect the system

- Never hardcode, print or commit secrets, tokens, private data or sensitive logs.
- Preserve authentication, authorization, privacy and abuse controls.
- Keep raw reports, rejected candidates, private source text, network hashes, individual check-ins and provider identities out of public output. Public pages show aggregates and reviewed rows only.
- Database failures must fail or be shown as unavailable, never treated as an empty success.
- Never deploy, publish, or change production data. Applying migrations to the hosted database is a maintainer release step.

## Database

- Add migrations as new files in `supabase/migrations/`. Test them on a local stack with `npm run db:start` and `npm run db:reset`.
- Never link the local stack to a hosted project, and never run `supabase db push`.

## Verify

- Add focused tests for behavior changes.
- Stage the intended changes, then run `npm run verify`. It is the full local and CI gate; a partial run does not replace it. A source change after verification needs a fresh full pass.
