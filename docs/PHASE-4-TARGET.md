# Phase 4 target contract — operator console

Stage 1 deliverable. The mockup under `mockups/phase4/` renders this contract; the
inventory (`docs/PHASE-4-ADMIN-INVENTORY.md`, 327 entries) is the
behavior-preservation manifest behind it — its risk-register and gap numbers are
the IDs this document cites. This document is the target; the inventory is the
floor.

## Goal

The console answers five questions immediately, on every page:

1. **Does anything need me?** — one number at the top of each page, green when zero.
2. **What is the safest next action?** — one visually primary control per region.
3. **What will this control change?** — a scope line states the write before submit.
4. **Can I undo it?** — the undo control sits adjacent; partial undo says so.
5. **Where is history?** — a Records band on every page, collapsed, counted honestly.

## Information architecture

Three task boundaries, unchanged: **Report Review** (`/admin`), **Scanner Monitor**
(`/scanner`, operator branch), **Dossiers** (`/admin/compile`; nav label changes,
route does not). Every page uses the same skeleton:

1. Status and required work — stat band + the page's only required items, visible.
2. Primary task — flagged queue / action inbox / compile form.
3. Optional work — teaching desk etc., collapsed by default.
4. Records and history — collapsed ledgers with `showing X of Y` counts.
5. Advanced / break-glass — last band, amber-edged panels, friction intact.

Scanner Monitor adds a **persistent local section nav** (sticky rail on desktop,
sticky chip row on mobile): Status · Teach · Records · Context lanes · Lessons ·
Scan history · Cadence & budget, each with its live count.

**Navigation vs utilities:** the top bar's left register holds the three page
destinations only. Export CSV and Sign out move to a visually distinct utility
cluster on the right — both capabilities preserved on every OperatorShell page.

**No endless lists.** Every list states its window against the true total
(flagged: `oldest first · showing N of M`; leads: `20 most recent of 57 tracked`;
lessons/history: `showing N of M` + filter + browse-more). Windows the queries
impose are stated, never implied away.

## Control grammar

Seven classes; same intent uses the same class and wording on every page.

| Class | Treatment | Members (examples) |
|---|---|---|
| Primary | solid crimson, one per region | Approve, Compile now, Run capped scan now |
| Secondary | ink outline | Keep as relevant, Lock, Save settings, Test scan |
| Quiet | text-only | Show more, Browse, Details, Inspect source |
| Destructive | crimson outline **+ scope line stating the write** | Reject, Spam, Reject and teach, Remove bad lead |
| Recovery/Undo | `↩` glyph + mono label, adjacent to what it reverses | Undo, Clear lock, Reset to automatic |
| Break-glass | amber-edged raised panel, mono warrant, reason + acknowledgement kept | visibility override create, current patch override |
| Cost-incurring | mono `SPENDS CREDITS` chip beside the button + disclosure that dry-run also spends | both scan buttons, Keep as relevant (LLM call) |

Required on every mutation: disabled/pending state (existing pendingText pattern),
inline errors that name the problem and recovery and preserve entered data,
explicit success confirmation, and risk never carried by color alone (every color
is paired with a text badge or glyph).

**Reversal language (owner-locked 2026-07-25).** The `↩` glyph and the word
"Undo" are reserved for full reversal. A partial reversal names what it actually
does — a KEEP lesson's control reads **Forget lesson** with **rescued lead
stays** adjacent (accessible text, not a tooltip) — and its consequence copy
states all three limits: forgetting never restores the candidate, never deletes
the rescued lead, never refunds spend. Cost language is likewise fixed: both
scan runs "spend real search credits and LLM calls — a test run only suppresses
public changes. Neither run is reversible"; Keep as relevant "spends an LLM
call, creates a private lead, and records a scanner lesson" (always "creates",
never "publishes" — the lead is private). The same consequence, pending,
success, failure, disabled, and reversal wording applies to equivalent controls
on every page.

**Export CSV (owner-locked).** The utility control reads `Export CSV…` and opens
a confirm step that names the payload — the complete private report table,
including everything that never becomes public — before downloading.

## Parity dispositions

**Default disposition: Preserve.** Every inventory entry not named below keeps its
write payload, hidden fields, guard order, validation text, revalidation set,
conditional/degraded states, and deliberate friction, verbatim. Presentation may
change; behavior may not. Specifically preserved presentation-sensitive items:
the moderation cluster select stays inside the same form as all three decision
buttons with a scope line stating that Reject/Spam also write it (risk #8); the
scanner policy stays ONE form, visually sectioned (risks #4/#5); the lifecycle
select still omits `acknowledged` (risk #9); Keep-as-relevant stays outside the
feedback-learning gate (risk #11); the Steam-review teaching refusal keeps its
explanatory sentence (risk #31); both Undo surfaces for observation decisions
remain (risk #29); both teaching forms remain distinct (risk #28); the
visibility-override browser keeps its search gate, result cap, reason, and
acknowledgement (risks #15/#16).

**Consolidate:** Export CSV + Sign out → utility cluster (risks #12/#24; every
OperatorShell page, capability unchanged). COMPILE DOSSIER label → Dossiers.
Scanner sections → one page + local section nav (no route changes).

**Retire as verified dead — owner-approved 2026-07-25, delete during Phase 4
implementation:** `/admin/source-monitor`
stub and the six `revalidatePath("/admin/source-monitor")` calls (risk #20,
gap #13); `runRedditMonitor` (risk #23); `RejectedArchive` + the
`rescueRejectedCandidate` compat action (risk #21; its unit and auth tests
retire with it); `setAutomationPaused` (risk #22, unwired duplicate); the hidden
`modelPreset` input and unreachable `paused` form branch (risk #26).

**In scope — owner-approved 2026-07-25:** return-to after re-auth (gap #3).
`requireAdmin` redirects carry the original destination and every sign-in
surface honors it, so a session expiry on any operator page returns there.

**Defer with named reason:** self-expiring rules via `expires_at` (risk #25 — a
real feature, not a redesign); admin error-boundary chrome (gap #1 — failure
surface must not change silently in a UI pass); rescue-vs-scan budget split
(gap #10 — server contract; the mockup copy states the split honestly instead);
robots `index,follow` on admin routes (gap #14 — separate hardening PR).

**If better UX would need a server or database contract change, stop and flag it.**

## Acceptance (Stage 2 gate)

Required work identifiable in 10 seconds; one obvious next action per page;
history never dominates daily work; every scanner section reachable from the nav
without full-page scrolling; equivalent controls identical across pages;
different-risk controls visibly distinct without relying on color; explicit
keyboard order, visible focus, labels, disclosure state, and live status
feedback; desktop primary, every control operable at 390px; every active
Undo/Reset path reachable; public and operator scanner data boundaries never
merged; all parity dispositions honored against the inventory IDs.
