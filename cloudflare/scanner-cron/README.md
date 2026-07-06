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

Free-plan fit: an hourly trigger is about 24 Worker requests/day and one external subrequest per run. Cloudflare's current Free plan limits are far above that, so this Worker should stay a scheduler workaround rather than a paid compute dependency.
