# Community check-ins

The public contribution is a personal response to an existing public issue, with a platform and an exact patch. There is no written-report inbox or promised support response. The site is maintained independently and has no developer affiliation.

## Counting

- General responses are `have_it` and `not_happening`. An attached official fix offers `fixed_for_me` and `still_happening`.
- A network has one current response per issue per exact patch. Changing the response or platform replaces that record. Every patch starts a fresh tally, including hotfixes.
- Networks are not verified players. People sharing an IP share a response; changing networks can evade an IP limit. Counts describe submitted experiences, not prevalence or proof.
- Only fixed/still responses at or after the exact current claim date enter its verdict. A general negative response never becomes a fixed result or subtracts someone else's experience.
- Legacy `issue_confirmations` and written reports remain intact. Earlier confirmations are displayed as history and excluded from current tallies. No family-based votes are backfilled into the new system.

## Publishing and protection

Source corroboration and maintainer visibility decisions still control publication. Check-ins cannot publish a private issue, expose a private source, or change evidence counts. A negative-only response does not move a public watchlist lead into Published Issues; it remains visible in that lead's response tally. A current response can retain an already-public topic owned by the scanner when its leads age out. That automatic ownership remains intact, so a new patch without responses or evidence can retire it normally. Maintainer visibility overrides remain separate. Each response write increments the visibility revision, so a scanner decision made before that response must be recomputed.

`issue_checkins` and `record_issue_checkin` are restricted to the service role. Public pages receive aggregates only. The API requires same-origin JSON, a valid platform and response, the displayed patch matching the verified current patch, a network hash, and successful Turnstile verification. The shared ledger allows 20 attempts per network per hour. Missing bot configuration or schema refuses new writes. A lost HTTP response is described as an unconfirmed save; a retry replaces the same record.

Every choice takes the shared current-patch lock and verifies the exact patch in the database before recording either an attempt or a response. A patch change during submission returns `stale_patch`, without a saved answer or rate-limit attempt. Claim-specific choices additionally require the same exact source context shown on the public board: a completed first durable claim sync, a matching confirmed pairing, and no maintainer lifecycle lock. General choices do not assert a fix claim.

## Release sequence

This PR does not apply a hosted migration.

1. Review CI and approve the application release and additive migration separately. Keep the current production deployment serving its existing `record_issue_confirmation` path.
2. Apply `20260912184424_issue_checkins.sql` only with explicit hosted-migration approval, while the previous application stays live. The migration is additive: the legacy table, RPC, and its grants remain unchanged. Verify the new table/RPC permissions and existing Production Turnstile keys and allowed hostname.
3. Create a fresh Production build, then release it. `next.config.ts` runs a read-only preflight against the service role's PostgREST OpenAPI metadata. It requires the new table's read/write methods, expected columns, and exact RPC arguments. Missing schema, permission errors, timeouts, or invalid metadata stop the build; the legacy production deployment stays live. Local and Preview builds skip this production-only gate and remain suitable for fixtures/read-only review. Do not promote an earlier Preview build to bypass the gate.
4. Verify a controlled check-in on the current patch, replacement, and fresh tally behavior without deleting historical data. The retired report API returns `410` without processing the payload; `/report` permanently redirects to `/issues`.
5. Check the next normal scanner run and the issue board. No Cloudflare Worker change or scanner query-pack change is part of this PR. Rollback may restore the previous application without removing either table or RPC.

This release deliberately requires migration before application replacement. The legacy RPC accepts only three response kinds and cannot atomically validate the exact current claim, serialize with a patch change, or advance the visibility revision. Passing new requests to it would weaken those guarantees. The existing legacy application stays available until the new writer is ready instead. Runtime schema failures still return explicit unavailable responses and never invent empty successful tallies.

Local proof uses `npm run db:start`, `npm run db:reset -- --local`, and `npm exec supabase -- test db --local supabase/tests/issue_checkins_test.sql`. Never link the local stack to production or use `supabase db push` for this workflow.
