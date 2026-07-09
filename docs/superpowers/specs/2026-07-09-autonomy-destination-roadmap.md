# Crimson Desert Report Hub — Autonomy & Destination Roadmap

**Date:** 2026-07-09  
**Status:** Owner-approved roadmap + GLM-5.2 review amendments incorporated (2026-07-09). Ready for Phase 1 implementation after owner picks quiet badge label.  
**Audience:** Implementing agents and future reviewers.  
**Branch:** `dev`  
**Mode:** Design / roadmap — implementation not started in this commit.  
**Authoring agent:** Grok (roadmap) + GLM-5.2 (structural review, approve-with-amendments) + Grok (amendment merge).

---

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

1. **Visitor (zero reports):** Opens the existing dashboard/issues/scanner HUD instead of X/Reddit/Steam/Facebook. Leaves knowing: current patch, what’s noisy, what’s quiet after a claimed fix, what’s only a lead, official links. Graphs and meters reflect real lifecycle, not admin guesswork.
2. **Reporter (rare):** Structured report still works; system clusters it; no form bloat required for v1.
3. **Maintainer:** Override mistakes and set policy. Not daily fix-status judge. Quiet week ≠ abandoned site or homework.

### FPS acceptance story (lifecycle)

Owner reported FPS regression (1 report, 0 public signals). 1.13.01 shipped; seems fixed. Owner clicked **Verified fixed**… then “now what?”

**Desired:** System drives claim → monitor → quiet (7 days silence) or persists, with a **reason string the existing badges/panels can show**. No dropdown required.

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

1. **Phase 1 — Lifecycle engine + status composer** (data truth)  
2. **Phase 2 — Feed the cockpit** (wire better data into **existing** dashboard/issues/scanner instruments; no redesign)  
3. **Phase 3 — Maintainer exceptions only**  
4. **Phase 4 — Smart follow-ups**  
5. **Phase 5 — Tavily-centric sources; Reddit API shelved; budget only if measured starvation**

---

## E) Phases

### Phase 1 — Lifecycle engine + status composer

**Pain:** FPS dropdown / “now what?”

#### Required schema (minimal migration — file only until owner OK to apply)

`issue_clusters` today has **no** `fix_claimed_at` / override bit (`schema.sql`). Silence cannot safely use patch `published_at` alone (claim may link mid-patch → false immediate quiet).

| Column | Type | Purpose |
| --- | --- | --- |
| `fix_claimed_at` | `timestamptz null` | Clock start: first time lifecycle commits a claim→cluster match at **high** confidence |
| `admin_override` | `boolean not null default false` | Composer must not clobber admin on every hourly run |
| `lifecycle_reason` | `text null` | Human-readable why status is what it is (also written when overridden, so admin sees “system would say…”) |

No new `fix_status` enum values. Reuse `verified_fixed` for quiet-after-claim **semantics**. **Label must change** in `ui.tsx` `FIX_STATUS_META` (today: “Verified fixed”) — owner picks display string (open question below).

Legacy rows: first composer run re-derives all non-overridden clusters; document + optional one-time reset of pre-Phase-1 `verified_fixed` so old “I clicked it” meaning does not linger.

#### Router confidence (required before any auto-write of `fix_claimed`)

`routeToWatchlistCluster` (`route.ts`) today returns `RoutableCluster | null` only — **no confidence**. Keyword patterns are presence-based and **negation-blind** (`/\bfps\b/i` matches “no fps issues”). Roadmap phrase “routes confidently” cannot be implemented without this change.

| Match kind | Confidence | Auto-write `fix_status = fix_claimed`? | Set `fix_claimed_at`? |
| --- | --- | --- | --- |
| Validated LLM slug | **high** | Yes | Yes (on first commit) |
| Keyword regex | **medium** | **No** — admin **proposal** only | **No** (clock must not start until high commit) |
| No match | null | No | No |

Keyword stays **medium forever** (never high) so negation-blind false positives cannot manufacture green/amber lifecycle lies. Optional later: negation windows in regex — not required if medium never auto-writes.

#### Lifecycle policy (owner + review)

| Rule | Behavior |
| --- | --- |
| High-confidence claim match | Auto `fix_claimed`; set `fix_claimed_at` if null |
| Medium-confidence claim match | Do **not** change `fix_status`; surface proposal in admin with reason |
| `fix_claimed` + **public** post-hotfix evidence > 0 | Auto `persists` |
| `fix_claimed` + **7 days** after `fix_claimed_at` + zero **public** post-hotfix evidence | Auto quiet (`verified_fixed` value, new label) |
| Private/candidate-only post-hotfix noise | Does **not** flip `persists` (align with `promote.ts` public gate) |
| No claim | Do not invent quiet/fixed |
| `admin_override = true` | Skip status writes; still refresh `lifecycle_reason` with what system would compute |
| Clear override admin action | Re-enable composer control |

**Public post-hotfix evidence** = counts already used for dispute/display, but gated to signals with `public_status = 'public'` (not private candidates). Prevents one scrapy private hit from crimson-flipping a cluster.

#### Build

1. Pure `src/lib/lifecycle.ts` — `computeClusterLifecycle(input) → { status, primaryLabel, detail, reasons[] }`  
   Inputs: claim match + confidence tier, `fix_claimed_at`, public post-hotfix evidence count, `last_signal_at`, patch metadata (context only, **not** silence clock), `admin_override`.  
   **Pure on read** — no Supabase import. **Write only** inside automation run (after/near `refreshClusterStats` in `run.ts`).
2. Extend `routeToWatchlistCluster` return type with confidence; tests for high/medium/null.
3. Migration file for three columns + legacy reconciliation note.
4. Run hook writes `fix_status` / `fix_claimed_at` / `lifecycle_reason` when not overridden.
5. `setClusterFixStatus` sets `admin_override = true` + reason; add clear-override action; admin UI shows computed reason in **existing** detail slots.
6. Label map: `verified_fixed` → owner-approved quiet wording (not “Verified fixed”).
7. Read path: `rightNow.ts`, issues page, claims display consume composer primary story — do **not** delete `playerIssueStatus` / `evidenceLadder` / `assessClaims`; route through composer surgically.
8. Leave `issue_clusters.confidence` alone unless proven display-only and needed — do not create a fifth dialect.

**Non-goals:** UI redesign, embeddings, follow-ups, Reddit API, Tavily cap raise, production `db push` without owner OK.

**Verify:**  
- Unit tests: claim+7d silence from `fix_claimed_at` (not patch publish); claim+public evidence→persists; private-only evidence does not→persists; no-claim; mid-patch claim link; override passthrough; keyword never auto-writes.  
- FPS fixture: 1 report, 0 public signals, high-confidence claim → monitoring then quiet at 7d with reason; zero admin clicks.  
- No conflicting primary labels on one card.

**Files:** `lifecycle.ts` (new), `route.ts`, `run.ts`, `claims.ts`, `patchWatch.ts`, `rightNow.ts`, `queries.ts`, `admin/actions.ts`, `admin/page.tsx`, `components/ui.tsx` (label + reason only), migration under `supabase/migrations/`, tests listed in §M checklist.

---

### Phase 2 — Feed the cockpit (NOT reinvent the UI)

**Pain:** Instruments look cool but data is thin, conflicting, or admin-stale — so the HUD feels fragile.

**Build (data/wiring, preserve layout)**

- Ensure Right Now observations, meters, sparklines, “top issues,” claimed-fix panels, watchlist cards all call the **same** lifecycle/status composer
- Show **reason subtitles** where UI already has detail lines (e.g. “No new signals for 7d since claim matched …”) — fill existing text slots
- Graphs: if 30-day activity chart is empty-looking, that may be real sparsity — do not fake points; ensure patch markers / current-patch framing already in chart are correct
- Issues page: same cards, better status truth; quiet items can sort lower using existing patterns (no new visual system)
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
- “Not seeing it” cannot alone force quiet
- Existing issue card CTA patterns preferred over new page types

**Verify:** flood resistance; quiet never depends only on No-clicks

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

1. Router confidence tier + tests (`route.ts`)  
2. Lifecycle pure functions + tests (`lifecycle.ts`, 7-day from `fix_claimed_at`)  
3. Migration file (three columns + legacy note) — local/preview only until owner OK  
4. Wire writes on scan + admin override/clear + reason strings  
5. Label map + point existing dashboard/issues badges at composer (minimal UI touch)  
6. FPS acceptance fixture  
7. Scanner/admin exception semantics (Phase 3)  
8. Follow-ups if still wanted (Phase 4)  
9. Optional: raise Tavily cap / per-run credits only after measurement  

---

## H) Success criteria

1. Visitor understands patch situation from **existing** cockpit in one screen  
2. Zero-interaction week: instruments still show patch, claims, scanner health, ranked situations  
3. FPS-class quiet after **7 days** silence without dropdown  
4. Normal maintainer day: zero required actions  
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

## J) Review disposition (GLM-5.2, 2026-07-09)

**Verdict accepted:** Approve with amendments. Strategy spine confirmed. Three load-bearing holes closed in §E Phase 1:

1. Silence clock = `fix_claimed_at`, not patch `published_at`  
2. Router confidence tier; auto-write only **high**  
3. `admin_override` so hourly composer cannot clobber admin  

**Grok refinement on medium confidence:** Do **not** set `fix_claimed_at` on medium proposals (GLM suggested writing the timestamp without status). Clock starts only when high-confidence `fix_claimed` is committed — otherwise silence can expire before a real claim is ever public.

**Still open for owner:** exact display label replacing “Verified fixed” (enum value stays `verified_fixed`).

---

## K) Confirmed owner policy knobs

| Knob | Value |
| --- | --- |
| Silence → quiet | **7 days** from `fix_claimed_at` |
| UI redesign | **Forbidden** — feed existing cockpit |
| Reddit API | **Shelved** (Tavily for discovery) |
| Tavily paid upgrade | **Deferred** until headroom + Phase 1–2 |
| Phase 0 honesty | **Killed** |
| Auto `fix_claimed` | **High confidence only** (LLM slug) |
| Keyword routes | **Medium** — propose only, never auto-write |
| Auto `persists` | **Public** post-hotfix evidence only |
| Quiet badge label | **Owner TBD** (see open question) |

---

## L) Human TL;DR

You’re not missing a soul in the screenshots — you’re missing a **closed data loop** so the cockpit’s gauges stop fighting each other, and so you stop being the human firmware for fix-status. Keep the HUD. Automate lifecycle (7-day quiet from claim-link time). Auto-write only high-confidence claims; keyword = proposal. Protect admin overrides. Don’t buy Tavily upgrades until free capacity and lifecycle work are used. Proud = people open this for Crimson Desert instead of five other tabs — with the dashboard they already like, telling a coherent story.

---

## M) Phase 1 execution checklist (implementer)

Ordered. Migration apply to production only with owner OK in-message.

1. **Router confidence + tests** — `route.ts`: return `{ cluster, confidence: "high" | "medium" | null }`; LLM slug = high; keyword = medium; null = none. Keyword never high.  
2. **Pure lifecycle + tests** — `src/lib/lifecycle.ts` + `tests/lifecycle.test.ts`: claim+7d from `fix_claimed_at`→quiet; claim+public evidence→persists; private-only no persists; no-claim; mid-patch link; override passthrough. Pure (no Supabase).  
3. **Migration file** — `fix_claimed_at`, `admin_override`, `lifecycle_reason`; legacy `verified_fixed` reconciliation note.  
4. **Write hook** — after `refreshClusterStats` in `run.ts`; skip status write if `admin_override`; always refresh reason when useful.  
5. **Admin actions** — `setClusterFixStatus` sets override; clear-override action; show `lifecycle_reason` in existing admin chrome.  
6. **Label + read path** — `FIX_STATUS_META` quiet label; wire `rightNow` / issues / claims through composer primary; surgical, no delete-rewrite of helpers.  
7. **FPS acceptance** — fixture 1 report / 0 public signals / high claim → monitoring → quiet at 7d; one public post-hotfix → persists; zero admin clicks.

### Do not do (implementer)

- Redesign dashboard/badges/nav/graphs  
- New `fix_status` enum values  
- Auto-write `fix_claimed` on keyword matches  
- Auto-`persists` from private candidates  
- Production `supabase db push` without owner OK  
- Raise Tavily cap in Phase 1  
- Require Reddit API  
- Embeddings / auto-merge / accounts / form bloat  
- Honesty/liar framing  
- Composer writes at render time  
- Rewrite ladder/claims/playerIssueStatus from scratch  
- Touch `issue_clusters.confidence` into a fifth dialect  

### Open question (owner)

Replacement **display** label for reused `verified_fixed` enum, e.g.:

- “Quiet after claim”  
- “No new signals (7d)”  
- Owner’s pick  

Enum reuse is safe; only the string kills the “Verified fixed + remains unverified” contradiction at the badge.
