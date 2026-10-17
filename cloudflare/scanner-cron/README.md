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
5. Reuse the KV namespace for `ALERT_STATE` as a private display mirror. Add the stable `SCANNER_COORDINATOR` SQLite Durable Object binding and its migration. The object owns dispatch, incident episodes and notification delivery; KV cannot authorize retries.
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

`limited` and `unavailable` remain AI incidents. Idle/skipped wakes cannot prove AI recovery. Healthy AI plus saved clean scan completion permits recovery; reporting-only episodes have the narrower collection recovery rule below. Transport errors and malformed responses use fixed safe codes. Email content excludes upstream messages, source URLs, raw reports, credentials and exception text.

The response must also contain `automation.status`. A charge above its reservation alerts immediately. Other failures alert with their safe boundary code only when the next completed scan also fails; a problem that clears on the next scan sends no email. A `partial` run marked `warningOnly` must have recorded final persistence and only optional reporting failures. One warning stays quiet; two completed-warning scans alert once. Skipped/running wakes preserve the count and cannot recover an incident. A clean saved scan can recover a reporting-only episode with intentionally idle AI; mixed AI/accounting episodes need verified recovery.

The scheduled invocation rejects on keepalive or alert-delivery failure. This makes the failure visible in Cron Trigger history; returning a resolved error `Response` would incorrectly record success.

The keepalive request allows 310 seconds: the application route may run for 300 seconds, with ten seconds reserved for network completion. Cloudflare Cron Triggers permit 15 minutes of wall-clock time, including network waits.

## Execution evidence and failure reporting

Each wake generates a UUID and sends it in `x-scanner-attempt-id`. The app uses that ID for a real run's Supabase row and structured stage logs. Intentional skip rows keep their existing IDs; the Worker records their reason under the trigger ID. A returned database error is a failure even when the client promise resolves. Spending-read failures block provider work. Run creation and completion-write failures cannot be reported as successful scans.

The protected endpoint returns a safe `attempt` object on operational failures, including failures before a database row exists. It contains the ID, start/finish times, outcome, stage/code diagnostics, error count, intended skip reason, known eligibility time, and HTTP status. Failed attempts return HTTP 503; partial attempts return HTTP 200 with `ok: false`. An unavailable database prevents a further AI-history read: `aiHealth` is null and the Worker retains its earlier known successes. Numeric scan counters remain available; private errors and source details are omitted from this response.

The Durable Object owns these records. `ALERT_STATE` KV mirrors only start and completion; the alert key below is retained for one-time legacy import:

| Key | Contents |
| --- | --- |
| `scanner-ai-health-alert-v1` | Legacy alert state; current deduplication and outbox live in the Durable Object |
| `scanner-attempt-start-v1` | Latest trigger ID and start time |
| `scanner-execution-state-v1` | Version 1 latest completion, last successful scheduled scan, last successful AI processing, last failed or partial attempt, and optional bounded AI evidence/retained AI-incident report |

Start and completion use separate keys and one mirror write per attempt. KV can display stale data; it never authorizes dispatch or notification. Supabase run rows and the private operation ledger remain independent history. The mirror retains first/latest failures, bounded AI/checkpoint evidence, and the delivery acknowledgment through skips/recovery. Emails link to those details instead of repeating timing matrices. Corrupt bootstrap fails closed.

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

## Scheduling notes

The next hourly trigger is an opportunity to run, not a promised scan. Policy eligibility is shown separately. Twitch/IGDB collection allows its one-hour interval plus scanner cadence; Steam reviews allow six hours plus cadence. Twitch live counts use a separate two-hour display limit. `patch_burst_active` explains run policy and does not mean the entire scan was skipped.

Automatic scan retries remain deferred. A timed-out write may have committed, and paid requests may already have been billed. Inspect the attempt ID and saved history before trying another scan. Supabase gateway logs remain the evidence needed to determine the internal cause of the audited timeouts; better reporting does not claim to fix that upstream cause.

The execution record covers scheduled triggers. Manual scans and candidate rescue share guarded admission, paid accounting and typed failure diagnostics; they do not manufacture a scheduled trigger record.

## Alert delivery

The object saves `dispatching` before email. Acknowledged delivery becomes `sent`;
an exception, timeout or crash leaves `unknown`, with no automatic resend. Emails
contain impact/action and a private receipt link. First/latest failure evidence
survives skips and recovery.
