# Community check-ins

The public contribution is a personal response to an existing public issue, with a platform and an exact patch. There is no written-report inbox or promised support response. The site is maintained independently and has no developer affiliation.

## Counting

- General responses are `have_it` and `not_happening`. An attached official fix offers `fixed_for_me` and `still_happening`.
- A network has one current response per issue per exact patch. Changing the response or platform replaces that record. Every patch starts a fresh tally, including hotfixes.
- Networks are not verified players. People sharing an IP share a response; changing networks can evade an IP limit. Counts describe submitted experiences, not prevalence or proof.
- Only fixed/still responses at or after the exact current claim date enter its verdict. A general negative response never becomes a fixed result or subtracts someone else's experience.
- Legacy `issue_confirmations` and written reports remain intact. Earlier confirmations are displayed as history and excluded from current tallies. No family-based votes are backfilled into the new system.

## Publishing and protection

Source corroboration and maintainer visibility decisions still control publication. Check-ins cannot publish a private issue, expose a private source, or change evidence counts. A current response can retain an already-public topic owned by the scanner when its leads age out. That automatic ownership remains intact, so a new patch without responses or evidence can retire it normally. Maintainer visibility overrides remain separate. Each response write increments the visibility revision, so a scanner decision made before that response must be recomputed.

`issue_checkins` and `record_issue_checkin` are restricted to the service role. Public pages receive aggregates only. The API requires same-origin JSON, a valid platform and response, the displayed patch matching the verified current patch, a network hash, and successful Turnstile verification. The shared ledger allows 20 attempts per network per hour. Missing bot configuration or schema refuses new writes. A lost HTTP response is described as an unconfirmed save; a retry replaces the same record.

Claim-specific choices require the same exact source context shown on the public board: a completed first durable claim sync, the current official patch, a matching confirmed pairing, and no maintainer lifecycle lock. The database checks this before recording either an attempt or a response. General choices do not assert a fix claim.

## Release sequence

This PR does not apply a hosted migration.

1. Review CI and approve the application release and additive migration separately from this draft.
2. Deploy the compatible application. Before the new table exists, the board preserves earlier records and explains that current check-ins are unavailable. Permission and other read failures also remain explicit; they are never accepted as an empty successful tally. The old report API returns `410` without processing the payload; `/report` permanently redirects to `/issues`.
3. Apply `20260912184424_issue_checkins.sql` only with explicit hosted-migration approval. The legacy table and writer are unchanged, so the previous application remains readable during a rollback.
4. Verify the table/RPC permissions, existing Production Turnstile keys and allowed hostname, and a controlled check-in on the current patch. Verify replacement and fresh tally behavior without deleting historical data.
5. Check the next normal scanner run and the issue board. No Cloudflare Worker change or scanner query-pack change is part of this PR.

Local proof uses `npm run db:start`, `npm run db:reset -- --local`, and `npm exec supabase -- test db --local supabase/tests/issue_checkins_test.sql`. Never link the local stack to production or use `supabase db push` for this workflow.
