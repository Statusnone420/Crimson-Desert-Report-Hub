# Codebase Concerns

**Analysis Date:** 2026-07-09

## Tech Debt

### Non-hardening-grade admin authentication
- Issue: Admin login validation uses deterministic SHA-256 hashing in `src/lib/session.ts` via `hashPassword` and `passwordMatches`, then stores a short-lived HMAC-authenticated token in `session-token` cookies in `src/app/api/admin/login/route.ts`.
- Files: `src/lib/session.ts`, `src/app/api/admin/login/route.ts`, `src/lib/adminGuard.ts`, `src/app/admin/actions.ts`, `src/app/admin/page.tsx`
- Impact: Password compromise and token predictability are easier to exploit than modern password hashing with per-user salt/iteration controls; recovery path depends on environment secrets.
- Fix approach: Replace password hash check with adaptive hashing (Argon2/bcrypt/PBKDF2 per Next.js-compatible libs), rotate to versioned token/session records, and centralize admin session revocation.

### Best-effort run orchestration and state management
- Issue: Automation run ownership and stale-run cleanup are implemented as best-effort checks/updates rather than atomic DB operations.
- Files: `src/lib/automation/run.ts`, `src/lib/automation/runDisplay.ts`, `src/lib/automation/memory.ts`, `src/lib/queries.ts`
- Impact: Run state transitions can become inconsistent when execution is interrupted, and retry logic can miss overlapping runs.
- Fix approach: Introduce atomic claim/lock semantics, transactional status transitions, and a background reconciler that normalizes stale states.

### Heuristic-only core logic branches
- Issue: Moderation/eligibility relies on regex-heavy and keyword heuristics across multiple files without a formal rule engine or test-backed versioning.
- Files: `src/lib/reddit.ts`, `src/lib/automation/eligibility.ts`, `src/lib/automation/domains.ts`, `src/lib/automation/relevance.ts`, `src/lib/officialPatch.ts`
- Impact: Small upstream content shifts can cause classification drift and inconsistent behavior.
- Fix approach: Move rules to structured config with explicit allowlist/denylist versions and add regression fixtures for each rule set.

## Known Bugs

### Weak run de-duplication under concurrent triggers
- Symptoms: Two scheduled invocations started close together can both pass active-run checks and duplicate downstream fetch/classification work.
- Files: `src/lib/automation/run.ts`, `src/lib/automation/route.ts`, `src/app/api/cron/source-preview/route.ts`
- Trigger: Near-simultaneous cron or manual start events.
- Workaround: Current best-effort in-memory and status-based guards reduce risk but do not eliminate it.
- Fix approach: Enforce distributed lock/row-level lock at DB level before run start.

### Manual cleanup dependence in failure scenarios
- Symptoms: Run records can remain partially complete with stale fields when external calls fail mid-pipeline.
- Files: `src/lib/automation/run.ts`, `src/lib/automation/extract.ts`, `src/lib/automation/search.ts`, `src/lib/automation/relevance.ts`
- Trigger: Network timeout/failure during report fetching + subsequent exception.
- Workaround: Best-effort cleanup/marking is already present in some branches.
- Fix approach: Replace partial writes with a single transactional status model (queued → fetching → scored → committed) and resumable checkpoints.

## Security Considerations

### Admin authentication attack surface
- Risk: Plain password-hash comparison pattern in `src/lib/session.ts` and `src/app/api/admin/login/route.ts` increases brute-force and credential reuse impact.
- Files: `src/lib/session.ts`, `src/app/api/admin/login/route.ts`, `src/lib/adminGuard.ts`
- Current mitigation: Fixed cookie expiration and constant-time compare for token check.
- Recommendation: Adopt strong password hashing, account lockout/rate limiting, optional MFA, and structured admin audit logging.

### Optional security controls weaken in non-production
- Risk: Turnstile and related checks are conditional and can be fully disabled when env vars are missing.
- Files: `src/lib/turnstile.ts`, `src/lib/env.ts`, `src/app/report/page.tsx`, `src/components/scanner/PublicScannerView.tsx`, `src/components/scanner/SourceRadar.tsx`
- Current mitigation: Feature flags default off for safety on missing config.
- Recommendation: Keep protection required in all non-local deployments and fail-closed when provider configuration is invalid.

### Source IP trust model is proxy-dependent
- Risk: API rate/reputation logic and moderation gates rely on `x-forwarded-for` in `src/app/api/reports/route.ts`, which can be spoofed without trusted proxy normalization.
- Files: `src/app/api/reports/route.ts`
- Current mitigation: No strict canonical parser appears in the request path.
- Recommendation: Parse headers only after trusted proxy validation and fall back to connection IP from trusted runtime metadata.

### Minimal hardening on cron endpoints
- Risk: Cron routes accept only bearer token checks and process sensitive side-effects if token is leaked.
- Files: `src/app/api/cron/keepalive/route.ts`, `src/app/api/cron/source-preview/route.ts`
- Current mitigation: Fixed shared secret via `CRON_SECRET`.
- Recommendation: Combine secret auth with strict request-sender allowlisting, replay-protected nonces, and signed timestamp checks.

### Header and CSP posture
- Risk: `next.config.ts` includes relaxed inline allowances (`unsafe-inline`) for scripts/styles to support functionality.
- Files: `next.config.ts`
- Impact: Increased XSS attack blast radius if any injection path exists.
- Recommendation: Tighten CSP progressively with nonce/hash strategy and stricter script isolation.

## Performance Bottlenecks

### Heavy unbounded scans
- Problem: Several automation and reporting paths perform wide scans and repeated pagination without strict global caps on all dimensions.
- Files: `src/lib/automation/run.ts`, `src/lib/queries.ts`, `src/app/report/page.tsx`, `src/app/issues/page.tsx`, `src/components/scanner/SourceRadar.tsx`
- Cause: Legacy guardrails and fallback logic allow broad dataset traversal.
- Improvement path: Add explicit upper bounds and pagination strategy at all scan boundaries, plus index-backed query patterns.

### External I/O fan-out per run
- Problem: One report can trigger multiple outbound calls (search + extraction + LLM moderation + Reddit validation + official patch fetch).
- Files: `src/lib/automation/search.ts`, `src/lib/automation/extract.ts`, `src/lib/automation/run.ts`, `src/lib/ai.ts`, `src/lib/reddit.server.ts`, `src/lib/reddit.ts`, `src/lib/officialPatch.server.ts`
- Cause: Pipeline lacks global latency budget and per-provider timeout consistency.
- Improvement path: Add per-step budgets, circuit breaking, request coalescing, and staged short-circuiting.

### Missing consistent network timeout controls
- Problem: Several outbound requests depend on default `fetch` timeouts.
- Files: `src/lib/automation/search.ts`, `src/lib/automation/extract.ts`, `src/lib/reddit.server.ts`, `src/lib/officialPatch.server.ts`, `src/lib/offline.ts`, `src/lib/ai.ts`
- Impact: Slow/locked dependencies can hold server workers longer than intended.
- Improvement path: Standardize timeout budgets and retry policy with jittered backoff.

## Fragile Areas

### Environment-driven branching
- Why fragile: Multiple critical behaviors are enabled/disabled by loose env checks.
- Files: `src/lib/env.ts`, `src/lib/turnstile.ts`, `src/lib/automation/schedule.ts`, `src/lib/automation/settings.ts`
- Why it breaks: Misconfiguration changes behavior rather than failing safely.
- Safe modification: Centralize feature policy and require explicit env profiles (`local`, `preview`, `prod`) before startup.

### Heuristic parsing of external content
- Why fragile: Parsing assumes specific post formats and known source signatures.
- Files: `src/lib/reddit.ts`, `src/lib/officialPatch.ts`, `src/lib/automation/extract.ts`, `src/lib/automation/relevance.ts`
- Why it breaks: Minor HTML/API format changes reduce extraction quality and can suppress valid signals.
- Safe modification: Add schema-based parsers and fallback telemetry for parse failures.

### Non-transactional status updates
- Why fragile: Run progression and signal persistence can be updated independently across DB calls.
- Files: `src/lib/automation/run.ts`, `src/lib/automation/memory.ts`, `src/lib/automation/relevance.ts`
- Why it breaks: Retry or crash mid-update leaves ambiguous state.
- Safe modification: Wrap related status writes in transaction boundaries.

### Operational gating behavior in preview mode
- Why fragile: Write paths in API/admin routes are blocked in preview via checks scattered in handlers.
- Files: `src/app/api/admin/scan/route.ts`, `src/app/api/admin/status/route.ts`, `src/app/admin/actions.ts`, `src/app/admin/compile/page.tsx`, `src/app/admin/page.tsx`
- Why it breaks: Unexpected divergence between preview and production behavior during rollout.
- Safe modification: Move preview checks into a single middleware layer with explicit allowlist policy.

## Scaling Limits

### Single-run capacity and throughput
- Current capacity: One long-running automation run can consume the entire end-to-end pipeline and delay concurrent jobs.
- Limit: High report volume and external rate limits amplify queue growth.
- Scaling path: Add queue-backed workers, concurrency controls, and separate moderation/extraction workers.

### Run history and aggregation growth
- Current capacity: Aggregation/report queries rely on full-collection reads and repeated scans.
- Limit: As signal history grows, UI/report pages and admin dashboards can slow down.
- Scaling path: Add materialized rollups, covering indexes, and bounded cache keys for dashboard and preview views.

## Dependencies at Risk

### Third-party moderation and discovery stack dependency
- Risk: Critical product behavior depends on external APIs and model providers.
- Files: `src/lib/ai.ts`, `src/lib/reddit.server.ts`, `src/lib/reddit.ts`, `src/lib/automation/search.ts`, `src/lib/officialPatch.server.ts`, `src/lib/automation/extract.ts`
- Impact: Provider outage or policy change reduces report throughput and quality quickly.
- Migration plan: Add provider abstraction + health checks + deterministic offline degradation paths with graceful feature flags.

### Turnstile availability dependency for abuse prevention
- Risk: Abuse protection for submissions depends on runtime Turnstile config and connectivity.
- Files: `src/lib/turnstile.ts`, `src/components/SubmitButton.tsx`, `src/app/report/page.tsx`
- Impact: False positives/false negatives in bot defense when tokens are unavailable.
- Mitigation: Keep staged fallback that preserves integrity signals (IP/token age/behavior) and emits explicit security metrics.

## Missing Critical Features

### Audit and operational observability
- Problem: Admin actions and scheduled run lifecycle changes are not documented as first-class audit trails in code.
- Files: `src/app/admin/actions.ts`, `src/lib/automation/run.ts`, `src/app/api/admin/login/route.ts`
- Why it blocks: Harder incident investigation and forensic attribution.
- Recommendation: Add append-only audit logs for every state transition and privileged action.

### Abuse controls for public report intake
- Problem: Intake safeguards are mostly client-side optional and token-based with limited anti-abuse depth.
- Files: `src/app/report/page.tsx`, `src/app/api/reports/route.ts`, `src/lib/turnstile.ts`, `src/lib/automation/schedule.ts`
- Why it blocks: Elevated abuse risk if token verification or heuristics degrade.
- Recommendation: Add deterministic server-side quotas, exponential backoff, and IP/user fingerprint scoring.

### Deterministic run observability
- Problem: No documented on-call playbook for failed/partial runs plus auto-heal policy.
- Files: `src/lib/automation/run.ts`, `src/app/api/admin/status/route.ts`, `src/lib/queries.ts`
- Why it blocks: Recovery is manual and operationally inconsistent.
- Recommendation: Add run health checks and SLA-defined reconciler states in admin APIs.

## Test Coverage Gaps

### External failure-path and concurrency tests are limited
- What is not fully covered: Deterministic tests for concurrent run starts, stale-lock recovery, and multi-provider timeout/cascade failure behavior.
- Files: `src/lib/automation/run.ts`, `src/lib/automation/search.ts`, `src/lib/automation/extract.ts`, `src/lib/ai.ts`, `tests/automationRun.test.ts`, `tests/automationRoute.test.ts`
- Risk: Race and timeout defects can pass unit test suites while failing under production load.
- Priority: High

### Security bypass edge cases
- What is not fully covered: Spoofed-forwarded headers and cron token misuse scenarios in production proxy chains.
- Files: `src/app/api/reports/route.ts`, `src/app/api/cron/keepalive/route.ts`, `src/app/api/cron/source-preview/route.ts`
- Risk: Security assumptions may break with infra changes.
- Priority: High

### Technical debt markers outside test scope
- Problem: `docs/LAUNCH_CHECKLIST.md` includes explicit remediation TODO for stronger authentication posture (`replace plain password hash check`).
- Impact: Known debt remains trackable but not enforced by tests.
- Recommendation: Convert this checklist debt into implementation tasks and failing checks.

---

*Concerns audit: 2026-07-09*
