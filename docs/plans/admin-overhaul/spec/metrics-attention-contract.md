# Metric and attention contract

Slice A — meaning of every operator count. Implementation slices must not invent a second definition for the same label.

**Baseline:** `2a0953a` (PR #95). Frozen: 2h cadence / 3 searches per run as the operating baseline; circuit trip rules; budgets; models.

Attention is three families. Mixing them is the bug this contract exists to stop.

| Family | What it is | What it is not | Where to act |
| --- | --- | --- | --- |
| **Owner decisions** | Identifiable items a signed-in operator can complete: flagged reports, pending claim pairings, video candidates, video drafts | Inventory, scanner yield, teaching candidates, locks already set | `/admin`, `/admin/videos` |
| **Operational incidents** | Service/health exceptions: AI health, failed scans, unread registers, delayed/incomplete collections, cost-safety circuit | Owner queues, “the radar is busy” | `/scanner` (inspect; policy only if already authorized) |
| **Background inventory** | Working-set size: awaiting corroboration, tracked leads, screening events, radar yield, weekly composition | Approval work, accuracy, AI health | Observatory (public aggregates) and Scanner records — **watch**, do not treat as Needs you |

A count on Overview or Scanner must expand to **named items** (or a named empty/unavailable state). “3 checks to review” with no identities is a failed readout.

---

## 1. Owner decisions

### Flagged pending reports

| Field | Contract |
| --- | --- |
| Label | Flagged reports / pending reports |
| Source | `bug_reports` where `moderation_status = 'pending'` (`readReportReviewQueue`; brief `flaggedPendingReports`) |
| Unit | Distinct reports |
| Period | Current queue (not 7d) |
| Eligibility | Every pending row, flagged by automation or waiting a first call. Stored status does not remember who last decided |
| Freshness | Live on `/admin` load (`force-dynamic`) |
| Unknown vs zero | Null/failed count **throws**. Zero is All clear **only** when the window list is empty **and** `pendingCount === 0` |
| Next action | Open `/admin`, Approve / Reject / Spam |

Window vs total: the list is capped at 50 (`FLAGGED_WINDOW`); the count is exact. Showing “0 of 3” or hiding the remainder is a defect.

### Pending claim pairings (intended; today this slot is occupied by repeat keyword flags)

| Field | Contract |
| --- | --- |
| Label | Unsure claim matches (today) → **Claim pairings awaiting a call** (intended) |
| Source today | `issue_clusters.lifecycle_reason` like `Needs review:%` and `admin_override = false` |
| Source intended | Durable pairing records in `pending` / `later` (see claim-review contract). Do **not** keep counting a rewritten `lifecycle_reason` after Reject |
| Unit | Distinct pairings (exact patch + exact claim text + cluster), not scans, not keyword hits |
| Period | Open work; `firstSeenAt` / `lastSeenAt` are metadata, not extra counts |
| Eligibility | Engine-owned proposals the operator has not Confirmed or Rejected. Locks excluded. Keyword-only and `llm_unsure` proposals enter pending; `llm_sure` auto-applies without this queue |
| Freshness | Updated on scan (last seen) and on operator write |
| Unknown vs zero | Missing pairing schema: show **unavailable** for this ledger if the new UI is mounted; until then, keep the string-prefix count so rolling deploys do not green-wash. Failed cluster pager must not yield Needs you = 0 |
| Next action | Open `/admin` claim-review: Confirm / Not the same issue / Decide later |

Maintainer locks are **not** owner-decision counts. They are recorded overrides already made.

### Video inbox

| Field | Source | Unit | Next action |
| --- | --- | --- | --- |
| Awaiting review | `video_review_candidates.state = 'pending'` | Candidates | `/admin/videos` Approve draft or Skip |
| Drafts ready | `state = 'draft_ready'` | Drafts | Download later-PR markdown; Archive when done |
| Brief items | ≤8 pending + draft_ready rows | Display only | Same path; no IDs/URLs |

Unknown: schema/access → brief `unavailable` (Keep an eye on), not an empty inbox. `ok` with zeros stays quiet.

Approve is **not** publication. Archive is not a quality verdict.

---

## 2. Operational incidents

### Scan run status (not AI health)

| Field | Contract |
| --- | --- |
| Label | Run status: Completed / Completed with limits / Failed / Skipped / Running / Unknown (`runStatusLabel`) |
| Source | `automation_runs.status` (`success` / `partial` / `failed` / `skipped` / `running`) |
| Unit | Runs |
| Period | Overview strip: latest ≤10 authenticated runs. Scanner “Failed runs · 7d”: rolling 7 days |
| Eligibility | Radar 7d **succeeded** includes both `success` and `partial`. Only `failed` increments failed-run attention. Rescue-only manual runs are excluded from intake funnels |
| Freshness | Overview uses the admin read (no empty-success fallback). Radar health is cached ~300s on public tags; operator `/scanner` is `force-dynamic` for admin data |
| Unknown vs zero | Admin read failure → “Run history unavailable”, not “0 completed”. Radar `connected: false` → lead/run numbers unavailable, not quiet |
| Next action | Open `/scanner` history; do not infer AI health from this field |

**Never** treat Completed or Completed with limits as “AI healthy”. Partial means the scan finished with limits (search/LLM caps, skips). AI may have been blocked, limited, or unused.

Scanner service copy at zero failures: “No failed runs are recorded in the last 7 days. This does not establish a schedule.”

### AI health (single item when co-symptomatic)

| Field | Contract |
| --- | --- |
| Label | AI processing — Available / Unavailable / Limited / Idle (`scannerAiHealth`) |
| Source | Bounded `automation_runs` history via `getScannerAiHealth` / `scannerAiHealth`. Healthy **only** when latest meaningful run has `progress.llmSucceeded > 0` and no relevant failure skip (or limited if some succeeded **and** a failure skip is present) |
| Unit | One health state for the scanner AI lane |
| Period | Latest meaningful completed non-dry, non-skipped, non-running run; `lastSuccessAt` retained separately |
| Eligibility | Ignore `dry_run`, `running`, `skipped`. Idle scans do not clear a prior AI failure. `llm_allowance_exhausted` is **not** an outage. Operator `control.paused` → Idle `scanner_paused`. Saved monthly AI cap `0` → Idle `ai_disabled` |
| Freshness | Same as AI history read; unread → Unavailable `ai_history_unavailable` |
| Unknown vs zero | Unreadable history is Unavailable, not Idle and not healthy. “No AI result recorded yet” is Idle, not a green Available |
| Next action | `/scanner` — inspect skips / integrations; do **not** raise cadence, budgets, models, or circuit from this overhaul |

**Correlation rule (required):** when AI Unavailable/Limited and OpenRouter “paused” are **known co-symptoms of one incident**, show **one** AI health item that names both symptoms.

| Co-symptom bundle (ONE item) | Independent (separate items) |
| --- | --- |
| `aiHealth.state` is `unavailable` or `limited` **and** `llmPaused === true` **and** the AI code is in the cost-safety family: `openrouter_cost_unverified`, `openrouter_circuit_open`, `openrouter_unexpected_charge`, `openrouter_budget_exceeded` | `openrouter_no_route` / missing key / unapproved model / invalid JSON with `llmPaused === false` |
| Circuit open **because** the same cost-unverified / money-anomaly window tripped (`circuit.ts`: 3 unverified in 24h, or month money anomaly) | Operator scanner pause (`control.paused`) — Idle, not OpenRouter paused |
| Status line today may print both `AI UNAVAILABLE` **and** `AI EXTRACTION (OPENROUTER) PAUSED` | `llmPaused === null` (`circuitUnknown`) — say **state unknown**, never PAUSED |
| | Failed runs, collection delays, Tavily disconnected, unread radar |
| | Dossier AI checkbox / provider-smoke (on-demand; not scanner health) |

Display recipe:

1. Prefer AI health message as the title (`FAILURE_MESSAGES` in `health.ts`).
2. If correlated with an open circuit, append one clause: “The cost-safety circuit is also open, so scans continue without LLM extraction until it clears.”
3. Count `Number(aiNeedsAttention)` **once**. Do not also add `pausedIntegrations.length` for the OpenRouter card when the pause is this co-symptom.
4. If OpenRouter is paused and AI history is unread, still one AI item: “AI run history could not be read” + unknown/open circuit named honestly (`null` ≠ open).

`#95` bounded diagnostics explain *why* a cost was unverified; they do not create extra attention items and must not be treated as validated AI.

### Cost-safety circuit (integration badge)

| Field | Source | Unknown vs zero | Next action |
| --- | --- | --- | --- |
| `llmPaused` | `llmPausedFromCircuitRead` over `automation_runs` since `circuitReadStartIso` | `null` = read failed. Engine fails closed (won’t spend). UI must **not** say PAUSED | Inspect `/scanner`; do not reset the circuit from this overhaul |
| OpenRouter paused badge | `applyLlmCircuitToStatuses` | Only when `llmPaused === true` | Correlated into AI health when the rule above matches |

### Collection lanes

| Lane | Source | Period / delay | Attention? | Next action |
| --- | --- | --- | --- | --- |
| Steam reviews | `steam_pulse_snapshots` | 6h interval + scheduled cadence grace | Delayed / no capture / unread = yes; disabled = no | `/scanner` collection |
| Twitch | `platform_context_snapshots` | 1h + cadence grace; stale may still be “On schedule” if last **successful complete** capture is inside window | Incomplete / delayed / unavailable = yes | `/scanner` |
| IGDB | same snapshot | same platform interval | Delayed / unavailable = yes | `/scanner` |

Unknown timestamps → unknown lane, not “no capture = 0”. Missing config → Disabled, not an incident.

### Unread scanner registers

Scoreboard `readFailures`: `week` | `heartbeat` | `awaiting` | `published` (`getPublicScannerData`). Each failed register is its own unknown cell. A failed published read must not blank Awaiting. Disconnected radar is a separate “source radar unavailable” incident, not four zero KPIs.

---

## 3. Background inventory (not approval queues)

### Awaiting corroboration

| Field | Contract |
| --- | --- |
| Label | Awaiting / Awaiting corroboration |
| Source | Scoreboard `awaiting`: current-patch **private-lead** clusters with no public signal **and** no approved report (`queries.ts`) |
| Unit | Distinct clusters |
| Period | Current working set |
| Eligibility | Includes clusters not yet public. Hidden/unsupported/wrong-patch leads excluded by the shared eligibility predicates |
| Freshness | Public scoreboard cached ~300s; say so if the desk needs live |
| Unknown vs zero | `readFailures` includes `awaiting` → `—` / Unavailable |
| Next action | **None required.** Watch. Promotion still needs corroboration. This is **not** the report-moderation queue and **not** claim-review |

Private leads lacking corroboration ≠ approval work. Teaching candidates ≠ awaiting.

### Screening events (“candidates reviewed”)

| Field | Contract |
| --- | --- |
| Label | Candidates reviewed / screened / `reviewedThisWeek` / radar `funnel7d.reviewed` |
| Source | Per intake run `displayCandidateCount`: prefer `funnel.candidatesSeen` (includes Steam Pulse); else legacy `search_results_seen + reddit_posts_seen`. Summed over rolling 7d intake runs |
| Unit | **Screening events**, not unique URLs, not human reviews, not player reports |
| Period | Rolling 7 days (`funnel7d`); scoreboard “this week” uses the same weekly intake window |
| Eligibility | Intake runs only (exclude rescue-only manual). Failed runs still contribute screened counts where recorded; kept/reobserved ignore failed runs |
| Unknown vs zero | Week register unread → Unavailable. A real funnel `candidatesSeen: 0` is authoritative zero for that run |
| Next action | None. Do not file these as Needs you |

Repeat screening of the same URL across runs **increments** this metric. That is expected and must not be presented as “N unique reports” or “N human reviews”.

### Kept / retained leads

| Field | Source | Unit | Not |
| --- | --- | --- | --- |
| Kept · 7d | `signals_inserted` on non-failed intake runs (`funnel7d.kept`, `keptThisWeek`) | New retained signals in the window | Accuracy, evidence, “correct matches” |
| Re-observed · 7d / 24h | `signals_reobserved` per run | Re-observations | Unique leads |
| Tracked leads | Radar current-patch working set (`isCurrentPatchRadarLead`) | Distinct still-tracked leads | Weekly first-seen inventory (below) |
| New leads 24h / 7d | Tracked leads whose first seen is inside the window | Distinct leads first seen | Screening events |

### Radar yield (retained-lead share)

| Field | Contract |
| --- | --- |
| Label | Radar yield |
| Source | `radarYieldPct(keptThisWeek, reviewedThisWeek)` = kept / screened × 100 |
| Unit | Percent |
| Period | Same weekly screening window as `reviewedThisWeek` |
| Eligibility | If `reviewedThisWeek === 0`, display `0%` **only** when the week register was read. Unread week → `—` |
| Unknown vs zero | Unread ≠ 0%. Zero screened with a successful read is 0% selectivity, still not accuracy |
| Next action | None. Caption must remain: share of screened candidates that became a unique tracked lead — **not an accuracy or evidence score** (`observatoryMetrics.ts`) |

### Weekly composition vs rolling 7d totals

Radar `weekly[]` is **still-tracked** leads first seen in that ISO week (archived drop out). It is **not** `funnel7d.reviewed` and **not** `keptThisWeek`. Label: “leads first seen that week and still tracked”. Comparing a weekly column to the 7d funnel as if they were the same series is a spec violation.

### Published issues

`scoreboard.published` = `needsFullIssueCard` on the same decorated board the public Issue Board uses. Unknown if the board read degraded. Not “kept this week”.

### Scanner status line (ACTIVE / PAUSED / CAPPED vs AI)

If AI needs attention, the desk status **overrides** ACTIVE with `AI UNAVAILABLE` / `AI LIMITED`. That override is AI health, not run success. A Completed run can sit under `AI UNAVAILABLE`. CAPPED is last scheduled run hitting a cap skip — operational, separate from owner decisions.

---

## 4. Overview and Scanner attention arithmetic (intended)

### Overview

Today:

```text
unknown = !operatorRead || !scannerRead || scannerReadFailures.length > 0 || collection.status === "unknown"
attentionCount = unknown ? null : collection.attentionCount + (scannerFailedRuns ?? 0) + Number(aiUnavailableOrLimited)
```

**Intended** (still no writes):

1. **Owner-decision row** — named: flagged reports, pending claim pairings, video pending, video drafts. Source the existing queue/brief reads. Unavailable per source; zeros allowed only from successful reads. Sum is optional; identities required. Links to `/admin` / `/admin/videos`.
2. **Operational row** — named incidents using the correlation rule (AI+circuit once), failed 7d runs, collection lanes, unread registers. Links to `/scanner`.
3. Do not add awaiting, yield, teaching-candidate counts, or screening events to either row.
4. Quiet Overview (“Running quietly.” / “No exceptions recorded”) only when **both** rows are known and empty. Owner work must not be hidden behind scanner quiet.

### Scanner “Checks to review”

Today: `failedRuns7d + pausedIntegrations + collection.attentionCount + Number(aiNeedsAttention)`, gated on `healthKnown`.

**Intended:** apply the correlation rule so OpenRouter paused does not increment once already counted as AI health. Keep failed runs and collection checks. Do **not** add awaiting, optional teaching candidates, or funnel reviewed into this number. Caption must list the same identities as the count.

`healthKnown` stays: disconnected radar, unknown circuit, or unknown collection → count **Unknown**, never “Nothing requires intervention.”

---

## 5. Freshness, cadence, and 3 searches / run

| Parameter | Current code | This overhaul |
| --- | --- | --- |
| Scheduled cadence options | 60 / 120 / 360 / 1440 minutes or paused | Do not change production baseline. Documented operating baseline: **120 minutes** |
| Searches per scheduled run | 1 / 2 / 3 | Baseline **3**. Do not retune |
| Code defaults if unset | 60 minutes, 1 search (`DEFAULT_SCANNER_POLICY`) | Unrelated to the operating baseline; do not “fix” defaults here |
| Collection delay grace | provider interval + `cadenceMinutes` | Keep; uses whatever cadence is saved |
| Public radar/scoreboard cache | 300s | Honesty: cached public aggregates may lag the operator desk |

---

## 6. Worked examples (acceptance)

Use these as Slice B/C fixtures. Each “attention count” must list the identities in the right-hand column.

| Situation | Run status | AI health | Circuit badge | Owner decisions | Attention identities |
| --- | --- | --- | --- | --- | --- |
| **Completed run, blocked AI** (`success`, `llmSucceeded=0`, `openrouter_no_route`, `llmPaused=false`) | Completed | Unavailable | not paused | unchanged | **AI processing unavailable** (route). Not “healthy”. Failed-runs 7d unchanged if this run succeeded |
| **Partial run, some validated AI then cap** (`partial`, `llmSucceeded>0`, `llm_budget_capped`) | Completed with limits | Limited | not paused (unless money rules also trip) | unchanged | **AI processing limited** + run is not a failed-run increment |
| **One AI incident, two symptoms** (cost unverified → circuit open; `aiHealth` unavailable `openrouter_cost_unverified` or `openrouter_circuit_open`; `llmPaused=true`) | may be success or partial | Unavailable | OpenRouter paused | unchanged | **One** AI health item naming both. Do not count paused provider separately |
| **Two independent incidents** (AI `openrouter_no_route` **and** a failed run in 7d **and** Steam delayed) | mixed | Unavailable | not paused | unchanged | Three items: AI route, failed run, Steam delayed |
| **Unavailable reads** (radar disconnected **or** AI history unread **or** cluster pager failed) | unknown | unread → Unavailable | maybe unknown | report/claim counts must not fake 0 | Named unavailable; Overview count `—` / Scanner “Unknown”; never “Running quietly” / “All clear” |
| **Stale collection** (Twitch last success still inside window vs older than interval+cadence) | — | — | — | — | Inside window: On schedule (not attention). Beyond grace: Delayed (operational) |
| **No owner decisions** (pending reports 0, no pending pairings, video inbox 0, brief `ok`) | any | any | any | empty | Owner row quiet. Operational row may still have items. Brief stays silent on zeros |
| **Repeat screening** (same URL screened 3 scheduled runs; 1 kept) | Completed ×3 | healthy if validated | — | none | `reviewed` += 3 events; `kept` += 1; yield is selectivity; **Needs you does not move** |
| **Inventory ≠ weekly totals** (10 still-tracked leads first seen last ISO week; rolling 7d screened 40, kept 4; awaiting 6) | — | — | — | none | Three different numbers. Awaiting is not 6 approval tasks. Weekly column is not 40. Yield 10% is not accuracy |
| **Private leads, no corroboration** (awaiting 5, pending reports 0, pending pairings 0) | — | — | — | empty | Inventory 5. Owner decisions 0. Do not put 5 on Needs you |
| **Keyword Needs review every scan, operator Rejected pairing** (intended) | Completed | any | — | 0 for that pairing | Must **not** re-enter pending. Lock unused |
| **Idle scanner pause** (`control.paused`) | next check paused | Idle `scanner_paused` | not OpenRouter paused | unchanged | Not an AI outage. Not correlated with circuit |

---

## 7. Public Observatory

Anonymous `/scanner` and `/observatory` may show aggregate radar/scoreboard **inventory** (reviewed/kept/awaiting/published, charts) with the same unknown-vs-zero rules. They must not grow operator attention, teach controls, or private queues. Provider aggregates remain context, never player evidence.
