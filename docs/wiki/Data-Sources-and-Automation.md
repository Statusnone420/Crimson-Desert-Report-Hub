# Data Sources and Automation

Crimson Desert Report Hub can run as a direct-report tracker first. Optional automation adds public signals when provider access and budget allow it.

## Source Types

| Source | Purpose | Required? |
| --- | --- | --- |
| Direct player reports | Structured anonymous bug reports from the site. | Yes |
| Pearl Abyss patch notes | Current patch metadata and source link. | Yes |
| Tavily web search | Public web discovery for issue reports. | Optional |
| OpenRouter extraction | Converts public snippets into structured issue signals. | Optional |
| Reddit API | Direct subreddit monitoring if approved by Reddit. | Optional |

## Cost Control

The main safety knob is:

```env
AUTOMATION_BUDGET_USD_MONTHLY=0
```

Use `0` to disable paid search and paid extraction. The app can still accept direct reports and show moderated evidence.

## Scanner Controls

Maintainers can use `/admin/source-monitor` to:

- Run a no-publish test scan.
- Run a capped real scan.
- Pause scheduled scans.
- Resume scheduled scans.
- Inspect recent source signals.

## Filtering Rules

Automation is intentionally conservative. It should reject broad patch notes, reviews, benchmarks, guides, and vague posts unless there is clear issue language such as crashes, freezes, stutter, launch failure, input lockups, or visual artifacts.

## Reddit Status

Reddit access is optional and may require explicit Data API approval. If credentials are missing or approval is pending, leave Reddit environment variables empty and rely on direct reports plus other public discovery.

## No Surprise Spend

CI uses mocks. It should not call production Supabase, Reddit, Tavily, OpenRouter, or any paid provider.
