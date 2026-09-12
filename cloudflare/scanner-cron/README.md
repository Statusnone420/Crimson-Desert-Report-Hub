# Crimson Report Hub Scanner Cron

Tiny Cloudflare Worker Cron trigger for waking the protected scanner endpoint hourly.

Required secret:

```powershell
npx wrangler secret put CRON_SECRET --config cloudflare/scanner-cron/wrangler.jsonc
```

For a new installation without alert bindings, deploy the checked-in configuration:

```powershell
npx wrangler deploy --config cloudflare/scanner-cron/wrangler.jsonc
```

For the existing production Worker, use its reviewed deployment configuration that includes the live email and KV bindings. Deploying the minimal checked-in configuration would remove those bindings. Keep production addresses and secrets out of Git.

The Worker only wakes `/api/cron/keepalive`. Scanner cadence, Tavily credits, and LLM spend are enforced inside the app's admin-controlled scanner policy.

This Worker is scheduled-only: `workers_dev` and preview URLs are disabled, and the script intentionally has no public `fetch` handler. The only production trigger should be Cloudflare Cron calling `scheduled()`, which forwards the stored `CRON_SECRET` to the app.

The configured hourly trigger is about 24 Worker requests and 24 external subrequests per day. Check the current Cloudflare plan limits before rollout; this repository does not treat a provider plan limit as a stable code contract.

## Optional scanner AI alerts

Alerts are disabled unless all four optional bindings are configured: `ALERT_EMAIL`, `ALERT_STATE`, `ALERT_SENDER`, and `ALERT_RECIPIENT`. The checked-in production configuration intentionally omits them. `wrangler.alerts.example.jsonc` is an inert staging template: it has no Cron trigger, uses local email simulation, and contains placeholders instead of addresses or namespace IDs.

Setup requires these manual Cloudflare account steps:

1. Enable Email Routing for a Cloudflare-managed domain.
2. Add the intended recipient under **Email Routing → Destination Addresses**, then complete the verification email. Sends to verified destination addresses are free on all plans.
3. Use a sender address on an Email Service onboarded domain. Put that exact address in both `ALERT_SENDER` and `allowed_sender_addresses`.
4. Put the verified recipient in `ALERT_RECIPIENT` and `destination_address`. These binding restrictions prevent the Worker from sending elsewhere.
5. Reuse or explicitly create one KV namespace for `ALERT_STATE`, then replace the template namespace ID. The Worker stores the current safe incident code plus the bounded execution records described below. Repeated checks with the same incident code send one alert and one recovery.
6. Set `CRON_SECRET` with `wrangler secret put`; never add it to either Wrangler file.
7. Validate the substituted staging file with Wrangler (`deploy --dry-run`). The template was checked with Wrangler 4.129.0. Keep `remote: false` during local checks because a remote Email Service binding sends real mail. Add the hourly trigger only to the reviewed deployment configuration.

Successful keepalive responses contain `ok: true`, `automation.status`, and this field:

```ts
aiHealth: {
  state: "healthy" | "unavailable" | "limited" | "idle";
  code: string | null;
  message: string;
  lastSuccessAt: string | null;
}
```

`limited` and `unavailable` are alert incidents. `idle` preserves any existing incident because a skipped scan is not a recovery. `healthy` sends one recovery after an incident. Transport errors and malformed responses use fixed generic codes. Email content never includes upstream response messages, raw reports, private URLs, credentials, or exception text.

The response must also contain `automation.status`. `failed` and `partial` create `scanner_run_failed` and `scanner_run_partial` incidents even when historical AI health is healthy. `skipped` and `running` preserve an existing incident. Only `automation.status: "success"` with healthy AI health can send recovery.

The scheduled invocation rejects on keepalive or alert-delivery failure. This makes the failure visible in Cron Trigger history; returning a resolved error `Response` would incorrectly record success.

The keepalive request allows 310 seconds: the application route may run for 300 seconds, with ten seconds reserved for network completion. Cloudflare Cron Triggers permit 15 minutes of wall-clock time, including network waits.

## Execution evidence and failure reporting

Each wake generates a UUID and sends it in `x-scanner-attempt-id`. The app uses that ID for a real run's Supabase row and structured stage logs. Intentional skip rows keep their existing IDs; the Worker records their reason under the trigger ID. A returned database error is a failure even when the client promise resolves. Spending-read failures block provider work. Run creation and completion-write failures cannot be reported as successful scans.

The protected endpoint returns a safe `attempt` object on operational failures, including failures before a database row exists. It contains the ID, start/finish times, outcome, stage/code diagnostics, error count, intended skip reason, known eligibility time, and HTTP status. Failed attempts return HTTP 503; partial attempts return HTTP 200 with `ok: false`. An unavailable database prevents a further AI-history read: `aiHealth` is null and the Worker retains its earlier known successes. Numeric scan counters remain available; private errors and source details are omitted from this response.

Existing `ALERT_STATE` KV holds three fixed keys:

| Key | Contents |
| --- | --- |
| `scanner-ai-health-alert-v1` | Existing alert deduplication state |
| `scanner-attempt-start-v1` | Latest trigger ID and start time |
| `scanner-execution-state-v1` | Version 1 latest completion, last successful scheduled scan, last successful AI processing, and last failed or partial attempt |

Start and completion use separate keys because KV permits at most one write per second to a key. KV is eventually consistent; allow about a minute for evidence to appear. This is a latest-state record, not a complete archive. The console labels seven-day counts **Recorded failed runs** because the Supabase aggregate cannot count attempts that failed before creating a row. A later successful scan preserves the previous failure for inspection. Corrupt previous state is reported and left intact rather than replaced with empty history.

Structured `scanner_attempt_started`, `scanner_attempt_completed`, `scanner_request_started`, `scanner_stage_started`, and `scanner_request_completed` events contain safe IDs/codes/times. Workers observability is enabled at full sampling for this low-volume hourly trigger. If execution-record persistence itself fails, the invocation rejects and the email/log identifies that failure. If no completion is saved, the console marks it missing after six minutes. A successful completion older than 90 minutes becomes an overdue heartbeat; this names the observed gap without inventing its internal cause.

## Connect the private operator console

Configure these **server-only Vercel Production** values before release:

| Variable | Value |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | The scanner Worker's Cloudflare account ID |
| `CLOUDFLARE_SCANNER_KV_NAMESPACE_ID` | Its existing `ALERT_STATE` namespace ID |
| `CLOUDFLARE_SCANNER_STATUS_TOKEN` | Dedicated API token with **Workers KV Storage Read**, restricted to that account |

Use the narrowest account resource scope Cloudflare supports. The application reads only the two fixed execution keys; the API token's permission is account-scoped. It needs no KV write, deployment, or email permission. Store it through Vercel's secret configuration; never paste it into an issue, PR, source file, or chat. Do not repurpose the local Wrangler OAuth token.

The reader checks the admin session before accessing Cloudflare, uses a fixed API origin, a four-second deadline, a 32 KiB response limit, no redirects, and no cache. Preview deployments never read production trigger evidence. Missing setup, denied access, invalid data, rate limiting, and timeouts have separate explanations. Two missing keys are accepted as a pending first capture only after the namespace itself is verified. A failed Supabase admin read still permits the private trigger card to render, with scan controls hidden.

## Release and verification

1. Review the draft PR and its CI checks. No hosted migration, query-pack change, or added dependency is needed.
2. Configure the private status reader. Deploy the Vercel application and then the Worker using the production configuration with its existing bindings intact. The new Worker accepts the older response shape too; it recognizes legacy `budget_read_failed` skips as failures during rollout.
3. Read the live Worker schedule, version, email/KV bindings, and Vercel deployment SHA. Verify the public routes still return HTTP 200.
4. Observe an ordinary hourly wake. Match the trigger ID to the Vercel stage log and, when a scan runs, its Supabase row. Confirm the completion, last-success times, provider captures, and private console agree. A legitimate `recent_run`, `paused`, or `scan_already_running` skip must retain its reason and must not send recovery.
5. Keep production failure injection and forced scans out of this verification. Local tests exercise budget reads, row creation, progress writes, finalization, malformed responses, alert delivery, and KV failures.

The next hourly trigger is an opportunity to run, not a promised scan. Policy eligibility is shown separately. Twitch/IGDB collection allows its one-hour interval plus scanner cadence; Steam reviews allow six hours plus cadence. Twitch live counts use a separate two-hour display limit. `patch_burst_active` explains run policy and does not mean the entire scan was skipped.

Automatic scan retries remain deferred. A timed-out write may have committed, and paid requests may already have been billed. Inspect the attempt ID and saved history before trying another scan. Supabase gateway logs remain the evidence needed to determine the internal cause of the audited timeouts; better reporting does not claim to fix that upstream cause.

The execution record covers scheduled trigger attempts. Manual full scans share the typed run diagnostics, but the separate candidate-rescue action retains its existing reporting contract and does not create a scheduled trigger record.
