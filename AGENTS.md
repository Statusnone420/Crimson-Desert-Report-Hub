<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# AGENTS.md

Universal rules. Obey host precedence; among recognized instruction files, the most specific applicable repository rule wins.

**Bias:** ask on consequential choices; act on routine, reversible details; deliver correct, complete, minimal, verified work.

## 1. Establish the Contract

- Turn the request into verifiable acceptance criteria.
- Before editing, read applicable instructions, relevant code/tests/docs/config, and working-tree status/diff when present.
- Existing changes are user-owned. Preserve and integrate with them; never revert or “clean them up.”
- Resolve uncertainty from repository evidence first.
- Ask when valid interpretations materially change intent, behavior, architecture, scope, data, security, cost, contracts, or irreversible actions. Give options and a recommendation.
- Otherwise choose the safest reversible path, state any material assumption, and proceed.
- Review, explanation, and diagnosis are read-only. Do not implement unless asked.

## 2. Plan the Proof

- Mechanical edits may skip a written plan—never context, scope control, or verification.
- For non-trivial work, use a short plan with a concrete check per step.
- Trace relevant callers, tests, types, and interfaces.
- Reproduce bugs first when safe and practical; prefer a failing regression test.
- Derive stack, versions, commands, conventions, and package manager from the repository.
- Reuse existing utilities and patterns before creating new ones.
- If the requested approach is unsafe or overcomplex, explain why and propose a safer option; never substitute silently.

## 3. Implement the Smallest Correct Change

- Make the smallest complete diff. Every edit must be necessary for the requested outcome; keep supporting changes localized.
- Preserve behavior and public contracts unless explicitly changed.
- Match local style and architecture; prefer readable, direct code over clever code.
- No speculative features, premature abstraction/configuration, unrelated refactors, masking fallbacks, or unjustified dependencies.
- Add a helper or boundary only when it simplifies changed code, enables focused testing/reuse, enforces safety, or matches a pattern.
- Do not touch unrelated code or format unaffected files. Use repository tooling for generated output.
- Remove only items your change directly makes unused; leave pre-existing cleanup alone.
- Fix root causes. Never silence diagnostics, swallow failures, bypass type safety, or hide defects.

## 4. Protect the System

- Validate untrusted input at boundaries; use safe command, query, path, and serialization APIs.
- Preserve authentication, authorization, privacy, isolation, and security controls. Never weaken them to pass.
- Never hardcode, print, commit, or expose secrets, tokens, private data, or sensitive logs.
- Handle realistic I/O, service, concurrency, and corrupted-state failures; omit guards only where enforced invariants make states unreachable.
- Get explicit authorization before destructive or irreversible operations. Keep migrations explicit, data-safe, and reversible where practical.
- Never deploy, publish, message, or modify production data without authorization; ask before adding dependencies or running migrations.

## 5. Verify with Evidence

- Add focused tests for behavior changes when the repository supports them; otherwise report the coverage gap.
- Run narrow checks first, then repository-prescribed format, lint, typecheck, tests, and build; report anything skipped and why.
- Never delete, skip, or weaken valid tests to pass. Change expectations only for intended behavior.
- Diagnose failures before editing or retrying; never rerun unchanged commands blindly.
- Separate failures caused by your change from verified pre-existing failures.
- Claim a check passed only after running it fresh and seeing it pass.

## 6. Deliver Cleanly

- Review the final diff for scope, correctness, churn, debug code, generated files, secrets, and unintended behavior.
- Do not use destructive git commands. Do not commit, amend, rebase, push, or force-update unless asked.
- Report changes, affected files, checks/results, skipped checks/reasons, and remaining risks.
- If blocked, stop safely; report the blocker, evidence, and smallest next action.

## Code Review Rules

### Evidence and provider boundaries

Search changed public queries, serializers, and provider persistence paths:

- Keep raw reports, rejected candidates, private source URLs/text, network hashes, individual taps, credentials, and Twitch/Steam identities out of public output. Public shapes may contain approved excerpts, explicitly public leads, public IGDB metadata, and aggregate Steam/Twitch context; provider context is never player evidence.

### Scanner learning and visibility

Search scanner feedback, promotion, and admin visibility changes:

- Learning rules may change discovery or relevance only. They must not publish a lead, bypass corroboration, or alter evidence counts. Visibility remains a separate, reason-bearing admin override with an undo path.

### Rolling deploys and hosted data

Search callers of new Supabase tables, columns, and RPCs:

- Preserve the pre-migration path until the hosted migration is applied. Fall back only for a narrowly identified missing schema object; permission and other database failures must fail or be explicitly surfaced, never treated as empty success. A PR may add migration SQL, but must not apply it or write hosted data, and preview/dry-run paths must stay no-write.

---

**Done means:** requested outcome achieved; acceptance criteria met; diff scoped; required checks passed; no user work disturbed.
