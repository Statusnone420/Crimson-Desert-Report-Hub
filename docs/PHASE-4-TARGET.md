# Phase 4 target contract — operator console

Stage 1 deliverable. The mockup under `mockups/phase4/` renders this contract; the
inventory (`docs/PHASE-4-ADMIN-INVENTORY.md`, 327 entries) is the
behavior-preservation manifest behind it — its risk-register and gap numbers are
the IDs this document cites. This document is the target; the inventory is the
floor.

## Goal

The console answers five questions immediately, on every page:

1. **Does anything need me?** — one number at the top of each page, green only
   when every source read succeeded and the known count is zero. Unknown/error
   is never rendered as green zero or "All clear."
2. **What is the safest next action?** — one visually primary control per region.
3. **What will this control change?** — a scope line states the write before submit.
4. **Can I undo it?** — an available recovery sits adjacent; partial or absent
   reversal is stated plainly.
5. **Where is history?** — a Records band on every page, collapsed, counted honestly.

## Information architecture

Three task boundaries, unchanged: **Report Review** (`/admin`), **Scanner Monitor**
(`/scanner`, operator branch), **Dossiers** (`/admin/compile`; nav label changes,
route does not). Every page uses the same skeleton:

1. Status and required work — stat band + the page's only required items, visible.
2. Primary task — flagged queue / action inbox / compile form.
3. Optional work — teaching desk etc., collapsed by default.
4. Records and history — collapsed ledgers with honest window labels; use
   `showing X of Y` only when the live read supplies a true total.
5. Advanced / break-glass — last band, amber-edged panels, friction intact.

Scanner Monitor adds a **persistent local section nav** (sticky rail on desktop,
sticky chip row on mobile): Status · Teach · Records · Context lanes · Lessons ·
Scan history · Cadence & budget, each with its live count or named query window.

**Navigation vs utilities:** the top bar's left register holds the three page
destinations only. Export CSV and Sign out move to a visually distinct utility
cluster on the right — both capabilities preserved on every OperatorShell page.

**No endless lists.** Every list states its window against the true total when
the live read supplies one (flagged: `oldest first · showing N of M`). The
automatic-records read is an uncounted 20-row window, the teaching desk is an
uncounted 30-row eligible window, and scan history is the newest 10 runs. Those
surfaces name their hard windows without inventing a total or a
browse-beyond-window control. The radar's separately computed tracked-lead
total is not the denominator for the automatic-records query.

Active lessons is a recovery-critical exception. Before the Scanner Monitor
slice can ship, both active-rule reads — the operator ledger and scanner
enforcement — must use stable `created_at DESC, id DESC` pagination (or an
equivalent unique cursor) beyond the hosted PostgREST row cap, and the operator
read must supply an exact total. A tied-`created_at` page-boundary regression
must prove that no rule is skipped or duplicated. Only then may the UI say
`showing N of M`, filter the loaded result, and offer show-more. The current
uncounted `.select()` calls and the test that merely proves there is no literal
`limit(50)` are not evidence that every active rule was returned.

That ledger can recover only decisions whose rules remain active, unrevoked,
and unexpired. Superseding or expiring a rule removes it from Active lessons
without undoing its decision or restoring its target. If the affected
observation is also outside the current-patch 40-row card window, no rendered
recovery surface exists. Phase 4 must not call those historical decisions
recoverable; a decision-history recovery surface is a separate data/UI
contract.

**Dossier truthfulness.** The current compiler issues tracker-wide, unfiltered
reads for approved reports, public scanner signals, and issue clusters, plus a
newest-1,000 read for approved excerpts. The generated counts describe the rows
those reads return; `currentPatch.version` labels the output but does not filter
them. Phase 4 must call this a tracker-wide snapshot with current-patch context,
never patch-scoped evidence or an independently counted all-storage total.
Dossier history remains the newest 10 runs. A saved `?run=<id>` URL still opens
directly, but older runs are not discoverable from the page.

**Dossier AI privacy (locked).** `Draft with AI` is an explicit opt-in that
sends the complete generated dossier to OpenRouter, including private
approved-report reproduction steps and evidence URLs plus public source URLs.
Adjacent accessible copy names those fields before submit and states that the
request requires deny-collection and zero-data-retention routing. AI rewrites
prose only; a provider failure falls back to the deterministic dossier.
Before the Dossiers slice is complete, focused tests must pin the exact user
message and provider routing, prove unchecked or disabled AI makes no provider
request, and preserve deterministic fallback without weakening the disclosure.

## Control grammar

Seven classes; same intent uses the same class and wording on every page.

| Class | Treatment | Members (examples) |
|---|---|---|
| Primary | solid crimson, one per region | Approve, Compile now, Run capped scan now |
| Secondary | ink outline | Keep as relevant, Lock, Save settings, Test scan |
| Quiet | text-only | Show more, Browse, Details, Inspect source |
| Destructive | crimson outline **+ scope line stating the write** | Reject, Spam, Reject and teach, Remove bad lead |
| Recovery/Undo | `↩` glyph + mono label for full reversal; partial controls name the narrower effect, adjacent to what changes | Undo, Revoke rule, Forget lesson, Clear lock, Reset to automatic |
| Break-glass | amber-edged raised panel, mono warrant, existing deliberate friction preserved | visibility override create, current patch override |
| Cost-incurring | mono `SPENDS CREDITS` chip beside the button + disclosure that dry-run also spends | both scan buttons, Keep as relevant (LLM call) |

Required on every mutation in the redesigned surface: a disabled button with
`aria-busy="true"` and visible pending text using the existing `pendingText`
pattern, a scope disclosure that names the write, and risk never carried by
color alone (every color is paired with a text badge or glyph). CSS
`pointer-events` is not a disabled state. These mockups do not claim inline
recovery, retained form input, or success confirmations from actions that
currently throw. The global admin error surface remains a named deferral below.

**Reversal language (locked 2026-07-25).** The `↩` glyph and the word
"Undo" are reserved for full reversal. Partial recovery names what it actually
does. A KEEP lesson's control reads **Forget lesson** with **rescued lead
stays** adjacent (accessible text, not a tooltip), and its consequence copy
states all three limits: forgetting never restores the candidate, never deletes
the rescued lead, and never refunds spend.

The Active lessons control for a BLOCK rule reads **Revoke rule**, not Undo.
Revocation always stops that rule's future matching. It returns an unrescued,
unexpired candidate to the teaching desk and restores an observation, but a
removed source lead is different: a clustered lead is recomputed under normal
visibility rules, while an unclustered lead stays hidden. Revoking a newer rule
also does not reactivate an older same-scope rule that it superseded. Full
source-lead restoration and superseded-rule reinstatement require a separate
RPC/data contract; Phase 4 preserves the current write and states these limits
instead of promising a reversal that does not exist.

Cost language is likewise fixed: both scan runs "can spend real search credits
and paid LLM calls; that spend counts against the monthly caps and is recorded
in the run ledger, progress, and intent. A test run suppresses scanner-content
persistence and public-content changes, but still records its own run and can
mark a stale running scan failed. Neither run is reversible"; Keep as relevant
"spends an LLM call, creates a rescued lead, and records a scanner lesson." The
signal is inserted private, then normal evidence and override rules recompute
its final visibility. Always say "creates"; never imply that the lesson itself
publishes the lead. The same consequence, pending, success, failure, disabled,
and reversal wording applies to equivalent controls on every page.

Degraded state, pre-migration: when scanner learning is unavailable
(`feedbackLearningAvailable` false because the feedback-rules relation read
hits the existing narrowly identified missing-relation fallback), Keep stays
available — that asymmetry is deliberate — but the rescue records no lesson.
Its scope line must then read: "Keep spends an LLM call and creates a rescued
lead; normal evidence rules determine its visibility. Scanner learning is
unavailable until the schema update, so this rescue records no lesson to
forget." Never promise a lesson, or a Forget path, that the degraded state
cannot produce. A missing decision RPC while the relation is readable is
discovered only on submit, not by `feedbackLearningAvailable`. Reject and teach
throws the server-action error and leaves the candidate unchanged; Keep
completes the rescue and marks it rescued but records no lesson. Stage 1 must
not present this as a pre-submit disabled state or promise a lesson or Forget
path.

The current-patch override is the explicit break-glass payload exception.
Preserve its existing `patch_version`-only input and validation; do not invent a
reason, acknowledgement, or manual Undo. Its recovery is the next successful
official patch sync taking control back; the synthetic manual row adds no
official fix claims. The visibility-override creator separately keeps its
required reason and acknowledgement and its one-click Reset to automatic.

**Export CSV (locked).** The utility control reads `Export CSV…` and opens an
inline confirmation group before downloading every report's fixed 22-field
review export. It names the private free text, PERS IDs, evidence URLs, and all
moderation states that leave the system. It also names the deliberate
exclusions: `submitter_ip_hash` and `duplicate_fingerprint` never enter the CSV.
Every closed trigger exposes `aria-expanded="false"` and `aria-controls`; the
open state sets `aria-expanded="true"`. Download, Cancel, and Escape close the
group and return focus to the trigger.

Formula-safe serialization is a Stage 2 prerequisite, not behavior to preserve.
Before this control is complete, player-controlled string cells whose first
non-whitespace character is `=`, `+`, `-`, or `@` (or whose first character is
a tab or carriage return) must be neutralized before ordinary CSV quoting.
The route must also page deterministically by `created_at` then `id` beyond the
hosted PostgREST row cap; its current single select cannot support the word
"every." Focused serializer tests and authenticated export-route tests spanning
more than one API page must pin the formula defense, complete ordered row set,
fixed column set, and two hash exclusions.

## Parity dispositions

**Default disposition: Preserve.** Every inventory entry not named below keeps
its write payload, hidden fields, guard order, validation text, revalidation
set, conditional/degraded states, and deliberate friction, verbatim. The
read-truth, dossier-AI privacy disclosure, active-rule pagination,
admin-cluster pagination, and CSV safety/completeness prerequisites named below
are explicit exceptions.
Presentation may change; behavior may not. Specifically preserved
presentation-sensitive items:
the moderation cluster select stays inside the same form as all three decision
buttons with a scope line stating that Reject/Spam also write it (risk #8); the
scanner policy stays ONE form, visually sectioned (risks #4/#5); the lifecycle
select still omits `acknowledged` (risk #9); Keep-as-relevant stays outside the
feedback-learning gate (risk #11); the Steam-review teaching refusal keeps its
explanatory sentence (risk #31); both Undo surfaces for observation decisions
remain for observations inside the current-patch 40-row desk, while Active
lessons remains the recovery path only while a decision's rule is active,
unrevoked, and unexpired outside that window or after a patch change (risks
#17/#29). Superseded or expired decisions outside the card window have no
rendered recovery. Both teaching forms remain distinct (risk #28); the
visibility-override browser keeps its search gate, result cap, reason, and
acknowledgement (risks #15/#16).

**Consolidate:** Export CSV + Sign out → utility cluster (risks #12/#24; every
OperatorShell page, capability unchanged). COMPILE DOSSIER label → Dossiers.
Scanner sections → one page + local section nav (no route changes).

**Retire as verified dead — settled 2026-07-25, delete during Phase 4
implementation:** `/admin/source-monitor`
stub and the seven `revalidatePath("/admin/source-monitor")` calls (risk #20,
gap #13); `runRedditMonitor` (risk #23); `RejectedArchive` + the
`rescueRejectedCandidate` compat action (risk #21; its unit and auth tests
retire with it); `setAutomationPaused` (risk #22, unwired duplicate); the hidden
`modelPreset` input and unreachable `paused` form branch (risk #26).

**In scope — settled 2026-07-25:** safe page return after re-auth (gap #3).
A signed-out visit to `/admin` or `/admin/compile` carries that fixed pathname
as an encoded `?from=` value to the full-page `/admin/login` form. After a
successful sign-in, that form accepts `from` only when it exactly equals
`/admin`, `/admin/compile`, or `/scanner`; every other value falls back to
`/admin`. This preserves no query string or hash and performs no URL
canonicalization: absent, absolute, protocol-relative, traversal,
query-bearing, and other non-exact values are not return destinations.
`/scanner` keeps its anonymous public-view behavior rather than redirecting
through the page guard. Server-action guards and the public footer sign-in do
not carry a return destination.

**In scope — required truth and safety prerequisites:**

- Report Review may render green zero or "All clear" only after the flagged,
  approved-count, pending-count, and spam-count reads all succeed. Each real
  Supabase error must throw into the existing admin error boundary rather than
  become `[]`/`0`; focused tests must pin all four failures. The oldest-first
  50-row pending window and its separate exact total remain unchanged.
- Scanner Monitor may render a green zero or "Nothing requires intervention."
  only while the radar is connected and both automation-run reads that feed
  radar health succeeded. The existing failed-read fallback
  (`connected=false`, `runs7d.failed=0`) must become an explicit unavailable or
  unknown scanner-health item instead of disappearing the radar band and
  clearing the Action inbox. Focused tests must force each run-read failure and
  prove that neither path can produce the clear headline.
- Before Report Review is complete, both the current-column and rolling-deploy
  legacy projections in `readAdminClusters` must page beyond the hosted row cap
  in stable `title`, `id` order. A multipage regression must place both a
  forced-visibility row and an engine-owned lifecycle exception after page one
  and prove that Reset to automatic remains reachable and Needs you cannot
  render a false green zero.
- Before the Scanner Monitor slice calls Active lessons complete, both
  active-feedback-rule consumers (`getAutomationAdminData` and scanner
  enforcement) must page by `created_at DESC, id DESC` (or an equivalent unique
  cursor) past the hosted row cap, and the admin read must return an exact
  count. A regression with tied `created_at` values across the page boundary
  must prove that no enforced rule loses its ledger recovery, no rule is
  duplicated, and no older rule silently stops being enforced.
- Before the Export CSV slice is complete, implement the formula defense,
  deterministic multi-page read, and route allowlist tests specified in the
  locked export contract above. Do not widen the 22-field allowlist to satisfy
  the old "complete table" wording.

**Defer with named reason:** self-expiring rules via `expires_at` (risk #25 — a
real feature, not a redesign); admin error-boundary chrome (gap #1 — failure
surface must not change silently in a UI pass); rescue-vs-scan budget split
(gap #10 — server contract; the mockup copy states the split honestly instead);
robots `index,follow` on admin routes (gap #14 — separate hardening PR); true
dossier patch scoping and stored run scope (the current schema has no patch
scope for dossier runs); dossier history totals and browsing beyond the newest
10 (server read contract); automatic-record totals/browsing beyond the newest
20, teaching-candidate totals/browsing beyond the newest 30 eligible rows, and
scan-history totals/browsing beyond the newest 10 runs (server read contracts);
context-lane browsing beyond the 40 most recent current-patch observations
(server read contract; the paginated Active lessons prerequisite preserves a
rule-revocation path only while a decision's rule remains active, unrevoked,
and unexpired outside that card window); decision-history recovery for
superseded or expired decisions whose target is outside the card window
(server/UI contract);
full restoration of an unclustered source lead after **Revoke rule**, and
reactivation of an older same-scope rule after its replacement is revoked
(RPC/data-contract changes; the redesigned ledger discloses both limits).

The admin error-boundary deferral includes the partial `moderateReport` failure:
approval and its visibility trigger can commit before an excerpt insert throws,
but the current route error replaces the queue, loses the excerpt text, and
incorrectly claims nothing was published or counted. The pending-only queue has
no rendered re-open or excerpt-retry path. The exported action is not a safe
substitute: it has no pending-status guard and a repeated approval can append a
duplicate excerpt. Phase 4 does not mock an inline retry or retained-input state
until that transaction and recovery contract is designed separately.

**If better UX would need a server or database contract change, stop and flag it.**

## Acceptance (Stage 2 gate)

Required work identifiable in 10 seconds; one obvious next action per page;
history never dominates daily work; every scanner section reachable from the nav
without full-page scrolling; equivalent controls identical across pages;
different-risk controls visibly distinct without relying on color; explicit
keyboard order, visible focus, labels, disclosure state, and live status
feedback; desktop primary, every control operable at 390px; every active scanner
rule returned by the required paginated read has an honest Undo, Revoke rule, or
Forget lesson path; every reversible state represented on the redesigned
surface has a reachable Undo/Reset, while the named superseded/expired
decision-history recovery deferral remains outside this gate; irreversible and
partial controls disclose what cannot be restored; and all currently rendered
recovery surfaces are preserved. Green zero is impossible
after a failed source read, export formulas are neutralized without widening
the private column allowlist, the AI dossier opt-in discloses and pins every
private field sent to OpenRouter plus its deny-collection/ZDR routing, public
and operator scanner data boundaries are never merged, and all parity
dispositions are honored against the inventory IDs.
