# ADR-001: From complaint verifier to patch intelligence publication

**Status:** Proposed
**Date:** 2026-07-16
**Deciders:** Anthony (owner)

## Context

An audit of the production database and the scanner codebase on 2026-07-16 found:

**The system works as designed — and the design is narrow.**

- 254 automation runs over 11 days produced 567 candidate sources → 95 stored signals → **1 public signal**. End-to-end publish rate: ~0.2%.
- 264 of 284 rejected candidates (93%) were rejected as `source_not_issue_report`. The rejected pile contains patch release coverage, press reception ("Frame rate and controller issues persist, despite the hotfix…"), refund news, and community reaction — high-value patch intelligence discarded because it isn't a *complaint*. Rejected rows expire after 7 days, so this intelligence is permanently lost.
- Resource utilization is low: ~290 of 1,000 monthly Tavily credits at current pace; $2.32 total LLM spend against a $2/month cap since launch. Scheduled runs use **1 search query per hour**, patch day or not. On 1.14.00's release day the scanner ran its normal trickle.
- The LLM extraction call (deepseek-v4-flash, temp 0, 400 max tokens) extracts only `{issueTitle, category, platform, confidence, summary, clusterSlug}` — the marginal cost of richer extraction is ~zero.
- Stored-but-never-surfaced data: `extracted_facts.platform`, `seen_count`/re-observation (one press link re-observed 18×), per-run `funnel` JSON (full pipeline telemetry per run), `extraction_provider/model/cost`, `promotion_reason`, 45 `official_patch_claimed_fixes` rows (31 uncategorized), and the entire `dossier_runs` generator (ran once, on day one, with zero data).
- The claim-mapping LLM lane (official fix claims → clusters) exists and works, but its output surfaces only as a small "fix claims" count and per-cluster poll.

**Constraints:** free-tier Supabase; ≤1,000 Tavily credits/mo; ≤$2/mo LLM (hard cap in code); Reddit API permanently unavailable (Tavily-as-Reddit-proxy is the settled strategy); the evidence model (reports = evidence, taps = signals, links = leads) is non-negotiable brand integrity.

## Decision (proposed)

Keep the evidence pipeline exactly as strict as it is. Add a second, explicitly-typed **observation lane** beside it, make the scanner **patch-aware**, and build the public surface around the one artifact only this site can produce: the **claimed-fix scoreboard** (Pearl Abyss said it's fixed → players verify).

## Options considered

### Option A: Tune the existing funnel (loosen pre-screen, more queries)
| Dimension | Assessment |
|-----------|------------|
| Complexity | Low |
| Cost | Same budget |
| Payoff | Low — more of the same thin output |

**Pros:** cheap. **Cons:** the funnel isn't broken — it's aimed at a narrow target. Loosening it degrades evidence integrity without adding new value.

### Option B: Observation lane + patch-aware cadence + claimed-fix scoreboard (recommended)
| Dimension | Assessment |
|-----------|------------|
| Complexity | Medium (schema: one `kind` column + one shelf table or reuse of rejected pile; scanner: burst scheduler + reroute of 3 existing pre-screen labels; UI: 2–3 new sections in the established editorial language) |
| Cost | Fits existing budgets with ~3× headroom |
| Payoff | High — the site becomes interesting on patch day, and produces a PA-facing artifact |

**Pros:** uses data already fetched and currently trashed; epistemically honest (observations are labeled, never counted as evidence); the fix-claim → player-verdict loop is unique and is precisely what a developer would value. **Cons:** more surface area to moderate; risks reading as "news site" if typing is sloppy.

### Option C: New data sources (Steam reviews API, YouTube API, Discord)
| Dimension | Assessment |
|-----------|------------|
| Complexity | High |
| Cost | New quotas, new failure modes |
| Payoff | Unproven while existing data is unused |

**Cons:** premature — Option B's discard pile already contains most of this signal. Revisit after B ships.

## The plan (Option B, sequenced)

### Phase 1 — Use what already exists (no new gathering)
1. **Claimed-fix scoreboard.** Per patch: N claims from `official_patch_claimed_fixes`, mapped to clusters (claim-mapping lane already does this), with player verdicts from confirmations (`fixed_for_me` / `still_happening`) and "awaiting word" for unmapped claims. Marquee section on the Patch Brief; full table on Issues or its own patch page. *This is the Pearl Abyss artifact.*
2. **Patch retrospective (resurrect the dossier).** Auto-regenerate on patch rollover (a new `is_current` patch), publish as a per-patch archive page. The generator already exists.
3. **Scanner telemetry from `automation_runs.funnel`.** A 30-day reviewed/kept/rescued strip and honest cost line ("this month: 288 searches, $0.61 LLM") on /scanner — fits the transparency brand and the data is already stored.
4. **Surface re-observation heat.** `seen_count` ≥ N on a signal = "this link keeps resurfacing" — a lead-strength cue, labeled as such.

### Phase 2 — Gather smarter (same budget)
5. **Patch-aware cadence.** On new `official_patch_notes` row: 72h burst (3 queries/run, hourly). Quiet weeks: 1 query every 2h. Projected worst case ≈ 700–800 credits/mo, inside cap.
6. **Observation lane.** Pre-screen labels that currently mean "trash" (`isPatchReleaseTitle`, `isBroadContentTitle` press subset, `isFixAnnouncement`, "what people are saying" reception content) instead write typed observations (`kind: patch_release | press_reception | fix_announcement`) with domain + snippet + patch. Displayed in a visually distinct register ("OBSERVATION" mark), never counted in evidence numbers, capped per patch.
7. **Widen the symptom matrix.** The 6-query pack is all crash/stutter/FPS. Rotate audio, quest/progression blockers, save corruption, controller/deadzone, DLSS/FSR/XeSS artifacts, HDR, VRR, Steam Deck, input latency. Add per-category corroboration queries for clusters stuck at "awaiting."
8. **Richer extraction, same call.** Add fields to the existing JSON schema: `severityGuess`, `symptomKeywords[]`, `mentionsWorkaround` (+ optional one-line workaround summary, labeled unverified lead), `fixClaimReaction (fixed|still_broken|mixed|null)`. Marginal cost ≈ zero at current token limits; unlocks a "workarounds spotted" shelf and reaction tracking.

### Phase 3 — Display (after 1–2 land)
9. **Patch-over-patch comparison.** Signal volume + category mix per patch family (1.13.00 → 1.13.01 → 1.14.00) from data already in `source_signals`/`bug_reports`.
10. **Patch-day live mode.** During burst windows the "Right now" rail elevates: observations feed a dispatch column, claims scoreboard shows "too early to call" honestly.

## Trade-off analysis

The central tension is **integrity vs. interestingness**. The current system maximizes integrity and starves interestingness (1 public link). Option B resolves it by *typing*, not loosening: the evidence bar stays exactly where it is; new content enters as a fourth explicit epistemic class (evidence / signal / lead / **observation**) with its own visual register. The failure mode to guard: observation creep into evidence counts — enforce at the query layer (observations live in their own lane, never in `signal_count`).

## Consequences

- Easier: the site has something true and current to say every patch day; the dossier becomes a living PA-facing artifact; Tavily/LLM budgets actually get used.
- Harder: more moderation surface (mitigate: observation caps + domain allowlist + 48h TTL on anything unreviewed); more copy to keep honest.
- Revisit: after one full patch cycle, measure — observations shown vs. clicked, claims verified vs. awaiting, credits consumed. Then decide on Option C sources.

## Action items
1. [x] Owner sign-off on the observation lane concept (epistemics + caps) — approved 2026-07-16
2. [x] Phase 1.1: claimed-fix scoreboard — shipped 2026-07-16 (`src/lib/fixScoreboard.ts`, Patch Brief section)
3. [ ] Phase 1.2: dossier auto-regen on patch rollover + archive page
4. [ ] Phase 1.3: scanner telemetry strip from `automation_runs.funnel`
5. [ ] Phase 2.5: burst scheduler keyed on `official_patch_notes.is_current` change
6. [x] Phase 2.6: observation lane — shipped 2026-07-16 (migration file `20260716210000_patch_observations.sql` NOT yet applied to production; scanner reroute in `relevance.ts`/`run.ts`/`observations.ts`; "Around the patch" section on the Patch Brief; fails soft until the migration is applied)
7. [ ] Phase 2.7–2.8: query matrix + extraction schema extension
8. [x] Community-pulse lane (added post-ADR, owner-requested 2026-07-16): `community_pulse` discovery intent
   (request language, no bug vocabulary, every third discovery turn), `community_ask` observation genre with a
   14-day freshness window, series fingerprinting so daily "day N of asking" campaign posts collapse into one
   row whose `seen_count` tracks momentum, and a "What players are asking for" section on the Patch Brief.
   Asks are pulse, not evidence — same epistemics and caps as the observation lane.
