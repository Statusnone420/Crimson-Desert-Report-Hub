# Claim-review contract

This is the durable workflow for an official fix claim paired with an issue. It replaces Lock as the routine response to an unsure claim. SQL and handlers are included in the implementation; this document states their contract.

## Meaning and display

Confirm means: **this exact official line concerns this issue**. It makes the issue `fix_claimed` under existing engine-owned lifecycle rules. It does not mean the game is fixed, change player evidence, set `verified_fixed`, change visibility, or set `admin_override`.

Each active pairing displays exact official text, official URL/section when available, exact patch and provenance, issue context, proposal kind, and history. Do not display raw report bodies, private evidence URLs, rejected scanner URLs, network hashes, or a game-fixed action in the routine card.

The primary actions are Confirm pairing, Not the same issue, and Decide later. The separate break-glass area contains Lock, visibility override, and current-patch override. Do not place Lock on every pairing card or use it to reject a pairing.

## Stable identities and activity

```text
claimKey   = sha256(exactPatchVersion + "\n" + normalize(exactFixText))
pairingKey = claimKey + "\n" + clusterId
```

`normalize` uses Unicode NFC, strips NULs, trims, and collapses Unicode whitespace. It does not case-fold. `board_no`, position, and section are display context, not identity.

An active work item requires all of these: the exact claim still exists in the current official patch, its text still hashes to `claimKey`, and the pairing is current. A new patch, corrected official text, removed claim, or private/locked issue removes prior pairings from active counts immediately through a read-only eligibility projection. The next scanner transaction persists retirement. Their audit/history remains visible as historical context and never silently transfers to a new claim.

One claim may pair with more than one cluster. Each `pairingKey` is independent. Do not expand lifecycle mapping beyond public clusters by default.

## State and counters

| State | Counts as one active owner decision | Effect |
| --- | --- | --- |
| `pending` | Yes | New/undecided exact pairing. |
| `later` | Yes, exactly once | Deferred decision; it remains one active item. |
| `confirmed` | No | This claim maps to this issue for this exact patch. |
| `rejected` | No | Suppresses this exact pairing until safe Undo. |
| `retired` | No | Claim removed, corrected, or patch changed; retained in history. |

`firstSeenAt` and scanner `lastSeenAt` describe engine sightings. `seenByOperatorAt` separately records the last operator acknowledgement. Decide later updates `seenByOperatorAt`; repeat scans update scanner `lastSeenAt` and `seenCount`. No later action may create an additional active count for the same `pairingKey`.

## Atomic writes and stale protection

All routine actions are one server-side transaction/RPC with compare-and-set revision inputs. It atomically writes the pairing state, required cluster lifecycle result, and append-only audit event. A partial pairing/cluster/audit outcome is invalid.

Before Confirm, the transaction re-reads and validates the exact current patch provenance, patch version, claim identity/text, cluster, pairing revision, and relevant lifecycle revision. If any differs, reject as stale with no write. Fallback/manual/unknown patch provenance cannot stamp an official-claim clock. A concurrent Lock or lifecycle change must fail the CAS rather than be overwritten.

On Confirm, set `fix_claimed` engine-owned, preserve any existing exact-patch clock, or create its exact-patch clock if absent. Clear only the Needs-review reason for this pairing. Do not set `admin_override`, `verified_fixed`, visibility, excerpts, or evidence tallies.

On Reject, require a 3–500 character reason and leave cluster status/clock unchanged. Clear obsolete Needs-review prose only when no other active pairing requires it. On Later, preserve `firstSeenAt`, update `seenByOperatorAt`, and retain exactly one active count. Failed or stale saves leave state unchanged and the card visible with its entered data.

## Repeat scans and precedence

For a current active pairing:

1. A Lock still controls displayed lifecycle state and is not a routine task.
2. A rejected exact `pairingKey` suppresses keyword, unsure, and sure matches until Undo.
3. A confirmed exact `pairingKey` is equivalent to a sure mapping for its current exact patch.
4. Pending/Later keyword or unsure repeats update scanner sighting only. A new sure match may confirm it through the same transaction.
5. No pairing record follows current engine behavior and creates a pending record for unsure/keyword proposals.

New patch, corrected text, removed text, or a different cluster produces a different current state. Retire obsolete records before calculating pending counts or applying engine precedence.

## Safe undo and independent support

Audit events are append-only and operator-private: timestamp, signed-in operator, action, stable ids, exact patch/text snapshot, prior state, engine kind, and rejection reason where applicable.

Undo is itself a revision-checked transaction. It cannot erase or alter a later independent confirmation or support for the same patch. If the confirmation being undone created the only surviving exact-patch clock, clear it; if another independent current-patch confirmation/support exists, preserve the clock. If patch/claim became retired, a Lock landed, or revisions changed, reject the Undo as stale and preserve history.

Undo Reject restores pending only if its exact current claim is still active. Undo Later clears only operator-seen metadata; it never removes the active item. Clear Lock remains Lock's own existing undo.

## Rolling deploy and brief

Before the pairing schema exists, preserve the current string-based lifecycle path. New UI shows pairing state as unavailable, never zero; pairing actions state that nothing was saved. Fall back only for a narrowly identified missing table/column/RPC. Permission and other database errors surface as errors.

Once the schema exists, the lifecycle pass consults it and the brief receives the matching pending count. During an old-brief/new-desk window, show the discrepancy; do not treat brief zero as desk zero. Keep `unsureClaimMatches` and `needsYou` JSON keys. The brief has counts and safe next steps only, not claim text or audit content.

## Required implementation proof

- Atomic CAS Confirm writes pairing, cluster result, and audit together; stale patch/claim/revision writes nothing.
- Reject suppresses repeated keyword, unsure, and sure matches for that exact key until Undo.
- Later remains one active item across scans; scanner last-seen and operator-seen stay distinct.
- New patch, corrected text, and removed claim retire old pairings and remove them from active counts while preserving history.
- Confirm preserves an existing exact-patch clock. Undo cannot erase later independent same-patch support.
- Lock/visibility/current-patch overrides remain separate; fallback provenance refuses claim clock writes.
- Missing schema is unavailable; permission errors are not empty success; brief output remains private.
