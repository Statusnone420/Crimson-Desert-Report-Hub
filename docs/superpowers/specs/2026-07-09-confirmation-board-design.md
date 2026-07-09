# Crimson Desert Report Hub — Confirmation Board design

**Date:** 2026-07-09
**Status:** Approved by owner. Supersedes `2026-07-09-autonomy-destination-roadmap.md` where they conflict (see §Supersession).
**Branch:** `preview/phase-1-lifecycle-engine`
**Audience:** Implementing agents and future reviewers.

---

## 1. North star

The hub is a public, anonymous, privacy-respecting tracker for the current state of Crimson Desert. It has three input registers and **no verdicts**:

1. **Reports are evidence** — structured player reports, the strongest signal (existing pipeline, unchanged).
2. **Confirmations are signals** — new one-tap anonymous inputs: *I have this too* / *Still happening* / *Fixed for me*, scoped to issue × platform × patch family.
3. **Scanner links are leads** — never evidence, never authority chrome. Their job is to keep the radar alive and to generate questions players can answer.

The site **counts what players say and never says more than its numbers can back**. Green is reserved for players saying "fixed for me." Absence of signal renders as an open question, never as a positive state.

### N=0 first (owner constraint, hard)

Every surface must read as a complete, alive, honest instrument with **zero community input** — the owner may never share the site, and it must stay something they love using alone. The scanner, patch sync, official notes, and claim mapping carry the site at N=0; confirmations only add resolution when visitors exist. Concretely:

- No hero, card, or label may read as begging or as an empty stadium ("players testing", "waiting on the community").
- Ask-affordances (confirm buttons) are always present but visually calm; they are invitations, not structure.
- Empty states describe what the instruments know, not what is missing.

### Cost & sources posture (owner constraint, hard)

- **Reddit API: permanently off.** Never a dependency. Reddit content arrives via Tavily web search (`site:reddit.com` query packs) only.
- **Tavily:** stays inside the free ~1000 credits/month envelope (~1/run today). No paid upgrade unless the funnel proves search starvation (old roadmap §F analysis still holds). If starvation is ever proven, Brave Search API free tier (2000/month) is the documented supplement to evaluate first.
- **LLM:** free OpenRouter models only (existing deepseek/qwen fallback chain) for extraction, claim mapping, and report moderation.
- **Confirmations cost $0 marginal:** one Supabase upsert; no LLM call, no search credit, no captcha service on the happy path.
- No new paid services.

## 2. Locked decisions (owner, 2026-07-09)

| Decision | Value |
| --- | --- |
| Anti-abuse for one-tap confirms | No captcha. Same-origin check + salted IP-hash + one-voice upsert + rate limit (20 writes/hash/hour) + label gating. Invisible Turnstile escalation on rate-trip is a documented follow-up, only if abuse is observed. |
| Platform picker | **Required** — one extra tap; it is what buys per-platform truth. |
| Label vocabulary | Delegated to implementer; plain player language; nothing implies a crowd (N=0 rule). Locked set in §4. |
| Display threshold | Raw counts are always shown honestly (never hidden, never invented). **Computed labels and filled meters escalate only at ≥2 distinct networks** for the driving tally. A single network renders its count in dim text. |

## 3. Confirmations

### Schema (migration file only — no production apply without owner OK in-message)

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
- **Fix poll** (only when a claim clock exists): votes with `kind in ('fixed_for_me','still_happening')` **and `created_at >= fix_claimed_at`**. Pre-claim stances count as affected history but not as poll answers; re-tapping after the claim moves the voter into the poll.
- **Distinct networks** = distinct `voter_ip_hash` per tally. CGNAT undercounts and IP rotation double-counts at the margins — acceptable for an explicitly-labeled tally, which is why tallies must never be converted into verdicts.
- Confirmations never outrank reports; they render as their own line and feed label escalation only per the threshold rule.

### API — `POST /api/confirmations`

Body: `{ cluster_id, platform, kind }`. Patch context is derived server-side from `getCurrentPatchMetadata()` — clients never assert the patch.

Order of checks (mirrors `api/reports/route.ts` minus captcha):
1. Vercel preview → 403 (`previewGuard`).
2. Same-origin: reject cross-site requests (`sec-fetch-site` when present must be `same-origin`/`none`; otherwise `origin` host must match the request host). JSON content-type required.
3. Zod validation: `cluster_id` uuid; `platform` ∈ PLATFORMS; `kind` ∈ kinds.
4. Cluster must exist and be `is_public = true` (confirmations target visible issues only).
5. IP hash (`hashIp`, `SESSION_SECRET`); missing IP → still accepted but not deduplicable? **No — reject 400.** One-voice semantics require a hash; a hashless confirm is unaccountable.
6. Rate limit: ≤20 rows with this `voter_ip_hash` and `created_at` in the trailing hour → 429.
7. Upsert; `revalidateTag(PUBLIC_DASHBOARD_TAG/PUBLIC_ISSUES_TAG)`; 201 `{ ok: true }`.

No captcha on this path. No raw text is accepted anywhere in the payload — enum-only input means zero moderation surface.

### Privacy

`voter_ip_hash` is the same salted one-way hash already used for reports. Hashes and row-level data never leave the server: `queries.ts` aggregates to `{platform, kind} → {count, distinctNetworks}` per cluster, and only aggregates reach pages. Documented as a privacy boundary comment like `getCandidateSignalCountsByCluster`.

## 4. The readout composer — one brain

New pure module `src/lib/readout.ts`: `composeIssueReadout(input) → { label, tone, sentence, ask, poll?, platforms[] }`. It **replaces all five status dialects as the rendered story** (fix-status badges, `playerIssueStatus`, evidence-ladder badge, cluster-confidence badge, per-signal confidence chrome on cards). No Supabase import; exhaustive unit tests.

Inputs: per-cluster counts (approved reports, public signals, private candidate count, confirmation tallies with distinct-network counts, post-claim evidence count, post-claim poll tallies), claim state (`fix_claimed_at`, claim text), `admin_override` + stored `fix_status`, current patch metadata.

### State table (first match wins; labels locked)

| # | Condition | Label | Tone | Sentence pattern (plain, count-backed) | Ask |
| --- | --- | --- | --- | --- | --- |
| 0 | `admin_override` | stored state's label | per state | "Locked by the maintainer. <system sentence>" (admin surfaces additionally show *Locked by you* chrome; the public never sees "you") | per underlying state |
| 1 | post-claim evidence > 0, or poll *still happening* ≥2 networks | **Still happening** | crimson | "Pearl Abyss claimed a fix in <patch>; N players / sources say it's still happening." | poll buttons |
| 2 | claim clock set, poll *fixed for me* ≥2 networks and > *still happening* | **Players say fixed** | green | "N players say <patch> fixed this for them." | poll buttons (stance can change) |
| 3 | claim clock set, neither 1 nor 2 | **Fix claimed — unverified** | amber | "Pearl Abyss says <patch> fixed this. No player answers yet." / "…early answers are split." | "Played since the patch? Fixed for you?" |
| 4 | reports > 0 or affected-confirms ≥2 networks | **Confirmed by players** | crimson | "N reports · M players confirm on this patch." | "Have it too? Add your tap." |
| 5 | reports == 0, public signals > 0 | **Public sources** | amber | "Seen in N public sources; no player here has confirmed it yet." | "Do you have this?" |
| 6 | candidates > 0 only | **Radar lead** | blue | "The scanner spotted this N time(s). A lead is a rumor with a link — it counts for nothing until players confirm." | "Do you have this?" |
| 7 | nothing | **Watching** | dim | "The scanner checks public sources every run. Nothing's turned up this patch." | none |

Special: **quiet after claim** is state 3's zero-answer variant — the sentence says exactly "Quiet since the fix claim. Quiet can mean fixed — or just quiet." Tone stays **dim/amber, never green**. There is no time-based transition out of state 3; only player answers (→1/2) or a new patch family move it.

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
Cards rebuilt around the readout: one label badge + one sentence + per-platform tally rows (reports · confirms per platform, meter filled from escalated tallies) + confirm buttons (required platform picker appears after kind selection) + poll strip when the claim clock is set + existing public signal links ("links seen in the wild") + approved excerpts. One status badge per card, total.

### Dashboard (`/`)
- Hero: patch situation first ("Patch 1.13.01 · N confirmed · M radar leads"), invitation second, N=0-safe.
- Stat row: replace "Awaiting corroboration" (private-lead exhaust) with confirmation-era stats: Confirmed this patch / Fix claims — unverified / Radar leads. Zero states are calm descriptions.
- Top-issues rows: readout label + tone; meters keyed to escalated strength.
- "Still reported after claimed fix" section: driven by state 1 (post-claim evidence OR poll), not `assessClaims` disputes alone.
- Right-now strip: sentences come from the readout composer; scanner heartbeat unchanged.

### Scanner (`/scanner`)
- Public view: funnel transparency stays; kept-lead clusters render as **questions** using public cluster title/description only (the private-text boundary is untouched); confirm buttons attach where a lead maps to a public cluster.
- Admin view: rejected-candidates section reframed from queue-of-29 to a quiet expiring archive with search + rescue; counts stop presenting filter volume as pending work.

### Admin (`/admin`)
- **Deleted:** the per-cluster lifecycle dropdown farm.
- Kept: flagged-report moderation (unchanged), "Needs you" = flagged reports + claim-mapping exceptions.
- Lock controls become per-exception/per-issue actions: set lock (choose displayed state), clear lock — plus a **new writer for `admin_visibility_override`** (`force_public`/`force_hidden`), which the promotion engine already reads but nothing currently sets (known gap: crash_startup_hang needed a manual DB poke).

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

`2026-07-09-autonomy-destination-roadmap.md` remains as history, but the following of its rules are **superseded by this spec**: silence → "No fresh reports" as a settled/green state (§Lifecycle policy); "UI redesign forbidden / keep the cockpit unchanged" (owner explicitly reopened IA; the visual token system stays); follow-ups deferred to Phase 4 (confirmations are now the core mechanic); the locked human-label table (replaced by §4). Its cost posture (§F Tavily analysis) and privacy constraints remain in force.
