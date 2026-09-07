# Delivery map (proposed Slices B–D)

**This document is a proposal. It is not authorization to start Slice B, C, or D.** No application code, CSS, migration, hosted SQL, cadence/budget/model change, deploy, or merge to `main` follows from it.

## Provenance

Slice A agent prompts did not include a numbered B–D table. They did include an **owner brief**, exclusive-file stops, and “do not start Slice B–D.”

This map is reconstructed from:

1. Owner brief excerpts in the Slice A agent prompts (quoted below).
2. Spec “later slice” notes (pairing store, Overview composition, scanner honesty, brief RPC).
3. Concept coverage: Overview + Report/Claim Review only; Videos / Scanner / Dossiers are inert nav.
4. Hard constraints that every Slice A agent was given.

Historical Phase 4 docs (`docs/PHASE-4-TARGET.md`, `docs/PHASE-4-ADMIN-INVENTORY.md`) are **search aids and prior contracts**, not this overhaul’s implementation plan. They must not override [`spec/`](spec/) or [`DESIGN.md`](../../DESIGN.md).

## Owner brief (verbatim fragments)

From the Slice A spec prompt:

> Goal: Operate mode — understand situation and complete tasks. Quick check + focused session. Desktop currently feels like a test (oversized intros, repeated forms). Light-mode readability matters. Public site = quality bar, not article spacing copy.
>
> Recurring claim-match problem (Sep 7): keyword Needs review flags; Lock is wrong routine tool; need durable per-proposal confirm/reject/later/history/undo.
>
> Scanner meaning fixes required for AI health correlation, run status vs AI health, awaiting/candidates/radar labels, time windows.
>
> Acceptance: attention counts → identifiable items; reject keeps out of pending across scans; no routine claim action creates global lock or certifies fix; keyboard; themes; zero/unavailable/failed-save; video #94 behaviors intact; public unchanged.

From the concept prompt:

> Operate mode. Quick check + focused session. Fix “taking a test” desktop. Light-mode readability. Claim review must show exact patch note text (not generic reason). Lock is NOT the reject button. Attention counts must not masquerade background inventory as chores.

Frozen in every prompt: no production access; no paid calls; no scanner runs; no cadence/budget/model/circuit change; baseline **2h / 3 searches per run**; do not touch `admin/redesign-plan`; preserve #95 diagnostics and public-output boundaries.

## Slice A (this folder) — stop here until the owner says otherwise

| In | Out |
| --- | --- |
| Spec contracts for all operator surfaces | Application routes, shared CSS, production chrome |
| Interactive concept for Overview + Report/Claim Review | Concept HTML for Videos / Scanner / Dossiers |
| Invented, labeled sample data | Production reports, private exports, live admin captures |
| Owner-decision lists | Implementation of Confirm / Not the same issue / Decide later |

**Slice A stop gate:** owner visual/behavior review of this PR (and, when it exists, the independent review). Do not treat merge of this docs PR as a green light for B–D.

## Proposed later slices (not started)

Prefer spec wording for actions and counts. Use the concept as the Overview + Review visual reference, not as a third contract.

### Slice B — Durable claim pairing + Report/Claim Review desk

**Why this is first:** the Sep 7 problem and the acceptance line “reject keeps out of pending across scans” need a store. The concept already shows the desk. Overview can *name* pairings only after the ledger exists (until then, rolling-deploy honesty is “unavailable,” not zero — see the claim-review contract).

In:

- Local-only migration + RPCs for pairing identity, state (`pending` / `later` / `confirmed` / `rejected`), revision, audit, undo. **No hosted `db push` without a separate, explicit owner authorization in that message.**
- Operator actions with **spec labels**: Confirm pairing; Not the same issue (required reason); Decide later; history; undo. Lock stays exceptional, not the reject control.
- Report review UI for flagged reports **and** pairing cards: exact official claim text, source, patch, issue context. Failed save keeps the item and the typed excerpt on screen.
- Lifecycle consults the store when present; pre-migration path unchanged (`claim-review-contract.md` rolling-deploy table).
- Tests listed in the claim-review contract (Confirm does not set `admin_override` or `verified_fixed`; Reject survives a second scan; missing schema is unavailable).

Out:

- Cadence, budgets, models, circuit, search-depth retune.
- Visibility overrides, video inbox, scanner teach, dossier compile — reuse as specified; do not redesign those desks here unless a tiny honesty fix is required for the Review page itself.
- Confirming a pairing onto a **different** cluster in one step, or mapping onto private clusters, unless the owner has answered [`spec/open-decisions.md`](spec/open-decisions.md).

**Slice B stop gates:** owner answers data decisions 1–3; local `npm run db:start` then `npm run db:reset` on the proposed SQL before the SQL PR is reviewable; preview/dry-run pairing writes stay behind `assertProductionWriteAllowed`; public pages still show claims as claims.

### Slice C — Overview attention + Scanner honesty (copy and composition)

**Why after B:** Overview’s intended owner-decision row includes pending pairings. Scanner honesty is spec-driven; there is **no** Scanner concept HTML in Slice A.

In:

- Overview: two named families — **owner decisions** vs **operational incidents** — each item identifiable, each with a next-step link. Inventory (awaiting, yield, weekly composition, approved/spam totals) stays off Needs you / Do now.
- AI health + OpenRouter cost-safety pause as **one** item when they are co-symptoms; Completed / Completed with limits is never “healthy AI” without validated `llmSucceeded`.
- Authenticated Scanner relabels: Awaiting = private leads lacking corroboration; candidates reviewed = screening events; radar yield = retained-lead share, not accuracy. Named time windows (24h vs rolling 7d vs ISO week still-tracked).
- Quiet Overview only when **both** families are known empty. Unknown reads use `—` / unavailable, never a green zero.
- Keep inspect-only on Overview. Cadence/budget UI may remain visible on Scanner; **do not change the saved 2h / 3-search baseline.**

Out:

- New scanner policy recommendations (Hourly, 1 search/run) as the operating target.
- Folding Videos into the Review count, or folding the teach desk into owner decisions.
- A new Scanner visual concept unless the owner asks for one after seeing Overview/Review.

**Slice C stop gates:** metrics contract fixtures in `metrics-attention-contract.md` §6 must have named identities; public Observatory path unchanged; `#95` diagnostics stay private run facts.

### Slice D — Remaining surfaces and brief alignment

In:

- Videos (`/admin/videos`): keep the dedicated inbox; preserve #94 (manual add; Approve = private later-PR draft; Archive/Restore; stale revision; missing schema = unavailable). Named video counts, not mixed into Review.
- Dossiers: on demand; missing `?run=` id reads as missing, not “no runs yet”; opt-in AI warning stays.
- `owner_attention_brief` population follows pending pairings once the store is applied; JSON **keys stay** `unsureClaimMatches` / `needsYou`. Document the brief vs `/admin` disagreement window; do not treat brief zeros as `/admin` zeros.
- Optional visual follow-through for Videos / Scanner / Dossiers, only if Slice A’s two-desk concept is accepted.

Out:

- Auto-publish Watch, YouTube crawl, Reddit API, raising Tavily/OpenRouter caps, circuit-reset from the overhaul.
- Export CSV growing into a pairing dump (report export stays 22 fields unless the owner later authorizes a change).

**Slice D stop gates:** #94 privacy/brief tests still pass; dossier AI remains fail-open to deterministic; no second silent sender of private titles/repro/URLs.

## Risks

| Risk | Why it matters | Mitigation in later slices |
| --- | --- | --- |
| Spec vs concept labels | Implementers ship “Confirm this is the same” / “Not the same” / “Do now” as if they were the contract | Prefer spec for behavior; list clashes in the handoff; owner still picks visual chrome |
| Concept has no reject-reason field | Spec requires 3–500 characters on Not the same issue; without it, suppression and audit are incomplete | Do not drop the reason to match the concept |
| Pairing store on a rolling deploy | New app + old schema can green-wash “0 pairings” or write into a missing relation | Fall back only for a narrowly identified missing schema object; writes throw; counts unavailable |
| Brief RPC vs `/admin` window | Old `owner_attention_brief` still counts `Needs review:` strings | Keep JSON keys; document disagreement; do not treat brief zeros as desk zeros |
| Approve then excerpt insert fails | Today approval can commit while the row leaves the queue | Failed-save UI must say what already committed; do not hide the split |
| Inventory counted as chores | Awaiting, yield, screening events, approved/spam look like Needs you | Metrics contract families; concept already separates inventory on Overview |
| AI row in concept “Do now” | Spec: AI health is an **operational incident**, not an owner-decision numeral | Keep AI named, but in the operational family; do not mix it into the Review count |
| Scanner/Videos/Dossiers unconcepted | Slice C/D implementers may copy Phase 4 mockups or newspaper spacing | Spec `surface-notes.md` is the constraint; Phase 4 is historical |
| Independent review missing | This PR assembled before `slice-a/admin-review` existed | Fold review files later or link the review PR; do not rubber-stamp |
| Historical `admin/redesign-plan` | Stale local branch, out of bounds | Do not fetch, push, delete, or use it as baseline |
| Paid scan / hosted SQL by accident | Bake-off and `db push` are easy to “just run” | Later PRs stay local-first; hosted apply needs explicit current-message authorization |

## Stop gates (do not pass without owner)

1. **Slice A not accepted** — no B–D implementation PRs.
2. **Open data decisions unanswered** — no pairing write semantics that assume yes/no on other-cluster Confirm, private clusters, or Later-blocks-sure.
3. **No hosted schema apply** — create migration files; prove with local `db:reset`; never `supabase db push` or MCP Apply Migration against production unless the owner authorizes it in that message.
4. **No cadence/budget/model/circuit change** — 2h / 3 searches remain the operating baseline.
5. **Public Observatory stays public** — anonymous `/scanner` still renders the Observatory; no login bounce.
6. **Missing ≠ empty** — permission and other DB failures fail or surface; only a narrowly identified missing schema object may fall back.
7. **No third design** — if spec and a later visual disagree on labels/actions, stop and ask; do not silently invent a compromise control.
8. **No production reports in concepts or PRs** — invented samples stay labeled.

## Explicit non-authorization

Opening or merging this Slice A docs PR does **not** start B–D, does **not** schedule a scanner run, does **not** apply SQL, and does **not** change production policy.
