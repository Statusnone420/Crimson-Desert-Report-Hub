# Crimson Desert Report Hub — Autonomy & Destination Roadmap

**Date:** 2026-07-09  
**Status:** Phase 1 approved by owner and implemented on `dev` for review. GLM-5.2 review amendments, owner AI-first realignment, and GSD codebase map findings incorporated (2026-07-09).
**Audience:** Implementing agents and future reviewers.  
**Branch:** `dev`  
**Mode:** Design / roadmap plus Phase 1 implementation record.
**Authoring agent:** Grok (roadmap) + GLM-5.2 (structural review, approve-with-amendments) + Grok (amendment merge).

---

## Owner realignment (post GLM / 5.5 Q&A)

The owner wants the automation and cheap LLM path to be the **brain** of the product, not a source of daily admin homework. The hourly scan should gather data, the LLM should make high-value claim-to-issue judgments when it is sure, deterministic rules should age those decisions, and the admin should only be called for real exceptions.

Human-facing lifecycle language is locked:

| Internal value | Human label |
| --- | --- |
| `reported` | **Open** |
| `fix_claimed` | **Watching fix** |
| `verified_fixed` | **No fresh reports** |
| `persists` | **Still happening** |
| `admin_override = true` | **Locked by you** |

The old Phase 1 framing was partly wrong for this owner:

1. “Quiet after claim” and “Looks settled” are not acceptable public/admin copy. The settled label is **No fresh reports**.
2. Dumb keyword matching is not the primary confidence brain. LLM-sure claim mapping is primary; keyword routing is only a backup/proposal path.
3. The admin fix-status list should stop being daily work. It remains as override/advanced control.
4. The concern is not “AI is unreliable”; the concern is treating negation-blind keyword fallbacks as if they were sure.

The UI constraint remains unchanged: keep the same dense HUD/cockpit. Make the data and lifecycle brain smarter; do not redesign the product chrome.

## GSD codebase-map refinements (2026-07-09)

GSD mapped the existing app before this plan was approved for execution. The generated mapping artifacts are local planning notes and are intentionally kept out of the public repo; the durable Phase 1 constraints are captured here:

1. The app is a route-first Next.js 16 / React 19 system. New lifecycle logic belongs in narrow `src/lib` and `src/lib/automation` modules, with route handlers and server actions kept as integration boundaries.
2. There is no dedicated background worker. The lifecycle pass must run inside the existing cron/admin-triggered automation request path, be bounded/idempotent, and avoid broad worker/queue architecture in Phase 1.
3. Current run orchestration is best-effort and can be weak under concurrent triggers. Phase 1 does not need to solve the whole job-locking architecture, but it must not add fragile lifecycle writes that duplicate, race, or overwrite newer decisions from a stale run snapshot.
4. Existing admin/session auth is custom and not hardening-grade. Phase 1 should reuse the current `adminGuard` / session boundary for override actions and avoid expanding privileged mutation surface; a full auth hardening project is separate.
5. Existing Reddit API code may remain, but Phase 1 must not require, expand, or depend on Reddit API health. Tavily/OpenRouter remain the intended discovery and claim-analysis path for this roadmap.
6. Verification should use the existing local gates: Vitest for pure/domain and route behavior, lint/type-check/build for integration safety, and Playwright screenshots only when UI wiring changes need HUD-regression proof.

## A) What the owner wants (product north star)

### One sentence

A **cockpit for the current state of Crimson Desert** — dense HUD-style dashboard people *want to open* even if they never submit a report — that stays healthy for weeks/months with little maintainer labor, because **better data and lifecycle automation feed the existing UI**, not because the UI is redesigned.

### UI constraint (owner, explicit — non-negotiable)

> “I don’t want the UI reinvented. I love the dashboards, the graphs, it feels like a HUD or a cockpit. I just want the data we are getting or about to get to **serve the UI better**.”

**Implications for any implementing agent:**

- **Do not** redesign layout, visual language, component system, or “modernize” the dashboard for taste.
- **Do** fix contradictory status composition, empty/misleading metrics, wrong fix_status, noise queues, and missing lifecycle fields so the **same cockpit instruments read true**.
- Destination quality = **trustworthy instruments + complete situation**, not a new skin.
- Phase 2 is **data → existing surfaces**, not a homepage redesign project.

### Not the north star

- Not “stop the product from lying” / moral honesty campaign  
- Not methodology-page pride  
- Not admin triage factory  
- Not official Pearl Abyss verifier  
- Not a UI redesign  

### Concrete user jobs

1. **Visitor (zero reports):** Opens the existing dashboard/issues/scanner HUD instead of X/Reddit/Steam/Facebook. Leaves knowing: current patch, what is open, what PA says is being watched, what has no fresh reports, what is only a lead, and official links. Graphs and meters reflect real lifecycle, not admin guesswork.
2. **Reporter (rare):** Structured report still works; system clusters it; no form bloat required for v1.
3. **Maintainer:** Override mistakes, clear overrides, and handle true “Needs you” exceptions. Not daily fix-status judge.

### FPS acceptance story (lifecycle)

Owner reported FPS regression (1 report, 0 public signals). 1.13.01 shipped; seems fixed. The old workflow asked the owner to choose a fix-status label manually, then offered no next step.

**Desired:** The AI-driven system maps the PA claim to the issue when it is sure, then drives **Watching fix** → **No fresh reports** after 7 public-silent days or **Still happening** if public post-hotfix evidence appears. Existing badges stay short; detail lines explain the why. No dropdown required.

### Constraints (hard)

- Privacy model unchanged (no accounts, raw private, etc.)
- Stack: Next.js, Supabase, hourly automation, Tavily, OpenRouter free models, Cloudflare cron
- Work on `dev`; no production `supabase db push` without explicit owner OK in-message
- Surgical reuse; AGENTS.md simplicity
- **Preserve HUD/cockpit UI**

### Owner revision log (must honor)

| Owner feedback | Design implication |
| --- | --- |
| Don’t call product a “liar”; data is disjointed/fragile | Problem = uncoordinated systems + manual lifecycle |
| Kill standalone Phase 0 “honesty pass” | Status composition is part of lifecycle + data quality, not a sermon phase |
| Quiet-period “empty state poetry” felt meaningless | Make instruments work with sparse data; don’t invent fluff banners as the product |
| Follow-ups: smarter, not dumb Yes/No | Weighted, patch-bound, rate-limited signal type |
| Proud = good site people visit for the game | Destination = useful cockpit, not polish theater |
| Love existing UI — don’t reinvent | Data serves UI; no redesign phase |
| Reddit API likely never | Shelve; Tavily discovers Reddit/web URLs |
| Silence window | **7 days** (owner chose) |
| Tavily $30 / 4× credits? | Explain what Tavily is + whether more credits help (see §Tavily) |

---

## B) Grounded system reality

### Already automated

- Hourly scan: `src/lib/automation/run.ts`, `api/cron/keepalive`, `cloudflare/scanner-cron`
- Tavily + OpenRouter extract; budgets in `budget.ts`, `settings.ts`
- Patch sync + claimed fixes: `officialPatch.server.ts` → `official_patch_notes`, `official_patch_claimed_fixes`
- Routing: `automation/route.ts`; promotion: `automation/promote.ts`
- Claims display dispute: `claims.ts` `assessClaims` + `postCurrentPatchEvidenceCount`
- Labels: `evidenceLadder.ts`, `patchWatch.ts`; homepage: `rightNow.ts`
- Report moderation: `moderation.ts`

### Broken hinge

- `fix_status` **admin-only** (`setClusterFixStatus`) — not driven by claims/silence
- Claims dispute does not write `persists` / `fix_claimed`
- Multiple status dialects compose into **conflicting badges** on one card
- Scanner review queue presents filtered noise as homework
- App hard-caps Tavily at **1000/month** even if the Tavily account has more

### Status dialect problem

`fix_status` + evidence ladder + `playerIssueStatus` each useful, together disjointed.  
**Fix:** one composer → primary label + detail/reason the **existing** badges and panels consume. Not a new visual design.

---

## C) Kimi: steal vs discard

**Steal:** evidence ≠ courtroom truth; maintainer = override; claim + silence + post-hotfix loop; exceptions-only queues; scanner as continuous user; follow-ups if designed as real signals.

**Discard:** greenfield 7-state product; embeddings/auto-merge early; “clusters are all manual”; casual re-ID; liar framing; methodology-as-pride; form bloat; Reddit API required; **UI reinvention**.

---

## D) Strategy spine

1. **Phase 1 — AI-first lifecycle engine + status composer** (automation brain)
2. **Phase 2 — Feed the cockpit** (wire better data into **existing** dashboard/issues/scanner instruments; no redesign)  
3. **Phase 3 — Maintainer exceptions only**  
4. **Phase 4 — Smart follow-ups**  
5. **Phase 5 — Tavily-centric sources; Reddit API shelved; budget only if measured starvation**

---

## E) Phases

### Phase 1 — AI-first lifecycle engine + status composer

**Pain:** `/admin` currently turns lifecycle into a long fix-status dropdown farm. The owner wants the hourly automation and LLM path to do almost all lifecycle judging, and the admin page to become an exceptions screen.

#### Brain hierarchy

1. **Primary:** LLM/OpenRouter path decides official-claim → cluster mapping and may drive lifecycle writes when it is sure. The existing `extract.ts` pattern already validates LLM cluster slugs against known cluster options; Phase 1 should add a claim-mapping equivalent rather than pretending keyword regex is the brain.
2. **Secondary:** Pure deterministic lifecycle rules handle silence windows, public-evidence gates, admin overrides, and status composition.
3. **Backup only:** Keyword routing can propose a possible match when the LLM is unavailable or unsure, but it must not auto-apply lifecycle as if certain.

This is pro-AI, not anti-AI. The product should distrust negation-blind keyword fallbacks, not the cheap LLM decision path the owner already wants to use.

#### Required schema (minimal migration — file only until owner OK to apply)

`issue_clusters` today has **no** `fix_claimed_at` / override bit (`schema.sql`). Silence cannot safely use patch `published_at` alone (claim may link mid-patch → false immediate settled state).

| Column | Type | Purpose |
| --- | --- | --- |
| `fix_claimed_at` | `timestamptz null` | Clock start: first time lifecycle commits an LLM-sure claim→cluster match |
| `admin_override` | `boolean not null default false` | Composer must not clobber owner overrides on hourly runs |
| `lifecycle_reason` | `text null` | Short full-sentence explanation of current lifecycle state, including “system would say…” when overridden |

No new `fix_status` enum values. Internal values stay for minimal migration pain; human-facing labels must come from the locked label table above. Reuse `verified_fixed` for **No fresh reports** semantics. Never show “Quiet after claim,” “Looks settled,” or “Verified fixed” to users/admins as status truth.

Legacy rows: first composer-enabled run re-derives all **non-overridden** clusters under the new rules. Do not grandfather all old non-`reported` rows as manual overrides unless the owner later asks.

#### Claim mapping policy

Add an LLM claim-mapping helper that takes official claimed fix text and known issue clusters, then returns:

| Match kind | Lifecycle authority | Auto-write `fix_status = fix_claimed`? | Set `fix_claimed_at`? |
| --- | --- | --- | --- |
| LLM-sure validated cluster slug | Primary | Yes | Yes, if null |
| LLM unsure / no valid slug | Exception/proposal | No | No |
| Keyword fallback only | Backup/proposal | No | No |
| No match | None | No | No |

The keyword route may keep returning a fallback/proposal signal for admin context, but it is not the main confidence brain and it must not start the lifecycle clock.

#### Lifecycle policy (owner locked)

| Rule | Behavior |
| --- | --- |
| LLM-sure claim match | Auto `fix_claimed`; label **Watching fix**; set `fix_claimed_at` if null |
| LLM unsure or keyword-only match | Do not change `fix_status`; surface a short exception/proposal reason for admin |
| `fix_claimed` + **public** post-hotfix evidence > 0 | Auto `persists`; label **Still happening** |
| `fix_claimed` + **7 days** after `fix_claimed_at` + zero **public** post-hotfix evidence | Auto `verified_fixed`; label **No fresh reports** |
| Private/candidate-only post-hotfix noise | Does **not** flip to `persists` |
| No claim | Keep ordinary active/open state; do not invent settled/fixed |
| `admin_override = true` | Skip lifecycle status writes; show **Locked by you** and refresh “system would say…” reason when possible |
| Clear override admin action | Re-enable automation control |

Run lifecycle for **all relevant non-overridden clusters at each automation run end**, not only clusters touched by new signals. Public-silent days must still age from `fix_claimed_at` toward **No fresh reports**.

**Public post-hotfix evidence** = only public signals with `public_status = 'public'` plus explicit current-hotfix public report evidence where applicable. Private scanner candidates alone cannot force **Still happening**; this preserves the FPS case with 1 approved report and 0 public signals.

#### Human labels and reason lines

`FIX_STATUS_META` and public/admin composition must map internal statuses to:

- `reported` → **Open**
- `fix_claimed` → **Watching fix**
- `verified_fixed` → **No fresh reports**
- `persists` → **Still happening**
- `admin_override = true` → **Locked by you**

Reason strings must be short, full sentences in existing detail slots, for example:

- “PA’s 1.13.01 notes look related; watching for fresh public reports.”
- “No fresh public reports for 7 days after the fix claim.”
- “Fresh public evidence appeared after the claimed fix.”

#### Admin behavior

The admin page should emphasize exceptions:

- “Needs you” count = flagged player reports + LLM-unsure/system-conflict lifecycle exceptions.
- Normal day target: **Needs you = 0**.
- Existing dropdowns remain available as override/advanced controls, but are no longer the main workflow.
- Manual status change sets `admin_override = true` and writes an owner-readable override reason.
- Clear override action returns the row to automation.
- `lifecycle_reason` shows what the system decided or would decide.

#### Memory and cost posture

Use short, overwriteable reasons and override corrections the model can re-read. Do not append chat logs, full source dumps, or large prompt memories. Do not add embeddings, Reddit API, Tavily paid upgrades, or new proposal tables in Phase 1 unless implementation proves unavoidable.

Owner is comfortable spending pennies on DeepSeek/OpenRouter for high-value decisions. Prefer a small number of LLM claim-linking / exception-triage calls over pushing that judgment back to the admin.

#### Build

1. Add LLM claim mapping near the existing extraction/routing layer. It should validate returned slugs against known clusters and classify results as `sure` or `unsure`; keyword fallback is proposal-only.
2. Keep/extend `routeToWatchlistCluster` for scanner signal routing, but do not present keyword confidence as lifecycle authority.
3. Add pure `src/lib/lifecycle.ts` — `computeClusterLifecycle(input) → { status, primaryLabel, detail, reasons, needsHuman }`. Inputs include LLM claim decision, fallback proposal, `fix_claimed_at`, public post-hotfix evidence count, patch metadata, `admin_override`, and current status. No Supabase import.
4. Migration file for `fix_claimed_at`, `admin_override`, `lifecycle_reason`.
5. Automation run hook runs inside the existing cron/admin-triggered request path. It loads current patch claimed fixes and all relevant clusters, runs LLM claim mapping where needed, runs pure lifecycle for every relevant cluster, then writes `fix_status` / `fix_claimed_at` / `lifecycle_reason` when not overridden. The pass must be idempotent, bounded, and safe if two runs are triggered close together; stale snapshots must not overwrite newer lifecycle decisions.
6. Admin actions: manual status sets override; clear-override action; admin page shows “Needs you”, system reasons, and override state in existing chrome. Reuse the existing admin guard/session boundary for every privileged lifecycle mutation.
7. Label map + read path: use the composer’s primary story in `rightNow`, issues, and claims display. Do not delete/rewrite `playerIssueStatus`, `evidenceLadder`, or `assessClaims`; route the primary story through the new composer surgically.
8. Leave `issue_clusters.confidence` alone unless proven display-only and needed. Do not create a fifth status dialect.

**Non-goals:** UI redesign, embeddings, follow-ups, Reddit API expansion, Tavily cap raise, production `db push`, paid OpenRouter models, form redesign, accounts, proposal tables unless unavoidable, queue/worker rewrite, full run-locking architecture, admin auth overhaul, CSP hardening.

**Verify:**  
- Unit tests: LLM-sure claim → `fix_claimed`; LLM-unsure/keyword-only does not auto-write; 7-day silence from `fix_claimed_at` → **No fresh reports**; public evidence → **Still happening**; private-only candidates do not force persistence; override passthrough; clear override restores automation.
- FPS fixture: 1 approved player report, 0 public signals, LLM-sure claim match → **Watching fix**; after 7 days public silence → **No fresh reports**; public post-hotfix signal → **Still happening**; zero admin clicks.
- Concurrency guard: duplicate/near-simultaneous run simulation does not double-set `fix_claimed_at`, clobber `admin_override`, or regress a newer `persists` / **Still happening** decision.
- Repo gates: `npm run lint`, `npm test`, `npm exec tsc -- --noEmit`, and `npm run build`; run Playwright screenshots only if Phase 1 changes visible HUD wiring.
- No user/admin-facing “Quiet after claim,” “Looks settled,” or “Verified fixed” status labels.
- No contradictory primary labels on one card.

**Files:** new claim mapper/lifecycle module(s), `extract.ts` or adjacent automation helper, `route.ts`, `run.ts`, `claims.ts`, `patchWatch.ts`, `rightNow.ts`, `queries.ts`, `admin/actions.ts`, `admin/page.tsx`, `components/ui.tsx`, migration under `supabase/migrations/`, tests listed in §M checklist.

---

### Phase 2 — Feed the cockpit (NOT reinvent the UI)

**Pain:** Instruments look cool but data is thin, conflicting, or admin-stale — so the HUD feels fragile.

**Build (data/wiring, preserve layout)**

- Ensure Right Now observations, meters, sparklines, “top issues,” claimed-fix panels, watchlist cards all call the **same** lifecycle/status composer
- Show **reason subtitles** where UI already has detail lines (e.g. “No new signals for 7d since claim matched …”) — fill existing text slots
- Graphs: if 30-day activity chart is empty-looking, that may be real sparsity — do not fake points; ensure patch markers / current-patch framing already in chart are correct
- Issues page: same cards, better status truth; **No fresh reports** items can sort lower using existing patterns (no new visual system)
- Scanner page: keep dense operator HUD; change **what counts mean** (exceptions vs raw filtered) more than layout

**Forbidden in Phase 2**

- New design system, color palette, nav IA overhaul, “marketing homepage,” removing graphs for minimalism

**Verify:** Side-by-side screenshots: layout recognizable as same cockpit; status lines no longer contradict; zero-report week still shows real patch + scanner + claim instruments

**Files:** `rightNow.ts`, `page.tsx`, `issues/page.tsx`, query aggregations — **minimal JSX churn**

---

### Phase 3 — Maintainer → exceptions only

**Queues**

| Queue | Target |
| --- | --- |
| Player flagged reports | Real, rare |
| Scanner filtered / keep-for-review | Archive/rescue pool, not todo of 29 |

**Build:** scanner metrics emphasize “need rescue”; terminal reasons de-emphasized; fix-status section shows computed + override

**Verify:** normal day zero required admin clicks; rescue still works

---

### Phase 4 — Smart follow-ups

**Reject:** naked Yes/No equal to reports.

**Smarter**

- Bound to **current patch**
- Only clusters in monitoring / thin / claimed-fix states
- Separate low-weight signal type; rate-limit via IP hash; thresholds before affecting `persists`
- “Not seeing it” cannot alone force **No fresh reports**
- Existing issue card CTA patterns preferred over new page types

**Verify:** flood resistance; **No fresh reports** never depends only on No-clicks

---

### Phase 5 — Sources & Tavily policy

**Reddit:** official API remains off/dormant; do not block health on it. Tavily already surfaces reddit.com etc. when search finds them.

---

## F) What is Tavily, and should the owner pay for more credits?

### Plain English

**Tavily** is a **paid web-search API** the scanner uses to find public pages (Reddit threads, Steam discussions, news, patch mirrors, etc.). Each search query costs **credits**. The hub does **not** browse the whole internet by itself; it asks Tavily “find stuff about Crimson Desert + this patch / this issue,” then the LLM extracts whether a result is a real player problem.

Without Tavily (and with Reddit API off), the automated discovery side of the cockpit mostly goes blind. Player reports still work.

### Current app behavior

| Setting | Typical now |
| --- | --- |
| Monthly cap in app | **Hard max 1000** (`MAX_MONTHLY_TAVILY_CREDIT_CAP` in `budget.ts` / `settings.ts`) |
| Spend rate | Often **1 credit / hourly run** → ~720/month |
| Free tier | 1000 credits/month is the free-ish envelope the product was built around |
| Headroom today | ~280 credits/month unused if staying at 1/run |

**Important:** Buying a $30 Tavily plan for ~4000 credits **does nothing** until:

1. Code/settings raise the **1000 hard cap**, and  
2. You increase **credits per run** or run more aggressive query plans.

### Would 4× credits make the website better?

| | |
| --- | --- |
| **Fixes lifecycle / contradictory badges / admin homework?** | **No** |
| **Makes the cockpit “fun” by itself?** | **No** |
| **Can improve discovery coverage** (more query angles per hour, more corroboration searches) | **Yes, modestly** — after using free headroom |
| **Recommended order** | (1) Ship Phase 1–2 data quality (2) Try **2 searches/run** inside 1000 cap for 1–2 weeks (3) If funnel shows starvation (good leads never searched), then raise cap + consider paid tier |

**Owner guidance:** Do not spend $30 hoping the product feels finished. Spend only if metrics show search starvation after Phase 1–2. Free headroom (1→2 credits/run) is the first experiment and costs $0.

---

## G) PR order on `dev`

1. LLM claim mapper + tests (validated cluster slug, sure/unsure, fallback cost gates)
2. Keyword fallback remains proposal-only + tests (`route.ts` / claim mapping helper)
3. Lifecycle pure functions + tests (`lifecycle.ts`, 7-day from `fix_claimed_at`)
4. Migration file (three columns + legacy note) — file only until owner OK
5. Wire lifecycle writes at automation-run end for all relevant non-overridden clusters
6. Admin override/clear + “Needs you” exception framing + reason strings
7. Label map + point existing dashboard/issues/claims badges at composer (minimal UI touch)
8. FPS acceptance fixture
9. Scanner/admin exception semantics (Phase 3)
10. Follow-ups if still wanted (Phase 4)
11. Optional: raise Tavily cap / per-run credits only after measurement

---

## H) Success criteria

1. Visitor understands patch situation from **existing** cockpit in one screen  
2. Zero-interaction week: instruments still show patch, claims, scanner health, ranked situations  
3. FPS-class **No fresh reports** after **7 days** public silence without dropdown
4. Normal maintainer day: **Needs you = 0**
5. Status text matches data; no official-verifier claim  
6. Default budget path stays ≤1000 Tavily until owner explicitly upgrades after evidence  
7. Healthy with Reddit API off  
8. **Screenshots still look like the same HUD** — data better, chrome familiar  

---

## I) Out of scope

- UI redesign / new visual system  
- Embeddings clustering, aggressive auto-merge  
- Report form redesign  
- Production migration apply without OK  
- Paid OpenRouter models  
- Accounts / identity beyond existing IP hash  
- “Honesty pass” phase  
- Reddit API as required dependency  

---

## J) Review disposition and owner realignment (2026-07-09)

**GLM-5.2 amendments retained:**

1. Silence clock = `fix_claimed_at`, not patch `published_at`  
2. `admin_override` so hourly composer cannot clobber admin
3. Public-only post-hotfix evidence for auto **Still happening**

**Owner realignment supersedes the old Phase 1 framing:**

1. LLM/OpenRouter is primary for claim→cluster mapping; keyword fallback is proposal-only.
2. Human labels are locked: **Open**, **Watching fix**, **No fresh reports**, **Still happening**, **Locked by you**.
3. Admin is an exception/fire-alarm surface, not the lifecycle judge by default.
4. The system re-derives all non-overridden clusters going forward; only explicit overrides remain locked.

---

## K) Confirmed owner policy knobs

| Knob | Value |
| --- | --- |
| Silence → No fresh reports | **7 days** from `fix_claimed_at` |
| UI redesign | **Forbidden** — feed existing cockpit |
| Reddit API | **Shelved** (Tavily for discovery) |
| Tavily paid upgrade | **Deferred** until headroom + Phase 1–2 |
| Phase 0 honesty | **Killed** |
| Auto `fix_claimed` | LLM-sure validated claim→cluster match only |
| Keyword routes | Backup/proposal only, never auto-write lifecycle |
| Auto `persists` | **Public** post-hotfix evidence only |
| Human labels | Locked table in Owner realignment |

---

## L) Human TL;DR

You’re not missing a soul in the screenshots — you’re missing a **closed AI-first data loop** so the cockpit’s gauges stop fighting each other, and so the owner stops being the human firmware for fix-status. Keep the HUD. Let the LLM map PA claims to issues when sure, let deterministic rules age those decisions, and call the admin only for real exceptions. Protect admin overrides. Don’t buy Tavily upgrades until free capacity and lifecycle work are used. Proud = people open this for Crimson Desert instead of five other tabs — with the dashboard they already like, telling a coherent story.

---

## M) Phase 1 execution checklist (implementer)

Ordered. Migration apply to production only with owner OK in-message.

1. **LLM claim mapper + tests** — add a claim-mapping helper beside the automation extraction/routing layer. It validates returned cluster slugs, returns `sure` or `unsure`, and falls back safely when OpenRouter is unavailable or over budget.
2. **Keyword fallback tests** — keep keyword routing available for scanner/fallback proposals, but prove keyword-only claim matches never auto-write lifecycle or set `fix_claimed_at`.
3. **Pure lifecycle + tests** — `src/lib/lifecycle.ts` + `tests/lifecycle.test.ts`: LLM-sure claim→**Watching fix**; 7 days from `fix_claimed_at`→**No fresh reports**; public evidence→**Still happening**; private-only no persists; no-claim; mid-patch link; override passthrough; clear override restores automation. Pure (no Supabase).
4. **Migration file** — `fix_claimed_at`, `admin_override`, `lifecycle_reason`; legacy non-overridden rows are re-derived by the first composer-enabled run.
5. **Write hook** — at automation-run end inside the existing cron/admin request path, load current patch claims and all relevant clusters, run claim mapping/lifecycle for every relevant non-overridden cluster, skip status writes if `admin_override`, and refresh reason when useful. Prove duplicate/near-simultaneous runs do not double-start the clock or overwrite newer lifecycle state.
6. **Admin actions/page** — `setClusterFixStatus` sets override; clear-override action; show “Needs you”, **Locked by you**, and `lifecycle_reason` in existing admin chrome. Reuse existing `adminGuard` / session checks for all privileged lifecycle mutations.
7. **Label + read path** — `FIX_STATUS_META` labels become **Open**, **Watching fix**, **No fresh reports**, **Still happening**; wire `rightNow` / issues / claims through composer primary; surgical, no delete-rewrite of helpers.
8. **FPS acceptance** — fixture 1 report / 0 public signals / LLM-sure claim → **Watching fix**; 7 days public silence → **No fresh reports**; one public post-hotfix signal → **Still happening**; zero admin clicks.

### Do not do (implementer)

- Redesign dashboard/badges/nav/graphs  
- New `fix_status` enum values  
- Auto-write lifecycle from keyword-only matches
- Auto-`persists` from private candidates  
- Production `supabase db push` without owner OK  
- Raise Tavily cap in Phase 1  
- Require Reddit API  
- Add a new queue/worker architecture for lifecycle
- Expand privileged admin mutations without existing guard/session checks
- Embeddings / auto-merge / accounts / form bloat  
- Honesty/liar framing  
- Composer writes at render time  
- Rewrite ladder/claims/playerIssueStatus from scratch  
- Touch `issue_clusters.confidence` into a fifth dialect  

### Open question (owner)

None for Phase 1 planning. The display labels, AI-first hierarchy, migration posture, and out-of-scope list are locked above.
