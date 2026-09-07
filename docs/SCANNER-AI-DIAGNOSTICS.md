# Scanner AI cost diagnostics

`openrouter_cost_unverified` remains the cost-safety outcome. It means the scanner could not establish a request's cost, not that a timeout or unexpected charge has been proven. The request's configured worst-case cost is reserved, further AI calls in that run stop, and the existing rolling circuit rules still apply.

An overall successful scan may have limited or unavailable AI processing. Use the AI outcome and validated-call count, not the scan status alone.

## Recorded facts

Private run progress can include `openRouterDiagnostics`. It retains at most the latest 32 diagnostic entries, reconstructed from an allowlist. Each entry contains only:

- `code`: one of the codes below.
- `elapsedMs`: a nonnegative integer, capped at the 180,000 ms scan AI deadline.
- `httpStatus`: an observed HTTP status from 100 to 599, or `null` if unavailable.
- `attempts`: an integer from 0 to 3. Request codes use the attempt number within that extraction/mapping call; lookup codes use the generation-lookup attempt number. Missing-cost/ID codes use zero because no lookup has started.

Request elapsed time includes response decoding. Lookup elapsed time is cumulative from the beginning of cost resolution, including retries. A request timeout with an HTTP status means response headers arrived but completion/body parsing did not finish in time. This does not establish whether the provider completed or charged the generation afterward.

| Code | Meaning |
| --- | --- |
| `request_timeout` | The local request/body deadline expired after an attempt started |
| `request_transport_failure` | The chat fetch rejected before returning a response |
| `response_decode_failure` | Reading/decoding the chat response body failed |
| `request_http_failure` | The chat endpoint returned an unsuccessful HTTP status |
| `response_validation_failure` | The decoded model content did not pass application validation |
| `response_cost_missing` | No usable immediate cost was present; cost lookup may follow |
| `response_id_missing` | No response ID was available for the existing generation lookup |
| `generation_lookup_timeout` | A generation-audit request or its body timed out |
| `generation_lookup_transport_failure` | Fetching the generation audit failed |
| `generation_lookup_decode_failure` | Reading/decoding the generation-audit body failed |
| `generation_lookup_http_failure` | The generation endpoint returned an unsuccessful HTTP status |
| `generation_lookup_cost_missing` | A decoded generation audit lacked a usable cost |
| `generation_lookup_deadline` | The shared deadline prevented another lookup/retry |
| `generation_lookup_verified` | The generation audit supplied a usable cost |

These are diagnostic facts, not additional circuit inputs. For example, an initial 404 followed by a verified generation cost and valid model answer remains a successful AI result. An explicitly reported numeric zero remains a verified zero; a missing/invalid cost never becomes zero. An unsuccessful answer does not become healthy merely because its cost was verified.

No request/response bodies, exception messages, keys, URLs, generation IDs, candidate IDs, report text, or rejected content enter these records. Diagnostics do not change provider selection, budgets, timeouts, retries, circuit state, or email policy.

## Read-only inspection

After an authorized deployment, use the existing Supabase connection to inspect only bounded operational fields:

```sql
select started_at, finished_at, status,
       llm_calls_used,
       progress->'llmSucceeded' as validated_ai_calls,
       progress->'openRouterDiagnostics' as ai_diagnostics
from public.automation_runs
where mode <> 'dry_run'
  and progress ? 'openRouterDiagnostics'
order by started_at desc
limit 5;
```

Older rows have no such detail. Do not infer the historical cause from a missing field, total run duration, or the broad skip code. Existing circuit and health tests remain the authority for their behavior. No migration is required for this optional field in the existing progress JSON.

The next useful check is the diagnostic record from a naturally eligible scheduled attempt after an approved deployment. Do not reset the circuit, trigger a paid probe, switch models, increase budgets, or change alert policy just to obtain that record.

## Provider contract checked

[OpenRouter usage accounting](https://openrouter.ai/docs/cookbook/administration/usage-accounting) documents automatic `usage.cost` and the generation-ID lookup. Adding the deprecated usage-inclusion flags is not a fix. [Service tiers](https://openrouter.ai/docs/guides/features/service-tiers) documents Flex's higher latency/lower availability tradeoff; that makes timing worth measuring, not a proven cause for any historical failure.
