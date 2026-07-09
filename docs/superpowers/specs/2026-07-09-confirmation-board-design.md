# Crimson Desert Report Hub — Confirmation Board design

**Date:** 2026-07-09
**Status:** Approved by owner and implemented on the working branch. Recovery-audit amendment below is authoritative. The confirmation, visibility-guard, and lock-order migrations were explicitly authorized and applied successfully under their final remote versions; release verification and deployment remain separate. Supersedes `2026-07-09-autonomy-destination-roadmap.md` where they conflict (see §Supersession).
**Branch:** `preview/phase-1-lifecycle-engine`
**Audience:** Implementing agents and future reviewers.

---

## Recovery-audit amendment (2026-07-09)

The recovery audit tightened the implementation without changing the north star. Where an older detail later in this document or its plan conflicts with this amendment, this amendment wins:

- Confirmation writes go through the service-role-only `record_issue_confirmation` database RPC. It first takes the shared visibility transaction lock, then cluster/network advisory locks, checks public issue visibility inside the transaction, and keeps the private hash/timestamp attempt ledger, rolling count, and stance upsert atomic. Outcomes are `recorded`, `rate_limited`, or `unknown_issue`; the next otherwise-valid write after 20 accepted writes for a hash in a trailing hour is rate-limited.
- Claim provenance carries `fix_claimed_patch_version`. A claim clock is valid only while that exact patch is current, so a `1.13.00` claim cannot be rendered as a `1.13.01` claim. Only exact-version reports submitted after the clock count as post-claim report evidence. Public/scanner URLs always remain leads.
- Confirmation totals are server-authored. After success the browser may remember the selected stance, but it does not optimistically change public counts or the server-rendered poll strip.
- Public source-radar cards turn mapped scanner leads into calm questions. Scanner URLs remain leads, never evidence, even when visible.
- `20260709210229_visibility_override_guards.sql` adds a service-role visibility RPC that makes `Force public` / `Force hidden` immediate and atomic; database triggers preserve forced state across concurrent scanner writes. `Auto` only clears the override, and normal promotion re-evaluates effective visibility on the next scan. The action then revalidates public surfaces.
- `20260709212531_visibility_write_lock_order.sql` makes a fixed global transaction advisory lock the first lock for confirmation and cluster/source visibility writes. Statement triggers take it before row locks, eliminating the row/advisory lock inversion found in recovery review; the low-volume write boundary is intentionally serialized.
- Reddit API is permanently off. `site:reddit.com` Tavily queries are the only supported Reddit discovery path; promising thin Reddit results may receive bounded Tavily basic extraction after normalization to `old.reddit.com`. No direct credentials or Devvit configuration belong in the deployment.
- Provider lanes are explicit: the real-scan Tavily ledger has a 1,000-credit monthly ceiling, while bounded deterministic previews consume provider quota outside that ledger and require manual accounting; high-value scanner extraction and official fix-claim mapping use only `deepseek/deepseek-v4-flash` under a $2 UTC-month software cap and per-request price ceilings; routine report moderation and dossier prose use `openrouter/free`/`:free` or deterministic fallback.
- A dedicated OpenRouter key should have a provider-side monthly limit of $2 or lower with monthly reset. This is a maintainer setup and verification requirement, not a state the repository can inspect or claim is already verified.
- `20260709210222_issue_confirmations.sql`, `20260709210229_visibility_override_guards.sql`, and `20260709212531_visibility_write_lock_order.sql` were explicitly authorized and applied successfully on 2026-07-09. That completed authorization is specific to those migrations; future database changes still require current-message owner authorization. Deployment remains separate.

---

## 1. North star

The hub is a public, anonymous, privacy-respecting tracker for the current state of Crimson Desert. It has three input registers and **no verdicts**:

1. **Reports are evidence** — structured player reports, the strongest input (existing pipeline, unchanged).
2. **Confirmations are signals** — new one-tap anonymous inputs: *I have this too* / *Still happening* / *Fixed for me*, scoped to issue × platform × patch family.
3. **Scanner links are leads** — never evidence, never authority chrome. Their job is to keep the radar alive and to generate questions players can answer.

The site **counts what players say and never says more than its numbers can back**. Green is reserved for players saying "fixed for me." Absence of signal renders as an open question, never as a positive state.

### N=0 first (owner constraint, hard)

Every surface must read as a complete, alive, honest instrument with **zero community input** — the owner may never share the site, and it must stay something they love using alone. The scanner, patch sync, official notes, and claim mapping carry the site at N=0; confirmations only add resolution when visitors exist. Concretely:

- No hero, card, or label may read as begging or as an empty stadium ("players testing", "waiting on the community").
- Ask-affordances (confirm buttons) are always present but visually calm; they are invitations, not structure.
- Empty states describe what the instruments know, not what is missing.

### Cost & sources posture (owner constraint, hard)

- **Reddit API: permanently off.** Never a dependency. Reddit content arrives through Tavily web discovery (`site:reddit.com` query packs); at most two promising thin pages per scan may receive Tavily basic extraction, with Reddit URLs normalized to `old.reddit.com`.
- **Tavily:** real-scan search/extract use shares a hard 1,000-credit monthly ledger (~1 base search/run today, plus at most two bounded context reads). Protected previews are deterministic and bounded per request but sit outside that ledger, so their credits are included through manual provider-usage checks. No paid upgrade under this contract. If starvation is proven, document it and seek a new owner decision without exceeding 1,000 total account credits.
- **High-value LLM lane:** scanner extraction and official fix-claim mapping use only `deepseek/deepseek-v4-flash`. Software caps the lane at $2 per UTC month, applies provider-routing ceilings of $0.10 per million prompt tokens and $0.20 per million completion tokens, reserves worst-case request cost before sending, and opens a same-month circuit when usage cost cannot be verified or exceeds a ceiling.
- **Routine LLM lane:** report moderation and dossier prose use `openrouter/free`, an explicit `:free` model, or deterministic fallback. Provider routing carries zero-price ceilings.
- **Provider backstop:** use a dedicated OpenRouter key with a provider-side monthly reset limit of $2 or lower. Maintainers must configure and verify it manually; repository code cannot inspect that dashboard setting.
- **Confirmations cost $0 marginal:** one Supabase upsert; no LLM call, no search credit, no captcha service on the happy path.
- No other paid service, model, or cap increase without a new owner decision.

## 2. Locked decisions (owner, 2026-07-09)

| Decision | Value |
| --- | --- |
| Anti-abuse for one-tap confirms | No captcha. Same-origin check + salted IP-hash + one-voice upsert + rate limit (20 writes/hash/hour) + label gating. Invisible Turnstile escalation on rate-trip is a documented follow-up, only if abuse is observed. |
| Platform picker | **Required** — one extra tap; it is what buys per-platform truth. |
| Label vocabulary | Delegated to implementer; plain player language; nothing implies a crowd (N=0 rule). Locked set in §4. |
| Display threshold | Raw counts are always shown honestly (never hidden, never invented). **Confirmation-driven labels and filled meters escalate only at ≥2 distinct networks** for the driving tally. A single structured report is evidence immediately; a single confirmation network renders its count in dim text. |

## 3. Confirmations

### Schema and applied migration

The canonical DDL is `supabase/migrations/20260709210222_issue_confirmations.sql`. In addition to the stance table sketched below, the recovery-audited migration adds `issue_clusters.fix_claimed_patch_version`, a deny-all `issue_confirmation_attempts` hash/timestamp ledger, and the service-role-only `record_issue_confirmation` RPC described above.

```sql
create table issue_confirmations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  cluster_id uuid not null references issue_clusters(id) on delete cascade,
  patch_family text not null,   -- patchFamilyKey() of the patch at tap time, e.g. '1.13'
  patch_version text not null,  -- exact current patch at tap time, e.g. '1.13.01'
  platform text not null check (platform in ('pc_steam','ps5','ps5_pro','xbox_series_x','xbox_series_s','other')),
  kind text not null check (kind in ('have_it','still_happening','fixed_for_me')),
  voter_ip_hash text not null
);
create unique index idx_confirmations_one_voice
  on issue_confirmations (cluster_id, patch_family, voter_ip_hash);
create index idx_confirmations_cluster on issue_confirmations (cluster_id);
create index idx_confirmations_voter_time on issue_confirmations (voter_ip_hash, created_at desc);
```

RLS deny-all like every other table; service-role access only.

### Semantics

- **One voice per network per issue per patch family.** Upsert on conflict `(cluster_id, patch_family, voter_ip_hash)` replaces `kind`, `platform`, `patch_version`, and `created_at` — a voter may change their stance (e.g. *still happening* → *fixed for me*); only their latest stance counts.
- **Affected tally** = voters whose current stance is `have_it` or `still_happening`.
- **Fix poll** (only when the stored exact claimed patch is current): votes with `kind in ('fixed_for_me','still_happening')` **and `created_at >= fix_claimed_at`**. Pre-claim stances count as affected history but not as poll answers; re-tapping after the claim moves the voter into the poll. Structured reports count as post-claim evidence only when their selected patch exactly matches the claimed patch and they were submitted after the clock. Scanner URLs never count as post-claim evidence.
- **Distinct networks** = distinct `voter_ip_hash` per tally. CGNAT undercounts and IP rotation double-counts at the margins — acceptable for an explicitly-labeled tally, which is why tallies must never be converted into verdicts.
- Confirmations never outrank reports; they render as their own line and feed label escalation only per the threshold rule.

### API — `POST /api/confirmations`

Body: `{ cluster_id, platform, kind }`. Patch context is derived server-side from `getCurrentPatchMetadata()` — clients never assert the patch.

Order of checks (mirrors `api/reports/route.ts` minus captcha):
1. Vercel preview → 403 (`previewGuard`).
2. Same-origin: reject cross-site requests (`sec-fetch-site` when present must be `same-origin`/`none`; otherwise `origin` host must match the request host). JSON content-type required.
3. Zod validation: `cluster_id` uuid; `platform` ∈ PLATFORMS; `kind` ∈ kinds.
4. IP hash (`hashIp`, `SESSION_SECRET`); missing IP → still accepted but not deduplicable? **No — reject 400.** One-voice semantics require a hash; a hashless confirm is unaccountable.
5. Derive exact patch + patch family server-side from `getCurrentPatchMetadata()`.
6. Call `record_issue_confirmation` with the server-derived patch context and hash. Inside the transaction it takes the shared visibility lock first, then cluster/network locks, verifies that the cluster still exists and is public, prunes ledger rows older than one hour, and atomically records the accepted attempt plus stance upsert. `unknown_issue` → 404; `rate_limited` → 429; `recorded` continues; anything else fails closed.
7. Revalidate `PUBLIC_DASHBOARD_TAG` / `PUBLIC_ISSUES_TAG`; 201 `{ ok: true }`. Counts remain unchanged in the browser until refreshed from the server.

No captcha on this path. No raw text is accepted anywhere in the payload — enum-only input means zero moderation surface.

### Privacy

`voter_ip_hash` is the same salted one-way hash already used for reports. Hashes, attempt rows, and row-level stance data never leave the server: `queries.ts` aggregates to `{platform, kind} → {count, distinctNetworks}` per cluster, and only aggregates reach pages. The browser's local selected-stance marker is not proof of server network identity and never authors a count.

## 4. The readout composer — one brain

New pure module `src/lib/readout.ts`: `composeIssueReadout(input) → { label, tone, sentence, ask, poll?, platforms[] }`. It **replaces all five status dialects as the rendered story** (fix-status badges, `playerIssueStatus`, evidence-ladder badge, cluster-confidence badge, per-signal confidence chrome on cards). No Supabase import; exhaustive unit tests.

Inputs: per-cluster counts (approved reports, visible scanner lead links, private candidate-lead count, confirmation tallies with distinct-network counts, exact-version post-claim report count, post-claim poll tallies), claim provenance (`fix_claimed_at`, exact `fix_claimed_patch_version`, claim text), `admin_override` + stored `fix_status`, current patch metadata.

### State table (first match wins; labels locked)

| # | Condition | Label | Tone | Sentence pattern (plain, count-backed) | Ask |
| --- | --- | --- | --- | --- | --- |
| 0 | `admin_override` | stored state's label | per state | "Locked by the maintainer. <system sentence>" (admin surfaces additionally show *Locked by you* chrome; the public never sees "you") | per underlying state |
| 1 | exact-version post-claim reports > 0, or poll *still happening* ≥2 networks | **Still happening** | crimson | "Pearl Abyss claimed a fix in <patch>; N exact-patch reports / M players say it's still happening." | poll buttons |
| 2 | claim clock set, poll *fixed for me* ≥2 networks and > *still happening* | **Players say fixed** | green | "N players say <patch> fixed this for them." | poll buttons (stance can change) |
| 3 | claim clock set, neither 1 nor 2 | **Fix claimed — unverified** | amber | "Pearl Abyss says <patch> fixed this. Quiet can mean fixed — or just quiet." / exact early-answer counts below threshold | "Played since the patch? Fixed for you?" |
| 4 | reports > 0 or affected-confirms ≥2 networks | **Confirmed by players** | crimson | "N reports · M players confirm on this patch." | "Have it too? Add your tap." |
| 5 | reports == 0, visible scanner lead links > 0 | **Public sources** | amber | "Seen in N public sources. Source links stay leads, not player evidence." | "Do you have this?" |
| 6 | candidates > 0 only | **Radar lead** | blue | "The scanner spotted this N time(s). A lead is a rumor with a link, not evidence." | "Do you have this?" |
| 7 | nothing | **Watching** | dim | "The scanner checks public sources every run. Nothing's turned up this patch." | none |

Special: **quiet after claim** is state 3's zero-answer variant — the sentence says exactly "Pearl Abyss says <patch> fixed this. Quiet can mean fixed — or just quiet." Tone stays **amber, never green**. There is no time-based transition out of state 3; only player answers (→1/2) change it while that exact patch is current. A different exact patch clears that claim context unless it has its own confidently mapped claim.

Sub-threshold counts (1 network) always render in dim text within the sentence ("1 player so far"), but do not change the label. Meters/platform rows fill only from escalated tallies.

### Lifecycle pass changes (`runLifecyclePass` / `lifecycle.ts`)

- The LLM claim mapper is **kept as-is** (sure/unsure, keyword-proposal, validated slugs). A `sure` match still writes `fix_status='fix_claimed'` and starts `fix_claimed_at` — the claim clock now opens a **poll**, not a countdown.
- **Deleted:** the 7-day-silence → `verified_fixed` rule, and automation writes of `verified_fixed`/`persists`. `SILENCE_WINDOW_DAYS` dies. Automation only ever writes `reported`/`fix_claimed` going forward.
- `verified_fixed`/`persists` remain valid enum values (no schema churn; legacy rows and admin locks may hold them; composer maps them: `persists` → Still happening, `verified_fixed` → treated as claim-clock-present state 3 unless poll data says otherwise).
- `lifecycle_reason` keeps carrying "Needs review:" exception strings for unsure claim mapping (feeds the admin exceptions count). Reason strings for normal states are now composed at read time by the readout — the hourly pass stops writing prose for non-exceptions.
- `computeClusterLifecycle` shrinks to claim-clock management + exception detection; its label/detail duty moves to `readout.ts`. Tests updated accordingly.

### Retired from rendering

`playerIssueStatus` (patchWatch keeps only its patch-version utilities), `EvidenceLadderBadge` on cards, `ConfidenceBadge` on public cards, the `FixStatusBadge` `hideIfLabel` hack, and the `acknowledged` option in admin UI (dead state: no rule produces it). `evidenceLadder.ts`/`evidence.ts` survive only where used as internal count helpers; nothing user-facing renders two status systems at once.

## 5. Surfaces

### Issues page (`/issues`)
Cards rebuilt around the readout: one label badge + one sentence + per-platform tally rows (reports · confirms per platform, meter filled from escalated tallies) + confirm buttons (required platform picker appears after kind selection) + poll strip when the exact-patch claim clock is active + existing public lead links ("links seen in the wild") + approved excerpts. One status badge per card, total. Links remain leads regardless of visibility.

### Dashboard (`/`)
- Hero: patch situation first ("Patch 1.13.01 · N confirmed · M radar leads"), invitation second, N=0-safe.
- Stat row: replace "Awaiting corroboration" (private-lead exhaust) with confirmation-era stats: Confirmed this patch / Fix claims — unverified / Radar leads. Zero states are calm descriptions.
- Top-issues rows: readout label + tone; meters keyed to escalated strength.
- "Still reported after claimed fix" section: driven by state 1 (exact-version post-clock structured reports OR the player poll), never scanner URLs and not `assessClaims` disputes alone.
- Right-now strip: sentences come from the readout composer; scanner heartbeat unchanged.

### Scanner (`/scanner`)
- Public view: funnel transparency stays; kept-lead clusters render as **questions** using public cluster title/description only (the private-text boundary is untouched); confirm buttons attach where a lead maps to a public cluster.
- Admin view: rejected-candidates section reframed from queue-of-29 to a quiet expiring archive with search + rescue; counts stop presenting filter volume as pending work.

### Admin (`/admin`)
- **Deleted:** the per-cluster lifecycle dropdown farm.
- Kept: flagged-report moderation (unchanged), "Needs you" = flagged reports + claim-mapping exceptions.
- Lock controls are per-exception/per-issue actions: set lock (choose displayed state), clear lock, and atomically set `admin_visibility_override` (`force_public`/`force_hidden`/`auto`) through the service-role RPC. Database guards preserve forced visibility across concurrent scanner writes.

## 6. Out of scope / follow-ups (documented, not built now)

- Invisible Turnstile escalation when the confirmation rate limiter trips (only if abuse observed).
- Async report moderation (today the AI screen runs inside the POST — up to ~5s perceived delay; confirmations bypass it entirely).
- Brave Search as Tavily supplement (only on proven starvation).
- Removing dead X-source enum values, `runRedditMonitor` legacy action, `quarantine` intent remnant.
- Per-issue permalink pages; report-form changes; accounts (never).

## 7. Verification

- Unit: readout state table exhaustively covered (every row + threshold edges + N=0 + locked); confirmation semantics (one-voice upsert, stance change, poll windowing vs `fix_claimed_at`); route behavior (origin, validation, is_public gate, hashless reject, rate limit, upsert, revalidation) mirroring `reportsRoute.test.ts`.
- Repo gates: `npm run lint`, `npm test`, `npm exec tsc -- --noEmit`, `npm run build` — all green.
- E2E: `tests/e2e` visual snapshots regenerated for changed surfaces; mock dev server extended if it stubs cluster data.
- N=0 walkthrough: dev server without Supabase env renders dashboard/issues/scanner with calm, complete empty states — no begging copy, no green silence, no contradictory badges.
- Grep gates: no user-facing "No fresh reports" as a green state; no card renders two status badges; `hideIfLabel` gone.

## 8. Supersession

`2026-07-09-autonomy-destination-roadmap.md` remains as history, but the following of its rules are **superseded by this spec**: silence → "No fresh reports" as a settled/green state (§Lifecycle policy); "UI redesign forbidden / keep the cockpit unchanged" (owner explicitly reopened IA; the visual token system stays); follow-ups deferred to Phase 4 (confirmations are now the core mechanic); the locked human-label table (replaced by §4); any free-only LLM wording; and any Tavily-upgrade path beyond the current hard 1,000-credit ceiling. Compatible privacy and no-surprise-spend constraints remain in force.
