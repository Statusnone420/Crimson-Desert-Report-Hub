# Metrics and attention contract

These labels describe what the desktop operator dashboard must mean. They do not authorize new data collection or policy changes.

## Overview: two named rows

Overview is read-only and has two separate rows. Each row item has an identity, status, and next-step destination. A row may show a total only when its component reads are known; the identities remain visible.

| Row | Includes | Excludes |
| --- | --- | --- |
| Owner decisions | flagged reports; active pending/later claim pairings; video awaiting review; video drafts ready | Locks, visibility records, background inventory, optional teaching candidates |
| Operational incidents | failed runs, AI health, correlated circuit issue, collection delay/failure, unread scanner register | approval queues, screening events, awaiting leads, yield |

Quiet copy appears only when both rows are known empty. Any unread/missing source is named unavailable (`—`), never converted to a zero. Overview has no moderation, scan, policy, or lifecycle writes.

Claim pairings count distinct current active `pairingKey`s: pending and Later each count one. Retired, confirmed, and rejected pairings count zero. A scanner repeat cannot add a second count. Video reads retain their own unavailable contract.

## Scanner status and attention

Run status is separate from AI health. Completed does not mean AI healthy. `Completed with limits`, Failed, Skipped, Running, and PAUSED retain their existing meanings.

AI unavailable/limited and an OpenRouter circuit state form **one** item when they describe the same failure. Independent failed runs or delayed lanes stay separate named items. Unknown radar/circuit/collection reads produce Scanner `Unknown`, never “All clear.” #95 diagnostics may explain a status privately but do not become a public or extra attention item.

## Background inventory

| Label | Meaning | Never call it |
| --- | --- | --- |
| Awaiting corroboration | distinct current private leads without public signals or approved reports | approval work |
| Candidates reviewed | screening events in the named rolling window; repeats count | unique URLs or human reviews |
| Kept / retained | retained leads in the named window | evidence or accuracy |
| Radar yield | retained / screened share for the same window | accuracy |
| Weekly composition | still-tracked leads first seen in an ISO week | the rolling 7-day funnel |

Every count names its time window. Successful zero is zero; unread is unavailable. None of these inventory measures enters owner decisions or Scanner attention by itself.

## Brief alignment

`owner_attention_brief` is one default approved brief. It reports bounded counts and safe next steps, uses stable keys `unsureClaimMatches` and `needsYou`, and stays quiet for known zeros. It is not an interview. Pairing counts align with the desk after the pairing schema is live; pre-migration or old-function disagreement is surfaced rather than normalized to zero.

## Acceptance examples

| Situation | Required display |
| --- | --- |
| AI route failed; scan completed | AI unavailable; completed run remains completed |
| AI and circuit are the same cost failure | one named AI/circuit incident |
| A Later pairing is seen in three scans | one owner decision; scanner last-seen advances; operator-seen remains separate |
| Claim text corrected or patch changes | old pairing retired/history only; new exact claim can appear |
| Video schema missing | video owner decision unavailable, not 0 |
| Awaiting=5; no reports or pairings | inventory 5; owner decisions 0 |
| Radar/circuit unread | named unavailable and no quiet all-clear |
