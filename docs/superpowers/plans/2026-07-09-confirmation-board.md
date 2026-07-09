# Confirmation Board Implementation Plan

> **STATUS — IMPLEMENTED ON THE WORKING BRANCH; RECOVERY-AUDIT AMENDMENTS RECORDED 2026-07-09.** This file is now an implementation record, not an active unchecked backlog. The original `- [ ]` boxes are preserved as authored for provenance; they do not mean the work is pending. The confirmation, visibility-guard, and lock-order migrations were explicitly authorized and applied successfully under their final remote versions. This status does not otherwise claim release readiness: unresolved audit findings, fresh verification, deployment, and push remain separate gates with their normal evidence/authorization.

## Recovery-audit amendment

The recovery audit kept the owner-approved counting model and tightened these implementation details. These bullets override older task text below when they conflict:

- `20260709210222_issue_confirmations.sql` adds `fix_claimed_patch_version`, a deny-all `issue_confirmation_attempts` hash/timestamp ledger, and the service-role-only `record_issue_confirmation` RPC.
- The RPC first takes the shared visibility transaction lock, then cluster/network advisory locks, checks public issue visibility inside the transaction, and keeps pruning, the rolling 20-write check, attempt insert, and one-voice stance upsert atomic under concurrent taps. It returns `recorded`, `rate_limited`, or `unknown_issue`.
- Claim provenance is exact-version: a `1.13.00` clock cannot be attributed to `1.13.01`. Only structured reports selected for the exact claimed patch and submitted after its clock count as post-claim report evidence; scanner URLs always remain leads.
- Confirmation totals are server-authored. Successful taps update the locally remembered selected stance and explain that totals refresh from the server; the client does not optimistically bump counts or the server-rendered poll strip.
- Public `/scanner` cards render mapped leads as questions with confirmation controls. A scanner link remains a lead, not evidence.
- `20260709210229_visibility_override_guards.sql` adds a service-role visibility RPC that makes `Force public` / `Force hidden` immediate and atomic; database triggers preserve forced state across concurrent scanner writes. `Auto` only clears the override, normal promotion re-evaluates effective visibility on the next scan, and the action revalidates public pages.
- `20260709212531_visibility_write_lock_order.sql` serializes confirmation and cluster/source visibility decisions before row locks through a fixed transaction advisory lock, closing the recovery audit's concurrent scanner/admin deadlock path.
- Reddit API is permanently off. Tavily `site:reddit.com` web discovery is the only supported Reddit path; bounded basic context extraction normalizes Reddit URLs to `old.reddit.com`, and deployment docs/config contain no Reddit credentials.
- The real-scan Tavily ledger has a 1,000-credit monthly ceiling; bounded deterministic previews consume provider quota outside that ledger and require manual accounting. High-value scanner extraction and official fix-claim mapping use only `deepseek/deepseek-v4-flash` under a $2 UTC-month software cap and per-request price ceilings; routine moderation/dossier prose stays on `openrouter/free`/`:free` or deterministic fallback.
- A dedicated OpenRouter key should have a provider-side monthly reset limit of $2 or lower. Maintainers must configure and verify that setting manually; the repository cannot claim it is already verified.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the verdict-issuing lifecycle model with a counting model: one-tap anonymous player confirmations (new), a single readout composer that derives every displayed state from counts at read time, and surfaces rebuilt around asks instead of verdicts.

**Architecture:** New `issue_confirmations` table + captcha-free upsert endpoint reusing the report privacy stack. New pure `src/lib/readout.ts` composer replaces the five status dialects on all public surfaces. `lifecycle.ts` shrinks to claim-clock management (LLM claim mapper unchanged; silence rule deleted; automation only writes `reported`/`fix_claimed` and normalizes legacy rows). Admin loses the dropdown farm, keeps exceptions + locks, gains the missing visibility-override writer.

**Tech Stack:** Next.js 16 App Router route handlers + server actions, Supabase (service-role, RLS deny-all), Zod 4, Vitest, Playwright visual snapshots. No new dependencies; provider spend is limited to the owner-approved $2 DeepSeek automation lane.

**Authority:** Spec `docs/superpowers/specs/2026-07-09-confirmation-board-design.md` — its §4 state table is the copy/label authority. UI tasks (8, 9, 11) specify exact structure + acceptance rather than full-page JSX dumps; the spec table + existing component idiom govern, and the impeccable skill calibrates final player-facing copy before Task 7.

**Verify after every task:** `npm test` green before commit. Full gates in Task 12.

---

### Task 1: Migration file — `issue_confirmations`

**Files:**
- Create: `supabase/migrations/20260709210222_issue_confirmations.sql`

- [ ] **Step 1: Write the migration.** It was later owner-authorized, applied under remote version `20260709210222`, and verified as recorded in the recovery amendment above.

```sql
-- One-tap anonymous confirmations. One voice per network per issue per patch family;
-- an upsert replaces the voter's stance. Aggregates only ever leave the server.
create table issue_confirmations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  cluster_id uuid not null references issue_clusters(id) on delete cascade,
  patch_family text not null,
  patch_version text not null,
  platform text not null check (platform in ('pc_steam','ps5','ps5_pro','xbox_series_x','xbox_series_s','other')),
  kind text not null check (kind in ('have_it','still_happening','fixed_for_me')),
  voter_ip_hash text not null
);

create unique index idx_confirmations_one_voice
  on issue_confirmations (cluster_id, patch_family, voter_ip_hash);
create index idx_confirmations_cluster on issue_confirmations (cluster_id);
create index idx_confirmations_voter_time on issue_confirmations (voter_ip_hash, created_at desc);

alter table issue_confirmations enable row level security;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260709210222_issue_confirmations.sql
git commit -m "feat: add issue_confirmations table (migration file only)"
```

---

### Task 2: Pure confirmations lib (TDD)

**Files:**
- Create: `src/lib/confirmations.ts`
- Test: `tests/confirmations.test.ts`

- [ ] **Step 1: Write failing tests** — tally math, poll windowing vs `fix_claimed_at`, distinct-network counting, per-platform rollup

```ts
import { describe, expect, it } from "vitest";
import { CONFIRMATION_KINDS, computeClusterConfirmations, type ConfirmationRow } from "@/lib/confirmations";

const row = (over: Partial<ConfirmationRow>): ConfirmationRow => ({
  cluster_id: "c1",
  platform: "pc_steam",
  kind: "have_it",
  voter_ip_hash: "hash-a",
  created_at: "2026-07-09T12:00:00Z",
  ...over,
});

describe("computeClusterConfirmations", () => {
  it("exposes the three kinds", () => {
    expect(CONFIRMATION_KINDS).toEqual(["have_it", "still_happening", "fixed_for_me"]);
  });

  it("counts affected = have_it + still_happening, with distinct networks", () => {
    const t = computeClusterConfirmations(
      [row({}), row({ voter_ip_hash: "hash-b", kind: "still_happening" }), row({ voter_ip_hash: "hash-b", kind: "still_happening" })],
      null,
    );
    expect(t.affectedCount).toBe(3);
    expect(t.affectedNetworks).toBe(2);
    expect(t.pollFixedCount).toBe(0);
    expect(t.pollStillCount).toBe(0); // no claim clock → no poll
  });

  it("fixed_for_me does not count as affected", () => {
    const t = computeClusterConfirmations([row({ kind: "fixed_for_me" })], null);
    expect(t.affectedCount).toBe(0);
  });

  it("poll counts only votes at/after fix_claimed_at", () => {
    const t = computeClusterConfirmations(
      [
        row({ kind: "still_happening", created_at: "2026-07-01T00:00:00Z" }), // pre-claim: affected, not poll
        row({ voter_ip_hash: "hash-b", kind: "still_happening", created_at: "2026-07-09T00:00:00Z" }),
        row({ voter_ip_hash: "hash-c", kind: "fixed_for_me", created_at: "2026-07-09T01:00:00Z" }),
      ],
      "2026-07-08T00:00:00Z",
    );
    expect(t.pollStillCount).toBe(1);
    expect(t.pollStillNetworks).toBe(1);
    expect(t.pollFixedCount).toBe(1);
    expect(t.affectedCount).toBe(2); // both still_happening rows
  });

  it("rolls up every stance into per-platform counts and networks", () => {
    const t = computeClusterConfirmations(
      [row({}), row({ voter_ip_hash: "hash-b", platform: "ps5", kind: "still_happening" })],
      null,
    );
    expect(t.byPlatform.pc_steam).toEqual({ count: 1, networks: 1 });
    expect(t.byPlatform.ps5).toEqual({ count: 1, networks: 1 });
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npm test -- tests/confirmations.test.ts` → FAIL (module not found)

- [ ] **Step 3: Implement**

```ts
export const CONFIRMATION_KINDS = ["have_it", "still_happening", "fixed_for_me"] as const;
export type ConfirmationKind = (typeof CONFIRMATION_KINDS)[number];

export type ConfirmationRow = {
  cluster_id: string;
  platform: string;
  kind: ConfirmationKind;
  voter_ip_hash: string;
  created_at: string;
};

export type ClusterConfirmations = {
  totalCount: number;
  affectedCount: number;
  affectedNetworks: number;
  pollFixedCount: number;
  pollFixedNetworks: number;
  pollStillCount: number;
  pollStillNetworks: number;
  byKind: Record<ConfirmationKind, { count: number; networks: number }>;
  byPlatform: Record<string, { count: number; networks: number }>;
};

export const EMPTY_CLUSTER_CONFIRMATIONS: ClusterConfirmations = {
  totalCount: 0,
  affectedCount: 0, affectedNetworks: 0,
  pollFixedCount: 0, pollFixedNetworks: 0,
  pollStillCount: 0, pollStillNetworks: 0,
  byKind: {
    have_it: { count: 0, networks: 0 },
    still_happening: { count: 0, networks: 0 },
    fixed_for_me: { count: 0, networks: 0 },
  },
  byPlatform: {},
};

/** Aggregate one cluster's confirmation rows. Poll counts only include votes at/after the claim clock. */
export function computeClusterConfirmations(rows: ConfirmationRow[], fixClaimedAt: string | null): ClusterConfirmations
// implementation: affected = kind in (have_it, still_happening); distinct networks via Set of voter_ip_hash;
// poll = claim clock set AND created_at >= clock AND kind in (fixed_for_me, still_happening);
// byKind and byPlatform roll up every stance. Hashes never leave this computation's output.
```

- [ ] **Step 4: Run to verify pass** — `npm test -- tests/confirmations.test.ts` → PASS
- [ ] **Step 5: Commit** — `git commit -m "feat: pure confirmation tally math"`

---

### Task 3: Readout composer (TDD) — the one brain

**Files:**
- Create: `src/lib/readout.ts`
- Test: `tests/readout.test.ts`

- [ ] **Step 1: Failing tests covering every spec §4 state row + threshold edges**

Cases (one `it` each; build inputs with a `base` helper defaulting to all-zero/N=0):
1. locked (`adminOverride: true`, stored `persists`) → label "Still happening", tone crimson, sentence mentions maintainer; stored `verified_fixed` → "Marked fixed by maintainer", amber (public green remains player-poll-only).
2. exact-version structured report submitted after the active exact-patch claim clock → state `still_happening`, crimson; scanner URLs never satisfy this input.
3. poll still ≥2 networks (no evidence) → `still_happening`.
4. poll still = 1 network only → NOT still_happening (stays `fix_claimed_unverified`); sentence includes the sub-threshold count.
5. poll fixed ≥2 networks and > still → `players_say_fixed`, green.
6. tie (fixed=2networks, still=2networks) → `still_happening` wins (conservative).
7. claim clock set, zero answers → `fix_claimed_unverified`, amber, sentence contains "Quiet can mean fixed — or just quiet." and never the word "green"/no green tone.
8. reports > 0, no claim → `confirmed`, crimson.
9. affected confirms ≥2 networks, zero reports, no claim → `confirmed`.
10. affected = 1 network, zero reports → falls through to signals/lead/watching by other counts.
11. visible public source leads only → `public_sources`, amber.
12. candidates only → `radar_lead`, blue, sentence says the scanner lead is a rumor with a link, not evidence.
13. nothing → `watching`, dim, ask is null.
14. N=0 language guard: for every state with zero community input, sentence contains no "waiting on the community"/"players testing" phrasing (assert against the literal strings).
15. legacy stored `verified_fixed` + claim clock + no poll → `fix_claimed_unverified` (not green).

- [ ] **Step 2: Run to verify failure** — `npm test -- tests/readout.test.ts` → FAIL
- [ ] **Step 3: Implement `src/lib/readout.ts`**

```ts
import type { ClusterConfirmations } from "@/lib/confirmations";

export type ReadoutState =
  | "locked" | "still_happening" | "players_say_fixed" | "fix_claimed_unverified"
  | "confirmed" | "public_sources" | "radar_lead" | "watching";

export type IssueReadoutInput = {
  directReportCount: number;
  publicSignalCount: number;
  candidateSignalCount: number;
  postClaimEvidenceCount: number;
  confirmations: ClusterConfirmations;
  fixClaimedAt: string | null; // already sanitized to the current exact patch
  adminOverride: boolean;
  storedFixStatus: string;
  patchVersion: string;
};

export type IssueReadout = {
  state: ReadoutState;
  label: string;
  tone: "crimson" | "amber" | "green" | "blue" | "dim";
  sentence: string;
  ask: { question: string; kinds: ("have_it" | "still_happening" | "fixed_for_me")[] } | null;
  poll: { fixedCount: number; stillCount: number; escalated: boolean } | null;
};

export const DISPLAY_THRESHOLD_NETWORKS = 2;
export function composeIssueReadout(input: IssueReadoutInput): IssueReadout
```

Decision order (first match wins), labels locked by spec §4:
`locked` → stored-status map {reported: "Open"/dim, acknowledged: "Acknowledged"/amber, fix_claimed: "Fix claimed — unverified"/amber, verified_fixed: "Marked fixed by maintainer"/amber, persists: "Still happening"/crimson}, sentence "Set by the maintainer." + underlying-count sentence; ask still offered per exact-patch claim context.
Claim context = `fixClaimedAt != null` after queries verify `fixClaimedPatchVersion === currentPatchVersion`; a stored claim-like status alone never opens or carries a poll.
1 `claimContext && (postClaimEvidenceCount > 0 || pollStillNetworks >= 2)` → Still happening / crimson.
2 `claimContext && pollFixedNetworks >= 2 && pollFixedCount > pollStillCount` → Players say fixed / green.
3 `claimContext` → Fix claimed — unverified / amber; zero-answer sentence "Pearl Abyss says <patch> fixed this. Quiet can mean fixed — or just quiet."; sub-threshold counts appear in the sentence ("1 player so far says …").
4 `directReportCount > 0 || affectedNetworks >= 2` → Confirmed by players / crimson.
5 `publicSignalCount > 0` → Public sources / amber.
6 `candidateSignalCount > 0` → Radar lead / blue, "The scanner spotted this. A lead is a rumor with a link, not evidence."
7 → Watching / dim, ask null.
Poll object present iff claim context. Ask kinds: claim context → `["fixed_for_me","still_happening"]`, question "Played since <patch> — fixed for you?"; else states 4–6 → `["have_it"]`, "Do you have this?".

- [ ] **Step 4: Run to verify pass** — `npm test -- tests/readout.test.ts` → PASS
- [ ] **Step 5: Commit** — `git commit -m "feat: issue readout composer — one brain for all displayed states"`

---

### Task 4: Confirmation endpoint (TDD)

**Files:**
- Create: `src/app/api/confirmations/route.ts`
- Test: `tests/confirmationsRoute.test.ts` (mirror `tests/reportsRoute.test.ts` mocking idiom: hoisted cache mock, table-switch service client, `x-forwarded-for`)

- [ ] **Step 1: Failing tests**

```ts
// state: rpcResult / rpcError; mock record_issue_confirmation RPC outcomes
// mock @/lib/officialPatch.server getCurrentPatchMetadata → { version: "1.13.01", publishedAt: "2026-07-08T00:00:00Z", ... }
const valid = { cluster_id: "3f2f5a1e-0000-4000-8000-000000000001", platform: "ps5", kind: "still_happening" };
```
1. 403 on Vercel preview, no RPC.
2. 403 when cross-site or when both trusted browser-origin signals are absent → no RPC.
3. 400 on invalid json / bad kind / bad platform / non-uuid cluster_id.
4. 400 when no client IP (no `x-forwarded-for`) — one-voice needs a hash.
5. 404 when `record_issue_confirmation` returns `unknown_issue` from its in-transaction public-cluster check.
6. 429 when `record_issue_confirmation` returns `rate_limited` at the atomic trailing-hour limit.
7. 201 happy path: RPC called once with patch family `1.13`, exact patch `1.13.01`, platform, kind, and sha256 `voter_ip_hash`; raw IP absent from arguments; revalidateTag called for `public-dashboard` and `public-issues` with `"max"`.

- [ ] **Step 2: Run to verify failure** → FAIL (route missing)
- [ ] **Step 3: Implement route**

```ts
import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { z } from "zod";
import { PUBLIC_DASHBOARD_TAG, PUBLIC_ISSUES_TAG } from "@/lib/cacheTags";
import { CONFIRMATION_KINDS } from "@/lib/confirmations";
import { PLATFORMS } from "@/lib/constants";
import { hashIp } from "@/lib/crypto";
import { requiredEnv } from "@/lib/env";
import { getCurrentPatchMetadata } from "@/lib/officialPatch.server";
import { patchFamilyKey } from "@/lib/patchWatch";
import { isVercelPreview } from "@/lib/previewGuard";
import { createServiceClient } from "@/lib/supabase";

const confirmationSchema = z.object({
  cluster_id: z.uuid(),
  platform: z.enum(PLATFORMS),
  kind: z.enum(CONFIRMATION_KINDS),
});

function isSameOrigin(req: Request): boolean {
  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite) return fetchSite === "same-origin" || fetchSite === "none";
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try { return new URL(origin).host === new URL(req.url).host; } catch { return false; }
}
// POST: previewGuard → strict origin/content type → parse/validate → ip? 400 →
// derive patch server-side → record_issue_confirmation RPC (public check + atomic limit/upsert) →
// unknown_issue 404; rate_limited 429; RPC error/unknown outcome 500; recorded revalidates → 201
```

- [ ] **Step 4: Run to verify pass** — `npm test -- tests/confirmationsRoute.test.ts` → PASS. Check Next 16 route-handler doc (`node_modules/next/dist/docs/`) if any handler-signature doubt.
- [ ] **Step 5: Commit** — `git commit -m "feat: one-tap confirmation endpoint (captcha-free, hash-deduped)"`

---

### Task 5: Shrink the lifecycle engine (TDD)

**Files:**
- Modify: `src/lib/lifecycle.ts` (delete silence rule; two writable states; normalize legacy)
- Modify: `src/lib/automation/run.ts:799-976` (drop evidence loaders + `now`/evidence plumbing that the shrunk input no longer needs; delete `loadLifecycleReports`, `loadLifecyclePublicSignals`, `countLifecyclePublicPostHotfixEvidence`, `incrementCount` if orphaned)
- Test: rewrite `tests/lifecycle.test.ts`; adjust `tests/automationRun.test.ts` if it exercises the pass

- [ ] **Step 1: Rewrite lifecycle tests to the new contract**

New `computeClusterLifecycle` input: `{ currentStatus, fixClaimedAt, fixClaimedPatchVersion, currentPatchVersion, adminOverride, now, claimDecision }` (no `publicPostHotfixEvidenceCount`). Cases:
1. `llm_sure` claim, status `reported`, no current exact-patch clock → status `fix_claimed`, `fixClaimedAt = now`, `fixClaimedPatchVersion = currentPatchVersion`, `needsHuman` false.
2. existing clock whose stored exact version equals `currentPatchVersion`, decision none → stays `fix_claimed`, clock/version preserved (no silence transition — assert after simulating 30 days: still `fix_claimed`).
3. a clock from another exact patch is cleared unless the current patch has its own sure mapped claim; legacy claim-like status without an exact current clock does not carry claim context forward.
4. legacy `acknowledged`, no claim → normalized to `reported`.
5. `llm_unsure` → status unchanged, `needsHuman` true, detail starts "Needs review:".
6. `keyword_proposal` → same as 5 (proposal-only, never writes claim state).
7. `adminOverride` → status/clock untouched, detail explains lock + what the system would do, `needsHuman` false.
8. `LIFECYCLE_LABELS` no longer exports a green-coded "No fresh reports" mapping for automation writes; the export shrinks to admin-facing labels {reported: "Open", acknowledged: "Acknowledged", fix_claimed: "Fix claimed — unverified", verified_fixed: "Marked fixed by maintainer", persists: "Still happening"}.

- [ ] **Step 2: Run to verify failure** → FAIL
- [ ] **Step 3: Implement** — `SILENCE_WINDOW_DAYS` deleted; result statuses only `reported`/`fix_claimed` for non-override paths; `writeLifecycleResult` keeps its optimistic guards; `shouldWriteReason` becomes `computed.needsHuman` only (the pass stops writing prose for normal states — the readout composes prose at read time); `runLifecyclePass` drops the evidence loads (claim mapping loop unchanged).
- [ ] **Step 4: Run full unit suite** — `npm test` → PASS (fix any dependent tests: `rightNow.test.ts`, `patchWatch.test.ts` untouched until Task 9).
- [ ] **Step 5: Commit** — `git commit -m "refactor: lifecycle engine shrinks to claim-clock + exceptions; silence verdict deleted"`

---

### Task 6: Queries — confirmation aggregates + per-platform tallies

**Files:**
- Modify: `src/lib/queries.ts` (both `getDashboardDataUncached` and `getIssuesDataUncached` cluster mapping)
- Test: extend `tests/queries.test.ts` (pure helpers only, matching its existing style)

- [ ] **Step 1: Failing test for the new pure helper**

```ts
// confirmationRowsByCluster(rows) groups raw rows; clusterConfirmationsFor(map, clusterId, fixClaimedAt)
// returns computeClusterConfirmations output or EMPTY_CLUSTER_CONFIRMATIONS.
// reportPlatformCountsByCluster(rows) → Record<clusterId, Record<platform, number>>
```

- [ ] **Step 2: Verify failure, implement**

New query (privacy boundary comment, mirrors `getCandidateSignalCountsByCluster`): select `cluster_id, platform, kind, voter_ip_hash, created_at` from `issue_confirmations` where `patch_family = patchFamilyKey(currentPatch.version)`; group per cluster server-side; **only aggregates leave `queries.ts`**. Cluster mapping gains: `confirmations: ClusterConfirmations`, `reportPlatformCounts: Record<string, number>`, and `readout: composeIssueReadout({...})` so pages never compose states themselves. `strengthScore` gains escalated confirmations: `signalCount + directReportCount * 3 + (confirmations.affectedNetworks >= 2 ? confirmations.affectedCount : 0)`.

- [ ] **Step 3: Run suite** — `npm test` → PASS
- [ ] **Step 4: Commit** — `git commit -m "feat: confirmation aggregates + per-platform tallies in public queries"`

---

### Task 7: ConfirmButtons client component

**Files:**
- Create: `src/components/ConfirmButtons.tsx`
- Invoke the impeccable skill first to calibrate final player-facing copy (memory mandate); spec §4 strings remain authority on meaning.

- [ ] **Step 1: Implement** (no unit test — exercised via e2e snapshots + N=0 walkthrough; client component)

Props: `{ clusterId: string; patchFamily: string; ask: { question: string; kinds: ConfirmationKind[] }; counts: Record<ConfirmationKind, number> }`.
Behavior: kind button → required platform picker row appears (PLATFORM_LABELS) → POST `/api/confirmations` → persist the accepted stance in `localStorage` (`cd-confirm-<clusterId>-<patchFamily>` = kind) and show `Recorded once per network per patch. Counts refresh from the server; you can change your answer.` The selected stance is toned but remains changeable. Do **not** optimistically alter any count: localStorage cannot prove the server's network-dedup identity, and the poll strip is server-rendered. Errors: 429 → "Too many taps from this network — try again later."; other → "Didn't count. Try again."
Idiom: `.cbtn`-style chips using existing badge/btn classes from `globals.css`; buttons show counts only when > 0 (N=0 calm).

- [ ] **Step 2: Manual render check** comes in Task 12 (mock server); `npm exec tsc -- --noEmit` clean now.
- [ ] **Step 3: Commit** — `git commit -m "feat: one-tap ConfirmButtons with required platform pick"`

---

### Task 8: Issues page on the readout

**Files:**
- Modify: `src/app/issues/page.tsx`
- Modify: `src/components/ui.tsx` (FixStatusBadge: delete `hideIfLabel` + `unverified` remaps; add `ReadoutBadge` mapping tone→badge class)
- Modify: `src/lib/evidence.ts` only if `isUnverifiedWatchlistCluster` orphans (it feeds the deleted badge path)

- [ ] **Step 1: Rebuild `ClusterCard`**
Structure per spec §5: header (title + ONE `ReadoutBadge`) → readout sentence line (replaces `status.strengthLabel`/`lifecycle_reason` composite) → per-platform tally rows (reports + escalated confirms, `meter` fills; sub-threshold counts render dim text, no fill) → poll strip when `readout.poll` (two counts + escalated bar) → `ConfirmButtons` when `readout.ask` → existing signals links (drop `SignalConfidenceBadge`; show host + "Open source") → approved excerpts unchanged. Watchlist cards: same readout pattern (state `radar_lead`/`watching`), "I'm seeing this → /report" link replaced by ConfirmButtons + a quiet "Full report →" link.
- [ ] **Step 2: Gates** — `npm test && npm exec tsc -- --noEmit` → PASS (update `tests/evidenceLadder.test.ts`/`evidence.test.ts` only if exports changed).
- [ ] **Step 3: Commit** — `git commit -m "feat: issues cards read from the composer — one badge, tallies, asks"`

---

### Task 9: Dashboard + right-now on the readout

**Files:**
- Modify: `src/app/page.tsx`, `src/lib/rightNow.ts`
- Test: rewrite affected cases in `tests/rightNow.test.ts`

- [ ] **Step 1: `rightNow.ts`** — `worthChecking` items take `label/tone/detail` from `cluster.readout` (drop `playerIssueStatus` import); `actionLabel` becomes `"Add your tap"` when `readout.ask` else `"View evidence"`; observations/snapshot line unchanged except lead phrasing ("radar lead" not "private lead awaiting corroboration").
- [ ] **Step 2: `page.tsx`** — hero subline verbs; stat row: replace "Awaiting corroboration" card with "Radar leads" (`candidates.length`) noted "rumors with links — not evidence"; replace `FixStatusBadge`/`statusTone` on top-issues rows with `ReadoutBadge`/`readout.tone`; "Still reported after claimed fix" section keys off `readout.state === "still_happening"`; watchlist mini-cards use readout; delete the green `verified_fixed → green` `statusTone` map entirely.
- [ ] **Step 3: Gates + commit** — `npm test` PASS → `git commit -m "feat: dashboard counts and asks; green silence removed"`

---

### Task 10: Admin — exceptions only

**Files:**
- Modify: `src/app/admin/page.tsx`, `src/app/admin/actions.ts`
- Test: extend `tests/adminActions.test.ts`

- [ ] **Step 1: Failing test for the new visibility action** — `setClusterVisibilityOverride` writes `admin_visibility_override` ∈ {`auto` → null, `force_public`, `force_hidden`} guarded by `requireAdmin` + `assertProductionWriteAllowed`, revalidates public surfaces; rejects bad values.
- [ ] **Step 2: Implement action; rework page**
Page: delete the all-clusters dropdown farm `<details>` (admin/page.tsx:167-213). New "Exceptions" section renders ONLY: clusters with `lifecycle_reason` starting "Needs review:" and clusters with `admin_override`. Each row: title, current readout label, reason, lock select (options `reported`/`fix_claimed`/`verified_fixed`/`persists` labeled via `LIFECYCLE_LABELS` — `acknowledged` removed from UI), Lock/Clear buttons (existing actions). Below it a compact collapsed "Visibility overrides" `<details>`: every cluster, 3-way select (Auto / Force public / Force hidden) + current `is_public` state. "Needs you" arithmetic unchanged.
- [ ] **Step 3: Gates + commit** — `git commit -m "feat: admin is exceptions-only; visibility override finally has a writer"`

---

### Task 11: Scanner reframe (light)

**Files:**
- Modify: `src/components/scanner/PublicScannerView.tsx`, `src/components/scanner/AdminScannerView.tsx` (read both first — copy-level changes only)

- [ ] **Step 1: Public view** — leads copy: "kept signals" framed as radar hearsay ("what the radar is hearing — not evidence"); no confidence chrome on anything public-facing.
- [ ] **Step 2: Admin view** — "Review queue" header + framing becomes "Rejected archive (auto-expires)"; keep rescue buttons; the count chip stops implying pending work ("29" → "29 expiring").
- [ ] **Step 3: Gates + commit** — `git commit -m "refactor: scanner queue reads as archive, leads read as hearsay"`

---

### Task 12: Sweep, gates, snapshots, N=0 proof

**Files:**
- Modify: `src/lib/patchWatch.ts` (delete `playerIssueStatus` + `publicPatchWatchItem` if fully orphaned; keep patch utilities), `tests/patchWatch.test.ts`, `tests/e2e/mock-dev-server.mjs` (+ regenerate `tests/e2e/__screenshots__`)

- [ ] **Step 1: Orphan sweep** — grep gates: `hideIfLabel` zero hits; `playerIssueStatus` zero imports; no user-facing green "No fresh reports"; no card renders two status badges. Delete only what THIS change orphaned (AGENTS.md rule).
- [ ] **Step 2: Full gates** — `npm run lint` · `npm test` · `npm exec tsc -- --noEmit` · `npm run build` → all green.
- [ ] **Step 3: E2E** — read `tests/e2e/mock-dev-server.mjs`; extend fixtures for confirmations if it stubs Supabase data; `npm run test:e2e:update` to regenerate snapshots (if Playwright browsers unavailable locally, record that and leave snapshots for CI).
- [ ] **Step 4: N=0 walkthrough** — dev server without Supabase env (queries fall back to empties): dashboard/issues/scanner must render calm, complete, non-begging states; screenshot proof.
- [ ] **Step 5: Final commit** — `git commit -m "chore: retire orphaned status dialects; regenerate visual snapshots"`

---

## Self-review

- **Spec coverage:** §3 schema→T1, semantics/API/privacy→T2/T4/T6; §4 composer/state table→T3, lifecycle changes→T5, retired dialects→T8/T9/T12; §5 issues→T8, dashboard→T9, scanner→T11, admin (incl. visibility writer)→T10; §7 verification→per-task gates + T12. §6 follow-ups intentionally unplanned. No gaps found.
- **Placeholders:** UI tasks 8/9/11 are directive-style by declared design (executor = same-session agent with spec §4 as copy authority); all logic-bearing tasks carry code/tests. No TBDs.
- **Type consistency:** `ClusterConfirmations` (T2) is the type consumed by `IssueReadoutInput.confirmations` (T3) and produced in queries (T6); `CONFIRMATION_KINDS` shared by route (T4) and component (T7); `LIFECYCLE_LABELS` admin-only after T5, consumed by T10. Checked.
