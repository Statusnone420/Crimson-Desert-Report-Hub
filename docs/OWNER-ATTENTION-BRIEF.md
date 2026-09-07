# Owner attention brief

This is the read-only connector for the existing **Crimson Hub Health Check** task that already runs every day at 10 AM America/New_York. This change does not create a new schedule, MCP server, or long-lived credential.

The inbox at `/admin/videos` is a manual owner tool. It is not a daily admin job. Approval stores a private later-PR draft only. It never publishes Watch, updates a public registry, or creates a GitHub pull request.

## Connector query

After the hosted migration is applied, the existing Supabase connection should run exactly:

```sql
select public.owner_attention_brief();
```

Do not call this as the anonymous or authenticated browser role. Execute is granted to `service_role` only. Dashboard SQL as the project owner also works for a one-off verification.

## Response shape

```json
{
  "observedAt": "2026-09-07T14:00:00Z",
  "status": "ok",
  "videoInbox": {
    "awaitingReview": { "count": 0, "oldestAgeSeconds": null },
    "draftsReady": { "count": 0, "oldestAgeSeconds": null },
    "items": [
      {
        "title": "Example title",
        "channel": "Example channel",
        "state": "pending",
        "ageSeconds": 3600,
        "reviewReason": "Short private reason, max 80 characters",
        "adminPath": "/admin/videos"
      }
    ]
  },
  "adminAttention": {
    "flaggedPendingReports": 0,
    "unsureClaimMatches": 0,
    "needsYou": 0,
    "reportQueuePath": "/admin",
    "scannerQueuePath": "/scanner"
  }
}
```

`items` is bounded (at most eight). It never includes video IDs, source URLs, report bodies, evidence links, or rejected contents.

`adminAttention` follows current Needs you rules: flagged pending reports plus engine-owned unsure claim matches. Maintainer locks and ordinary reports are not new approval work.

## Status rules

| `status` | Meaning | Brief behavior |
| --- | --- | --- |
| `ok` | Read succeeded | Use counts. If every count is zero, stay quiet. |
| `unavailable` | Missing schema or access | Not an empty queue. Put one Keep-an-eye-on bullet. |
| `error` | Real read failure | Not an empty queue. Do not invent zeros. |

A function or relation that does not exist is unavailable. A permission failure is unavailable (`access_denied`). Other database errors are `error`.

## Five-bullet mapping

Use at most five bullets across **Needs my approval** and **Keep an eye on**. Each bullet is decision, reason, and smallest next step.

- Video candidates waiting → Needs my approval → open `/admin/videos`
- Publication drafts ready → Needs my approval → open `/admin/videos` and start a later PR when you choose
- Flagged pending reports → Needs my approval → open `/admin`
- Unsure claim matches → Needs my approval → open `/admin`
- Unavailable or error → Keep an eye on → apply the migration or inspect the database error

Do not auto-approve, skip, publish, scan, change budgets, or write hosted data from the health check. The schedule itself stays unchanged.

## Website verification

An authenticated admin GET to `/api/admin/video-review-brief` returns the same private JSON with `Cache-Control: private, no-store` and `X-Robots-Tag: noindex`. Use that after deploy, before the scheduled task claims video coverage.

## Hosted rollout

1. Merge this draft PR when you choose.
2. Apply `20260907030544_video_review_inbox.sql` to the hosted project with an explicit production-database authorization. Do not use `supabase db push` from a preview agent.
3. Deploy the application that contains the inbox code.
4. Sign in and open `/admin/videos`. Confirm a genuine empty queue or a genuine unavailable message.
5. Run `select public.owner_attention_brief();` once. Confirm `status` is `ok` before the 10 AM task mentions videos.
