# Maintainer Runbook

This is the short, public-safe operating checklist. For provider setup and migration authorization, use the [Operations Guide](https://github.com/Statusnone420/Crimson-Desert-Report-Hub/blob/main/docs/OPERATIONS.md) and [Launch Checklist](https://github.com/Statusnone420/Crimson-Desert-Report-Hub/blob/main/docs/LAUNCH_CHECKLIST.md).

## Daily checks

- Open the live site and confirm the public pages load.
- Check the patch desk for current official context, and public pages for honest empty states.
- Open `/operator` for collection health and recent-run status.
- Review pending direct reports in `/admin`.
- Use `/admin/videos` only when you have a YouTube link to review. It is not part of the daily check.
- Open the authenticated `/scanner` view for run health, paused state, and obvious source problems. Anonymous visitors to `/scanner` see the public Observatory.
- Approve only excerpts and links that are useful, relevant, and safe to publish.

## Before a real scan

1. Confirm provider caps and the linked Supabase migration list.
2. Confirm Reddit API credentials are absent.
3. Run the protected no-publish preview.
4. Check that its results are relevant issue material rather than general patch or review content.
5. Run an authorized capped scan only after the preview is acceptable.
6. If Steam or Twitch/IGDB collection is enabled, check each lane's status and capture time in `/operator`.

## If automation looks wrong

- Pause scheduled scans.
- Preserve the run history and private candidate context.
- Prefer hiding or rejecting questionable material while investigating.
- Do not raise caps, add a provider, or loosen publication rules as an emergency shortcut.
- If a credential appeared in a screenshot, issue, discussion, or commit, rotate it immediately and follow the security policy.

## Confirmation board checks

- A successful tap acknowledges a stance but public totals remain server-authored.
- A later tap changes the current response instead of adding a second voter for the same issue and patch family.
- Exact-patch fix claims do not bleed into later patches.
- Scanner links remain leads even when a public issue displays them.

## Before release

Smoke-test `/`, `/news`, `/watch`, `/patches`, `/issues`, `/observatory`, `/report`, `/about`, and `/privacy`. After sign-in, check `/operator`, `/admin`, `/admin/videos`, `/scanner`, and `/admin/compile`.

~~~powershell
npm run lint
npm test
npm exec tsc -- --noEmit
npm run build
npm run test:e2e
npm run test:e2e:n0
git diff --check
~~~

Also inspect the final diff, git status --short, the hosting checks, and the target migration list.

## Useful links

- [Operations Guide](https://github.com/Statusnone420/Crimson-Desert-Report-Hub/blob/main/docs/OPERATIONS.md)
- [Launch Checklist](https://github.com/Statusnone420/Crimson-Desert-Report-Hub/blob/main/docs/LAUNCH_CHECKLIST.md)
- [Privacy](https://github.com/Statusnone420/Crimson-Desert-Report-Hub/blob/main/docs/PRIVACY.md)
- [Security Policy](https://github.com/Statusnone420/Crimson-Desert-Report-Hub/blob/main/SECURITY.md)
- [Public Architecture](https://github.com/Statusnone420/Crimson-Desert-Report-Hub/blob/main/docs/ARCHITECTURE.md)
