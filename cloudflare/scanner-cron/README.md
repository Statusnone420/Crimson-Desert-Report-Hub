# Crimson Report Hub Scanner Cron

Tiny Cloudflare Worker Cron trigger for waking the protected scanner endpoint hourly.

Required secret:

```powershell
npx wrangler secret put CRON_SECRET --config cloudflare/scanner-cron/wrangler.jsonc
```

Deploy:

```powershell
npx wrangler deploy --config cloudflare/scanner-cron/wrangler.jsonc
```

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
5. Reuse or explicitly create one KV namespace for `ALERT_STATE`, then replace the template namespace ID. The Worker stores only the current safe incident code so repeated hourly checks send one alert and one recovery.
6. Set `CRON_SECRET` with `wrangler secret put`; never add it to either Wrangler file.
7. Validate the substituted staging file with Wrangler (`deploy --dry-run`). The template was checked with Wrangler 4.129.0. Keep `remote: false` during local checks because a remote Email Service binding sends real mail. Add the hourly trigger only to the reviewed deployment configuration.

The keepalive response must be JSON with `ok: true` and this field:

```ts
aiHealth: {
  state: "healthy" | "unavailable" | "limited" | "idle";
  code: string | null;
  message: string;
  lastSuccessAt: string | null;
}
```

`limited` and `unavailable` are alert incidents. `idle` preserves any existing incident because a skipped scan is not a recovery. `healthy` sends one recovery after an incident. Transport errors, non-success HTTP responses, malformed JSON, and `ok: false` use fixed generic codes. Email content never includes the response message, response body, raw reports, private URLs, credentials, or exception text.

The response must also contain `automation.status`. `failed` and `partial` create `scanner_run_failed` and `scanner_run_partial` incidents even when historical AI health is healthy. `skipped` and `running` preserve an existing incident. Only `automation.status: "success"` with healthy AI health can send recovery.

The scheduled invocation rejects on keepalive or alert-delivery failure. This makes the failure visible in Cron Trigger history; returning a resolved error `Response` would incorrectly record success.

The keepalive request allows 310 seconds: the application route may run for 300 seconds, with ten seconds reserved for network completion. Cloudflare Cron Triggers permit 15 minutes of wall-clock time, including network waits.
