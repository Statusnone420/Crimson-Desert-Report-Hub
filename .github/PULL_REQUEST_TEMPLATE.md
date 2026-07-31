## Summary

What changed and why?

## Verification

- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm exec tsc -- --noEmit`
- [ ] `npm run build`
- [ ] `npm run test:e2e` if UI changed
- [ ] If paid model or provider routing changed, a Vercel preview completed one real generation on the expected provider; deterministic fallback alone is not a pass.

## Safety

- [ ] No real secrets, tokens, private dashboard URLs, or local machine paths are included.
- [ ] Public pages still avoid raw unreviewed report text.
- [ ] Any automation/provider behavior remains budget-capped and fail-closed.
