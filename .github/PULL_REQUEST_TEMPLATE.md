## Summary

What changed and why?

## Verification

- [ ] `npm run verify` passed locally on the final files before push (includes all core and browser checks).
- [ ] The PR still matches the locally verified files, and the required `verify` check passes before merge.
- [ ] If paid model or provider routing changed, a separately authorized, budget-capped check completed one real generation on the expected provider in a supported environment. Record a blocker if unavailable; local mocks or deterministic fallback are not proof. Fresh Vercel-preview sign-in is disabled.

## Safety

- [ ] No real secrets, tokens, private dashboard URLs, or local machine paths are included.
- [ ] Public pages still avoid raw unreviewed report text.
- [ ] Any automation/provider behavior remains budget-capped and fail-closed.
