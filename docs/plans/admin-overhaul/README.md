# Admin workspace redesign

One desktop workspace now provides Overview, Reports, Claim review, Scanner, Videos, Dossiers, and Settings & tools. The implementation retains the public site's Instrument typefaces, paper/ink colours, and light/dark themes.

The owner approved the replacement layout and requested the existing website identity, both themes, full-window expansion, and cleanup of the superseded draft PRs. This replaces the earlier Slice A concept; the redesign is one implementation and one PR.

## Implementation

- Canonical entry: `/operator`, with internal destinations selected by `?view=`. Exact queue-item and dossier-run links survive sign-in. Existing `/admin`, `/admin/videos`, `/admin/compile`, and authenticated `/scanner` remain compatible.
- Overview lists named decisions and exact queue totals. Scanner health is separate. Unavailable reads never become zero.
- Reports preserve entered excerpts after failed saves, detect stale decisions, and support idempotent excerpt-only retry after partial approval.
- Claim review stores exact-patch pairings, repeat sightings, reason-bearing rejection, deferred decisions, and private audit history. Confirm and Undo validate current records atomically.
- Scanner keeps its existing controls, diagnostics, teaching, records, lessons, and settings. Models, cadence, search depth, budgets, and public provider boundaries are unchanged.
- Videos retain the private inbox, draft preparation, edits, skip, archive/restore, stale checks, and downloads. Dossiers retain deterministic compilation and explicit opt-in AI prose.
- Settings keeps lifecycle locks, visibility overrides, and manual patch recovery separate from routine claim review.

## Evidence and release boundary

Application changes are implemented and locally verified through unit tests, local SQL execution, browser write/recovery tests, both themes, and wide desktop layouts. See [the implementation record](SLICE-A-HANDOFF.md) for the current evidence and release requirements.

The claim store and safe excerpt retry require the two included migrations. They have been executed against the local Supabase stack. Hosted migrations, merge, and production deployment require separate owner approval. Until the hosted schema exists, claim review stays explicitly unavailable/read-only and existing scanner lifecycle compatibility remains.

No paid scanner bake-off was run: search queries and provider policy did not change. Public `/scanner` continues to render Observatory for signed-out visitors.

## Supporting material

- [Capability inventory](spec/capability-inventory.md)
- [Claim-review contract](spec/claim-review-contract.md)
- [Metrics and attention contract](spec/metrics-attention-contract.md)
- [Delivery record](delivery-map.md)
- `review/` retains historical findings that informed the replacement; it is not approval of the current implementation.

[View the implemented light and dark workspaces](screenshots/README.md).
