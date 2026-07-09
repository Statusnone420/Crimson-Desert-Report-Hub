# Crimson Desert Report Hub — Autonomy & Destination Roadmap

**Date:** 2026-07-09  
**Status:** Owner-approved roadmap; awaiting reviewing-agent pass before Phase 1 code  
**Audience:** Reviewing agent (LLM) prior to execution. Grow the idea; do not nitpick tone or bikeshed renames.  
**Branch:** `dev`  
**Mode:** Design / roadmap only — no implementation yet.  
**Authoring agent:** Grok (brainstorming after Kimi essay + owner screenshots + owner revision rounds).

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

**Build**

1. Pure `computeClusterLifecycle` (new small module or tight extension of `claims`/`patchWatch`):
   - Inputs: claim routing, post-hotfix evidence counts, last evidence timestamps, patch publish time, admin override if any
   - Outputs: `{ status, primaryLabel, detail, reasons[] }`
2. **Policy (owner-confirmed):**
   - Claim routes confidently → `fix_claimed` (auto)
   - `fix_claimed` + post-hotfix evidence > 0 → `persists` (auto)
   - `fix_claimed` + **7 days** zero post-hotfix evidence → quiet state (prefer reuse `verified_fixed` with new **semantics/labels** to avoid migration unless necessary; document semantic change)
   - No claim → do not invent quiet/fixed
3. Write on automation run end; public pages read stored status + reason
4. Admin dropdown = **override**, show computed reason
5. Composer guarantees **one primary** public story (existing badge components updated in place — same look, coherent data)

**Non-goals:** UI redesign, embeddings, follow-ups, Reddit API

**Verify:** unit tests for claim+7d silence, claim+evidence, no-claim; FPS-class fixture needs zero admin clicks; no conflicting primary labels

**Files:** `constants.ts`, `claims.ts`, `patchWatch.ts`, `queries.ts`, `automation/run.ts`, `admin/actions.ts`, `admin/page.tsx`, `components/ui.tsx` (label maps only), pages only if they assemble badges inconsistently

**Possible schema need (reviewer should check):** `fix_claimed_at` or “lifecycle_changed_at” if silence cannot be measured from patch publish time alone when claim is linked mid-patch. Prefer minimal columns.

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

1. Lifecycle pure functions + tests (7-day silence)  
2. Wire writes on scan + admin override + reason strings  
3. Point existing dashboard/issues badges at composer (minimal UI touch)  
4. Scanner/admin exception semantics  
5. Follow-ups if still wanted  
6. Optional: raise Tavily cap / per-run credits only after measurement  

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

## J) Advice for reviewing agent (grow, don’t nitpick)

**Do challenge:**

- Whether 7-day silence needs `fix_claimed_at` vs patch `published_at`  
- Auto-write vs propose when claim→cluster routing confidence is low  
- Collapsing FIX_STATUSES + ladder into one model without huge migration  
- Exact weight of follow-ups vs public signals  
- Whether Phase 2 can be entirely absorbed into Phase 1 PR if composer is the only page touch needed  

**Do not:**

- Propose a redesign of the dashboard “for clarity”  
- Re-center on admin bugtracker  
- Require Reddit API  
- Expand into embeddings in v1  
- Relitigate “liar” framing  

---

## K) Confirmed owner policy knobs

| Knob | Value |
| --- | --- |
| Silence → quiet | **7 days** |
| UI redesign | **Forbidden** — feed existing cockpit |
| Reddit API | **Shelved** (Tavily for discovery) |
| Tavily paid upgrade | **Deferred** until headroom + Phase 1–2; explain only |
| Phase 0 honesty | **Killed** |

---

## L) Human TL;DR

You’re not missing a soul in the screenshots — you’re missing a **closed data loop** so the cockpit’s gauges stop fighting each other, and so you stop being the human firmware for fix-status. Keep the HUD. Automate lifecycle (7-day quiet). Make admin an exception panel. Don’t buy Tavily upgrades until free capacity and lifecycle work are used. Proud = people open this for Crimson Desert instead of five other tabs — with the dashboard they already like, telling a coherent story.
