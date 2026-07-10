# Data Sources and Automation

Crimson Desert Report Hub remains useful at N=0. Official patch context and the capped source radar keep its instruments alive; player input adds detail without becoming a verdict.

## Input Registers

| Register | Purpose | Meaning |
| --- | --- | --- |
| Structured player reports | Anonymous detailed cases submitted through the site. | Evidence; strongest input. |
| One-tap confirmations | `I have this too`, `Still happening`, or `Fixed for me`, scoped to issue × platform × patch family. | Player signals; counts, not identity or consensus. |
| Scanner-discovered links | Tavily results mapped to public issue questions. | Leads; rumors with links, never evidence. |
| Pearl Abyss patch notes | Current patch metadata and claimed fixes. | Canonical official context, not proof of player outcomes. |

## Confirmation Semantics

- One network has one current stance per issue per patch family.
- A later tap changes the stance/platform/exact-patch timestamp instead of adding another voter.
- A confidently mapped official fix stores the exact claimed patch version and starts its clock.
- Only `Still happening` and `Fixed for me` taps at or after that clock answer the poll while that exact patch is current.
- A claim from `1.13.00` cannot be attributed to `1.13.01`; the later patch needs its own matched claim.
- Only exact-version, post-clock structured reports count as post-claim report evidence. Scanner URLs always remain leads.
- Counts are server-authored. The browser remembers the selected stance but does not optimistically alter public totals.

## Capped Provider Control

The deployment default is:

```env
AUTOMATION_BUDGET_USD_MONTHLY=2
```

The real-scan Tavily ledger is capped at 1,000 credits per month, normally around one base scheduled search credit per run. A scan may spend at most two additional credits on bounded basic context extraction for promising thin pages; Reddit URLs are normalized to `old.reddit.com` first. Protected previews are deterministic and bounded per request but are not written to the scan ledger, so maintainers include their credits when checking the Tavily account remains within 1,000 total monthly credits.

High-value scanner extraction and official fix-claim mapping use only `deepseek/deepseek-v4-flash`. Software caps that lane at $2 per UTC month and applies per-request price ceilings of $0.10 per million prompt tokens and $0.20 per million completion tokens. Routine report moderation and dossier prose use `openrouter/free`, an explicit `:free` model, or deterministic fallback. Confirmation taps make no search, LLM, or captcha call on the happy path.

The deployment should use a dedicated OpenRouter key with a provider-side monthly reset limit of $2 or lower. Maintainers must configure and verify that limit in OpenRouter; the repository cannot inspect the provider dashboard and does not claim the setting is already verified.

## Reddit Policy

Reddit API is permanently off. Do not configure Reddit credentials, direct subreddit monitoring, or Devvit. Tavily may discover public `reddit.com` pages through `site:reddit.com` web queries and may use bounded basic extraction against `old.reddit.com` for promising thin results; those URLs remain scanner leads.

## Source Radar Controls

The role-aware `/scanner` page shows public funnel transparency and mapped lead questions. Authenticated maintainers can also:

- Run a no-publish test scan.
- Run a capped real scan.
- Pause or resume scheduled scans.
- Inspect recent radar leads.
- Search or rescue items from the expiring rejected archive.

## Filtering Rules

Automation rejects broad patch notes, reviews, benchmarks, guides, and vague posts unless there is clear issue language such as crashes, freezes, stutter, launch failure, input lockups, or visual artifacts. Passing the filter may make a link visible; it does not turn the link into evidence.

## No Surprise Spend

CI uses mocks. It should not call production Supabase, Tavily, OpenRouter, or any paid provider. A paid search upgrade, an LLM model other than the approved DeepSeek V4 Flash automation lane, a cap increase, or a new provider requires a separate owner decision.
