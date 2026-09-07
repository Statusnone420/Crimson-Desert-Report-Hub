# Open decisions (material only)

Slice A Agent 1 made routine, reversible calls in the other spec files (Confirm = engine-owned `fix_claimed`; Reject suppresses that pairing including later `llm_sure`; Later stays one Needs-you item with no expiry; Lock stays exceptional; AI+circuit co-symptoms count once; Overview gains named owner-decision reads without writes; public `/scanner` Observatory unchanged; 2h / 3 searches frozen).

Only the following change intent, data, or contracts enough to need an owner call before Slice B/C implement them.

---

### 1. Confirm against a different cluster in one step?

**Choice:** On a proposal, may the operator Confirm the official line onto a cluster **other than** the proposed one?

**Recommendation:** **No for v1.** Confirm is this `pairingKey`. Wrong cluster → Not the same issue (reason) and wait for another proposal, or use exceptional Lock if the issue itself must be frozen.

**If yes:** Confirm needs a cluster picker, a second identity write, and suppression of the rejected proposal in the same transaction — larger store/UI than the pairing card.

---

### 2. Map official claims onto non-public clusters?

**Choice:** Today `loadLifecycleClusters` only reads `is_public = true`. Should claim-review include private clusters?

**Recommendation:** **No.** Keep the engine’s public-cluster set so Confirm cannot start a public claim clock on an unpublished issue. Visibility remains the separate break-glass path.

**If yes:** Pairing could stamp `fix_claimed` on a hidden cluster; public readout rules and Needs you would need an explicit “private pairing” state.

---

### 3. Should Decide later block a later `llm_sure`?

**Choice:** The claim-review contract lets a subsequent **sure** engine match auto-confirm a pending/later pairing, while Reject blocks sure matches until Undo.

**Recommendation:** **Keep auto-sure on Later** (Later is defer, not a verdict). Flip only if the owner wants Later to mean “freeze this pairing even if the model becomes sure.”

**If freeze:** Later becomes almost as strong as Reject without a reason; Needs you would then require a human even after a confident match.

---

These three are independent. Unlisted choices (snooze timers, brief JSON key renames, Overview 9am aside removal, dossier missing-run copy, dead `setAutomationPaused` UI) are specified as routine in the other files or can wait.
