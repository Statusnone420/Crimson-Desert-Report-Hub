# Claim-review contract

Slice A — durable pairing review for official Pearl Abyss fix claims. **No SQL in this slice.** Later implementation PRs add migration files and must run them only against local Supabase.

**Baseline:** `2a0953a`. Preserve exact-patch claim clocks (`fix_claimed_at`, `fix_claimed_patch_version`), evidence counts, visibility overrides, and public “claim ≠ verified” language (`PRODUCT.md` lifecycle model; `src/lib/lifecycle.ts`).

---

## Problem (current behavior)

Each lifecycle pass (`runLifecyclePass` in `src/lib/automation/run.ts`) maps current-board claims onto **public** clusters via `mapClaimToClusterWithOpenRouter` (`src/lib/automation/claimMapping.ts`).

| Engine result | Cluster write today | Operator tool today |
| --- | --- | --- |
| `llm_sure` | `fix_claimed` + exact current-patch clock; `admin_override` stays false | None needed |
| `llm_unsure` / `keyword_proposal` | stays `reported`; `lifecycle_reason` = `Needs review: …`; `needsHuman` | **Lock** (issue-wide override) |
| `none` | clears stored reason | None |

Keyword fallback is what you get when the key is missing, the route refuses, cost cannot be verified, budget/time caps hit, or JSON fails — so “Needs review” often means **AI was blocked**, not “a human must certify a fix.” The same proposal is rewritten every scan. Needs you counts those strings (`countNeedsYou` / `owner_attention_brief`). Lock is the only button; it sets `admin_override`, optionally fabricates a claim clock, and is the wrong routine tool.

**This contract replaces Lock as the routine response to a pairing proposal.** Lock remains exceptional (section 8).

---

## What the operator must see

For each **pending pairing**, the desk shows:

1. **Exact official claim text** — `official_patch_claimed_fixes.fix_text` as stored (verbatim; do not paraphrase, truncate in storage, or let the model rewrite it). Display may wrap; copy stays exact.
2. **Source** — current official notice URL (`official_patch_notes.official_url` / `getCurrentPatchMetadata().officialUrl`) and section if the rolling-deploy column exists (`section`; legacy reads may show section unavailable).
3. **Patch** — exact version string the clock uses (e.g. `1.13.02`), provenance Synced / Manual / Unknown. Manual current patches carry **no** official claims; this ledger is empty then, not full of invented pairings.
4. **Issue context** — cluster title, slug, category, current engine `fix_status` label, whether the cluster is public, and a short issue summary from stored cluster description **without** raw player-report bodies.
5. **Proposal kind** — `keyword_proposal` vs `llm_unsure`, plus the engine reason (already prefixed `Needs review:` today).
6. **Sightings** — `firstSeenAt`, `lastSeenAt`, `seenCount` (scan sightings of this identity, not player reports).

Do not show: network hashes, private evidence URLs, rejected scanner URLs, or a “game is fixed” control on this card.

---

## Operator actions (routine)

Three pairing actions. None of them certify that the game is fixed. None of them are visibility overrides. None of them are report moderation.

### Confirm pairing

**Meaning:** This official claim is about **this issue**. Pearl Abyss **claims** a fix. Players still verify.

**Writes (intended):**

- Pairing state → `confirmed` (audit row).
- Cluster remains **engine-owned** (`admin_override` stays false).
- Lifecycle status → `fix_claimed` (“Fix claimed — unverified”), same as today’s `llm_sure` path.
- Stamp `fix_claimed_at` if none exists for this exact current patch; **preserve** an existing exact current-patch clock (do not restart it).
- Set `fix_claimed_patch_version` to the **current exact** version. Never copy a previous patch’s clock forward (`hasCurrentClaimContext` in `lifecycle.ts`).
- Clear `lifecycle_reason` Needs-review prose (normal states compose at read time).
- Do **not** set `verified_fixed` or `persists`.
- Do **not** change `admin_visibility_override`, `is_public`, approved excerpts, or confirmation tallies.
- Do **not** insert public copy that says the maintainer marked the game fixed.

**Not:** “Confirm the game is fixed.” That remains player evidence + optional exceptional Lock to `verified_fixed`.

### Not the same issue

**Meaning:** This official line is **not** about this cluster.

**Writes (intended):**

- Pairing state → `rejected`.
- Required reason (3–500 chars, same family as scanner teach reasons).
- Cluster `fix_status` / claim clock **unchanged** (unless this pairing had been confirmed — then undo confirmation first; see undo).
- `admin_override` stays false.
- Suppress **identical** proposals later (section 5).
- Clear or avoid rewriting `lifecycle_reason` for this identity so Needs you does not bounce.

**Not:** hide the issue, reject player reports, or lock lifecycle.

### Decide later

**Meaning:** Leave the pairing pending. The operator has seen it and is not deciding now.

**Writes (intended):**

- Pairing state stays `pending` (or explicit `later` that **counts the same** as pending in Needs you).
- Update `lastSeenAt` / operator-seen timestamp; keep `firstSeenAt`.
- Do not stamp a claim clock.
- Do not suppress `llm_sure` (a later confident engine match may confirm without a lock).
- Do suppress *new* Needs-you rows for the same identity: still **one** item, last seen updated.

No auto-expiry in v1 (reversible later). Quiet disappearance without Confirm/Reject is forbidden.

---

## Stable identity

Official rows today are unique on `(board_no, position)` and are **deleted/reinserted** on sync. Position is **not** identity.

### Claim identity (the official line)

```text
claimKey = hex( sha256( utf8( patchVersion + "\n" + normalize(fixText) ) ) )
```

- `patchVersion` = exact current version string used by claim clocks (not patch family).
- `normalize(fixText)` = Unicode NFC, strip NULs, trim, collapse internal Unicode whitespace to single U+0020. **Do not** case-fold (official wording is evidence).
- `board_no` and `position` are display/join aids only.
- `section` / `category` are context, not identity.

**New patch** (version string changes) → new claim identities. Old pairings remain in history; they do not auto-apply to the new patch (same rule as clocks).

**Corrected official text** (normalized `fixText` changes on the same version) → **new** `claimKey`. Previous Confirm/Reject do not transfer. First seen starts now. Show history that an older text existed on this patch if the store still has it.

### Pairing identity (the work item)

```text
pairingKey = claimKey + "\n" + clusterId
```

Needs you counts distinct `pairingKey` in pending/later. Repeat scans of the same key increment `seenCount` only.

A second cluster proposed for the same `claimKey` is a **different** pairing and may still need a call.

---

## Engine precedence (after the store exists)

On each lifecycle pass, for each engine decision that names a `clusterId`:

1. **`admin_override` (Lock)** — still wins for displayed `fix_status`. Engine may only refresh the lock’s “System would show: …” reason. Pairing review is not required work on locked clusters.
2. **Rejected pairing** for that `pairingKey` — treat as `matchKind: none` for that cluster. Do **not** write `Needs review:`. Do **not** stamp a clock. A later `llm_sure` for the **same** key stays suppressed until Undo. A sure match to a **different** cluster is a different key.
3. **Confirmed pairing** for that `pairingKey` **and** `claimKey` patch === current patch — treat as `llm_sure` (engine-owned `fix_claimed`, preserve exact current-patch clock).
4. **Pending / later** — keep `reported`; do not spam a new Needs-you identity; update last seen. **Exception:** a new `llm_sure` for this key may Confirm automatically (engine path already trusted for sure matches). Keyword/`llm_unsure` repeats do not.
5. **No pairing row** — today’s engine behavior (`llm_sure` stamps; unsure/keyword flags Needs review and **creates** a pending pairing row).

Private (non-public) clusters stay **outside** this mapping set, matching `loadLifecycleClusters` (`.eq("is_public", true)`). Expanding that set is an open decision.

---

## Concurrency

Reuse the lifecycle CAS pattern already on cluster updates (`admin_override`, `fix_status`, `fix_claimed_at`, `fix_claimed_patch_version` predicates in `writeLifecycleResult`):

- Pairing writes take a `revision` (or equivalent row version). Stale revision → failed save, pending unchanged, operator retries.
- Confirm must not clobber a Lock that landed between read and write.
- Confirm must not stamp a clock when current patch provenance is `fallback` (same refusal as claim-bearing Lock).
- Two operators: last successful revision wins; audit keeps both attempts if the second fails.

Video inbox (`mutate_video_review_candidate`) is the UX precedent for stale-edit errors.

---

## Audit

Append-only pairing events (operator-private):

| Field | Rule |
| --- | --- |
| `at` | UTC timestamp |
| `actor` | “signed-in operator” (no user accounts today) |
| `action` | `proposed` / `confirmed` / `rejected` / `later` / `undone` / `auto_sure` |
| `pairingKey` / `claimKey` / `clusterId` | stable ids |
| `patchVersion` | exact |
| `fixText` | exact official text at the time of the event (so later corrections don’t rewrite history) |
| `reason` | required on reject; optional note on confirm/later |
| `engineMatchKind` | `keyword_proposal` / `llm_unsure` / `llm_sure` / `none` |
| `previousState` | for undo |

Do not put audit payloads on public pages, the Observatory, or the 10 AM brief. Brief keeps counts only.

History UI on `/admin` is in-spec (list + undo). Export CSV remains the 22-field **report** export and does not grow pairing dumps in this overhaul.

---

## Repeat-scan suppression

Identical means same `pairingKey` (same exact patch, same normalized official text, same cluster).

| After | Later keyword / `llm_unsure` | Later `llm_sure` same key | New patch or corrected text |
| --- | --- | --- | --- |
| Rejected | suppressed | suppressed until Undo | new pairing, may appear |
| Confirmed | no Needs you; clock preserved | no-op if already claimed this patch | new pairing for the new key |
| Later / pending | same one item; last seen++ | may auto-confirm | new pairing |
| Locked | not in Needs you | lock still wins | lock still wins until Clear |

Suppression is **not** a domain-wide scanner lesson and **not** a visibility hide.

---

## Safe undo

| Undo | Restores | Does not |
| --- | --- | --- |
| Undo Reject | Pairing pending; engine may propose again | Invent a clock; change visibility |
| Undo Confirm | Pairing pending; **clear the clock only if this Confirm created it** (no prior exact-patch clock). If a clock already existed, leave it | Clear player taps; unlock a Lock the operator didn’t touch |
| Undo Later | Still pending (Later is already pending); may only clear “seen by operator” metadata | Drop the item from Needs you |

If Undo cannot be applied safely (cluster locked, patch rolled, claim text replaced), fail visibly and leave state unchanged.

Clear lock remains the undo for Lock. It already clears the synthesized clock and leaves `fix_status` until the next pass — keep that behavior.

---

## Lock (exceptional only)

Lock (`setClusterFixStatus`) is an **issue-wide** maintainer override:

- Sets `admin_override=true`.
- Writes the chosen `fix_status` (Open / Fix claimed — unverified / Marked fixed by maintainer / Still happening).
- Claim-bearing values stamp **today** + current exact patch as the clock (refused on fallback provenance).
- Engine will not change status until Clear lock.

**Routine claim-review must not offer Lock as the primary control.** Do not use Lock to mean “not this claim.” Do not use Confirm to mean “marked fixed by maintainer.”

Visibility force public/hidden stays a separate break-glass path with reason + confirm + Reset.

---

## Public readout after Confirm

Unchanged composition (`readout.ts` / Patch Desk):

- Official claim text stays a **claim**.
- Player polls still require answers at or after the clock, on that exact claimed patch.
- Quiet is never green proof.
- Scanner links remain leads.

Confirming a pairing may cause the public scoreboard to list the cluster under “Pearl Abyss claims a fix; players verify from here.” That is intended. It is not a verdict machine.

---

## Migration and rolling-deploy compatibility (**no SQL here**)

Follow existing honesty helpers: `isMissingSupabaseRpc`, `isMissingSupabaseColumn`, `isMissingSupabaseRelation` (`src/lib/supabaseCompatibility.ts`). Fall back **only** for a narrowly identified missing schema object. Permission and other failures must throw or show unavailable — never empty success.

| Deploy mix | `/admin` Needs you | Pairing actions | Lifecycle pass | `owner_attention_brief()` |
| --- | --- | --- | --- | --- |
| Old app + old schema | String-prefix count (today) | N/A | Today’s rewrite | Today’s `lifecycle_reason like 'Needs review:%'` |
| New app + old schema | String-prefix count **and** pairing ledger **unavailable** (not 0 pending pairings) | Writes throw: “claim-review store is not applied; nothing was saved” | Today’s rewrite | Unchanged until the function is migrated |
| New app + new schema, old brief function | Pairing pending counts; do **not** also add leftover strings for keys already stored | Live | Consult pairing store (section 5) | May still count strings until the RPC body is replaced — document the brief/`/admin` disagreement for that window; do not treat brief zeros as `/admin` zeros |
| New app + new schema + updated brief | Pending pairings only; locks excluded | Live | Consult store | Same population as `/admin` pairing term; JSON **keys stay** `unsureClaimMatches` / `needsYou` so the 10 AM connector keeps working |

Implementation (later slice, still no production `db push` from agents):

- New durable pairing records + revision + audit events (table/RPC names are not specified here).
- Scanner consults them only when present.
- Local proof: `npm run db:start` then `npm run db:reset` before proposing SQL. Hosted apply needs explicit owner authorization.
- Preserve pre-migration paths until hosted migration is applied.
- Do not change cadence, budgets, models, circuit, or `#95` diagnostic shape.

Preview/dry-run: pairing writes stay behind `assertProductionWriteAllowed`.

---

## Tests a later slice must add (none in this docs PR)

- Confirm stamps `fix_claimed` without `admin_override` and without `verified_fixed`.
- Confirm preserves an existing exact-patch clock; refuses fallback provenance.
- Reject keeps the pairing out of pending across a second lifecycle pass (keyword and `llm_sure`).
- Later does not increment Needs you.
- Corrected `fixText` or new patch version creates a new pending pairing.
- Lock still wins; Clear lock unchanged.
- Missing schema: unavailable, not All clear; write errors name the missing store.
- Visibility and approved-excerpt paths untouched.
- Brief privacy blob still excludes claim text if items arrays ever grow (counts only is the default).
- Existing: `tests/lifecycle.test.ts`, `tests/claimMapping.test.ts`, `tests/reportReview.test.ts`, `tests/automationRun.test.ts`, `tests/adminActions.test.ts`, `tests/ownerAttentionBrief.test.ts`.
