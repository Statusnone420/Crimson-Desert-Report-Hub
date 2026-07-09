# Report Hub Right Now Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework Crimson Desert Report Hub so the public homepage answers "what is happening right now?" using automation, reports, official links, and source transparency without becoming a patch notes site or a bug tracker dead end.

**Architecture:** Add one pure presentation transformer that converts existing dashboard/scanner data into a Right Now readout, then render that readout on the homepage with focused components. Keep Supabase queries, scanner privacy boundaries, and admin mechanics intact; this is an information architecture and UI pass, not a database expansion.

**Tech Stack:** Next.js 16 App Router, React 19 Server Components, TypeScript, Tailwind CSS utilities plus existing CSS tokens, Vitest, Playwright.

## Global Constraints

- Work on the existing branch `feat/player-useful-patch-watch`.
- The product name remains **Crimson Desert Report Hub**.
- Do not call the product "Patch Brief."
- Do not build a blog, notes system, CMS, or creator archive in this pass.
- Do not add new database tables.
- Do not add new runtime dependencies.
- Homepage first screen must lead with current situation outcomes before scanner mechanics.
- Public pages must not expose private scanner candidate text, raw URLs, or reject reasons.
- Official patch notes are context, not proof.
- One direct report is early evidence, not consensus.
- Keep the existing restrained dark product UI and semantic color system.
- Run `npm run lint`, `npm test`, `npm exec tsc -- --noEmit`, and `npm run build`.
- Capture screenshot validation for homepage, issues, report, about, scanner on desktop and homepage/issues on mobile.

---

## File Structure

- Create `src/lib/rightNow.ts`: pure transformer and types for the homepage readout. No database access, no server-only imports.
- Create `src/components/RightNowHub.tsx`: server-safe presentation component for the homepage first screen and supporting sections.
- Modify `src/app/page.tsx`: fetch existing dashboard/scanner data, build the readout, render the new homepage structure.
- Modify `src/components/NavLinks.tsx`: rename labels without narrowing the whole site to bug tracking.
- Modify `src/lib/site.ts` and `src/app/layout.tsx`: update metadata to current-situation hub language.
- Modify `src/app/issues/page.tsx`: keep stricter evidence ledger, adjust labels and early-evidence wording.
- Modify `src/app/report/ReportForm.tsx`: reframe reports as adding a case to the hub's current situation.
- Modify `src/app/about/page.tsx`: explain the broader hub and future content lanes without adding those features.
- Modify `src/components/scanner/PublicScannerView.tsx`: position scanner as Source Radar / operator transparency.
- Modify `tests/patchWatch.test.ts` only if status helper expectations change.
- Create `tests/rightNow.test.ts`: transformer coverage.
- Modify `tests/e2e/public-visual.spec.ts`: public copy, nav, privacy, screenshot assertions.

---

### Task 1: Add Right Now Transformer

**Files:**
- Create: `src/lib/rightNow.ts`
- Create: `tests/rightNow.test.ts`

**Interfaces:**
- Consumes: dashboard-like data from `getDashboardData()`, scanner-like data from `getPublicScannerData()`, `playerIssueStatus(input)` from `src/lib/patchWatch.ts`.
- Produces:
  - `type RightNowIssue`
  - `type RightNowReadout`
  - `function buildRightNowReadout(input: RightNowInput): RightNowReadout`

- [ ] **Step 1: Write failing transformer tests**

Create `tests/rightNow.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildRightNowReadout } from "@/lib/rightNow";

const basePatch = {
  version: "1.13.01",
  title: "Patch Notes Version 1.13.01 (All Platforms Hotfix)",
  officialUrl: "https://example.com/patch-11301",
  summary: "Frame-rate drops and occasional crashes were improved.",
  publishedAt: "2026-07-08T05:51:00.000Z",
};

const sourceUrl = "https://github.com/Statusnone420/Crimson-Desert-Report-Hub";
const supportUrl = "https://support.pearlabyss.com/";

describe("buildRightNowReadout", () => {
  it("creates a useful readout when automation has leads but public evidence is thin", () => {
    const readout = buildRightNowReadout({
      currentPatch: basePatch,
      scanner: {
        reviewedThisWeek: 117,
        filteredThisWeek: 82,
        keptThisWeek: 35,
        awaiting: 7,
        published: 1,
        lastCheckedAt: "2026-07-08T13:00:00.000Z",
        scannerActive: true,
        scannerConnected: true,
      },
      directReports: 1,
      communitySignals: 0,
      publicFindingsCount: 0,
      latestReportAt: "2026-07-06T13:00:00.000Z",
      topClusters: [
        {
          id: "fps",
          title: "FPS / performance regression since 1.13.00",
          category: "performance",
          description: "Frame-rate drops, stutter, and frame-pacing issues after patch 1.13.00.",
          fix_status: "fix_claimed",
          directReportCount: 1,
          signalCount: 0,
          candidateSignalCount: 0,
          postCurrentPatchEvidenceCount: 0,
        },
        {
          id: "mount",
          title: "Mount, input, and title-screen lockups",
          category: "controls",
          description: "Horse or mount control failures, unresponsive inputs, and title-screen lockups.",
          fix_status: "reported",
          directReportCount: 0,
          signalCount: 0,
          candidateSignalCount: 2,
          postCurrentPatchEvidenceCount: 0,
        },
      ],
      sourceUrl,
      supportUrl,
    });

    expect(readout.observations).toContain("Current patch: 1.13.01 hotfix. Official notes are linked.");
    expect(readout.observations).toContain("Scanner checked 117 public candidates this week; 7 still need another source before publishing.");
    expect(readout.observations).toContain("1 player report is attached to the current patch family.");
    expect(readout.observations).toContain("No public source links are strong enough yet for this patch.");
    expect(readout.worthChecking.map((issue) => issue.title)).toEqual([
      "FPS / performance regression since 1.13.00",
      "Mount, input, and title-screen lockups",
    ]);
    expect(readout.worthChecking[0]).toMatchObject({
      statusLabel: "Player reported",
      strengthLabel: "1 player report, 0 public sources",
      countSummary: "1 report · 0 public sources",
    });
    expect(readout.worthChecking[1]).toMatchObject({
      statusLabel: "Needs confirmation",
      strengthLabel: "2 private mentions, no public proof",
      countSummary: "0 reports · 0 public sources · 2 leads",
    });
    expect(readout.usefulLinks.map((link) => link.label)).toEqual([
      "Official patch notes",
      "Pearl Abyss support",
      "Known issues",
      "Source radar",
      "Open-source code",
    ]);
    expect(JSON.stringify(readout)).not.toContain("source_url");
    expect(JSON.stringify(readout)).not.toContain("reject");
  });

  it("stays useful when there are no reports and no scanner connection", () => {
    const readout = buildRightNowReadout({
      currentPatch: basePatch,
      scanner: {
        reviewedThisWeek: 0,
        filteredThisWeek: 0,
        keptThisWeek: 0,
        awaiting: 0,
        published: 0,
        lastCheckedAt: null,
        scannerActive: false,
        scannerConnected: false,
      },
      directReports: 0,
      communitySignals: 0,
      publicFindingsCount: 0,
      latestReportAt: null,
      topClusters: [],
      sourceUrl,
      supportUrl,
    });

    expect(readout.observations).toContain("Scanner data is not connected in this environment.");
    expect(readout.observations).toContain("No player reports are attached to the current patch family yet.");
    expect(readout.worthChecking).toEqual([]);
    expect(readout.emptyWorthCheckingCopy).toBe(
      "No watched issue has enough signal yet. Use the official links, source radar, or add your own case.",
    );
  });
});
```

- [ ] **Step 2: Run the failing test**

Run: `npm test -- tests/rightNow.test.ts`

Expected: FAIL with module not found for `@/lib/rightNow`.

- [ ] **Step 3: Implement the pure transformer**

Create `src/lib/rightNow.ts`:

```ts
import { playerIssueStatus, type PlayerIssueStatus } from "@/lib/patchWatch";

type Tone = PlayerIssueStatus["tone"];

export type RightNowClusterInput = {
  id: string;
  title: string;
  category: string;
  description: string;
  fix_status: string;
  directReportCount: number;
  signalCount: number;
  candidateSignalCount: number;
  postCurrentPatchEvidenceCount: number;
};

export type RightNowScannerInput = {
  reviewedThisWeek: number;
  filteredThisWeek: number;
  keptThisWeek: number;
  awaiting: number;
  published: number;
  lastCheckedAt: string | null;
  scannerActive: boolean;
  scannerConnected: boolean;
};

export type RightNowInput = {
  currentPatch: {
    version: string;
    title: string;
    officialUrl: string;
    summary: string | null;
    publishedAt: string | null;
  };
  scanner: RightNowScannerInput;
  directReports: number;
  communitySignals: number;
  publicFindingsCount: number;
  latestReportAt: string | null;
  topClusters: RightNowClusterInput[];
  sourceUrl: string;
  supportUrl: string;
};

export type RightNowIssue = {
  id: string;
  title: string;
  description: string;
  category: string;
  href: string;
  statusLabel: PlayerIssueStatus["label"];
  strengthLabel: string;
  detail: string;
  tone: Tone;
  countSummary: string;
  actionLabel: "View evidence" | "I am seeing this";
};

export type RightNowReadout = {
  patchLabel: string;
  observations: string[];
  worthChecking: RightNowIssue[];
  emptyWorthCheckingCopy: string;
  usefulLinks: { label: string; href: string; external?: boolean }[];
  trustNotes: string[];
  scannerHeartbeat: string;
};

function plural(count: number, singular: string, pluralLabel = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralLabel}`;
}

function patchLabel(version: string) {
  return version.endsWith(".01") ? `${version} hotfix` : version;
}

function countSummary(issue: RightNowClusterInput) {
  const base = `${issue.directReportCount} ${issue.directReportCount === 1 ? "report" : "reports"} · ${issue.signalCount} public sources`;
  return issue.candidateSignalCount > 0 ? `${base} · ${issue.candidateSignalCount} leads` : base;
}

function issueWeight(issue: RightNowClusterInput) {
  return issue.directReportCount * 5 + issue.signalCount * 4 + issue.candidateSignalCount * 2 + issue.postCurrentPatchEvidenceCount * 6;
}

export function buildRightNowReadout(input: RightNowInput): RightNowReadout {
  const observations = [`Current patch: ${patchLabel(input.currentPatch.version)}. Official notes are linked.`];

  if (input.scanner.scannerConnected) {
    observations.push(
      input.scanner.awaiting > 0
        ? `Scanner checked ${input.scanner.reviewedThisWeek} public candidates this week; ${input.scanner.awaiting} still need another source before publishing.`
        : `Scanner checked ${input.scanner.reviewedThisWeek} public candidates this week; nothing is waiting for corroboration.`,
    );
  } else {
    observations.push("Scanner data is not connected in this environment.");
  }

  observations.push(
    input.directReports > 0
      ? `${plural(input.directReports, "player report")} attached to the current patch family.`
      : "No player reports are attached to the current patch family yet.",
  );

  observations.push(
    input.publicFindingsCount > 0
      ? `${plural(input.publicFindingsCount, "public source link")} cleared the evidence rules for this patch.`
      : "No public source links are strong enough yet for this patch.",
  );

  const worthChecking = input.topClusters
    .filter((cluster) => cluster.directReportCount > 0 || cluster.signalCount > 0 || cluster.candidateSignalCount > 0)
    .sort((a, b) => issueWeight(b) - issueWeight(a))
    .slice(0, 5)
    .map((cluster) => {
      const status = playerIssueStatus({
        directReportCount: cluster.directReportCount,
        publicSignalCount: cluster.signalCount,
        candidateSignalCount: cluster.candidateSignalCount,
        postCurrentPatchEvidenceCount: cluster.postCurrentPatchEvidenceCount,
        fixStatus: cluster.fix_status,
      });

      return {
        id: cluster.id,
        title: cluster.title,
        description: cluster.description,
        category: cluster.category,
        href: "/issues",
        statusLabel: status.label,
        strengthLabel: status.strengthLabel,
        detail: status.detail,
        tone: status.tone,
        countSummary: countSummary(cluster),
        actionLabel: cluster.directReportCount > 0 || cluster.signalCount > 0 ? "View evidence" : "I am seeing this",
      };
    });

  return {
    patchLabel: `Patch ${patchLabel(input.currentPatch.version)}`,
    observations,
    worthChecking,
    emptyWorthCheckingCopy: "No watched issue has enough signal yet. Use the official links, source radar, or add your own case.",
    usefulLinks: [
      { label: "Official patch notes", href: input.currentPatch.officialUrl, external: true },
      { label: "Pearl Abyss support", href: input.supportUrl, external: true },
      { label: "Known issues", href: "/issues" },
      { label: "Source radar", href: "/scanner" },
      { label: "Open-source code", href: input.sourceUrl, external: true },
    ],
    trustNotes: [
      "No accounts, ads, or trackers.",
      "Raw reports stay private; public pages use neutral summaries and counts.",
      "Scanner candidates stay private until corroborated.",
      "Official notes provide context, not player evidence.",
    ],
    scannerHeartbeat: input.scanner.scannerConnected
      ? input.scanner.scannerActive
        ? "Source radar is active."
        : "Source radar is paused."
      : "Source radar is not connected here.",
  };
}
```

- [ ] **Step 4: Run the transformer tests**

Run: `npm test -- tests/rightNow.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/rightNow.ts tests/rightNow.test.ts
git commit -m "Add right now readout transformer"
```

---

### Task 2: Render the Right Now Homepage

**Files:**
- Create: `src/components/RightNowHub.tsx`
- Modify: `src/app/page.tsx`

**Interfaces:**
- Consumes: `RightNowReadout` from `src/lib/rightNow.ts`, existing `getDashboardData()`, existing `getPublicScannerData()`.
- Produces: homepage that leads with Crimson Desert Report Hub, Right now, Worth checking, Useful links, and trust notes.

- [ ] **Step 1: Write failing E2E assertions for the new homepage IA**

Modify `tests/e2e/public-visual.spec.ts` dashboard test expectations:

```ts
await expect(page.getByRole("heading", { name: "Crimson Desert Report Hub" })).toBeVisible();
await expect(page.getByRole("heading", { name: "Right now" })).toBeVisible();
await expect(page.getByRole("heading", { name: "Worth checking" })).toBeVisible();
await expect(page.getByRole("heading", { name: "Useful links" })).toBeVisible();
await expect(page.getByRole("link", { name: "Official patch notes" })).toBeVisible();
await expect(page.getByRole("link", { name: "Pearl Abyss support" })).toBeVisible();
await expect(page.getByRole("link", { name: "Source radar" })).toHaveAttribute("href", "/scanner");
await expect(page.getByRole("link", { name: "Open-source code" })).toBeVisible();
await expect(page.getByText("What can be learned without waiting for reports")).toHaveCount(0);
await expect(page.getByText("Useful next clicks")).toHaveCount(0);
await expect(page.getByText("Patch brief", { exact: false })).toHaveCount(0);
```

- [ ] **Step 2: Run the focused E2E test to verify failure**

Run: `npm run test:e2e -- --grep "dashboard renders"`

Expected: FAIL because "Right now" and "Worth checking" do not exist yet.

- [ ] **Step 3: Create the server-safe presentation component**

Create `src/components/RightNowHub.tsx`:

```tsx
import Link from "next/link";
import type { RightNowReadout } from "@/lib/rightNow";

function badgeClass(tone: string) {
  if (tone === "crimson") return "badge badge-crimson";
  if (tone === "amber") return "badge badge-amber";
  if (tone === "green") return "badge badge-green";
  if (tone === "blue") return "badge badge-blue";
  return "badge badge-dim";
}

export function RightNowHub({ readout }: { readout: RightNowReadout }) {
  return (
    <div className="space-y-6">
      <section className="rise grid gap-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <div className="min-w-0 space-y-2.5">
          <h1 className="h-display max-w-3xl">Crimson Desert Report Hub</h1>
          <p className="max-w-3xl text-sm leading-6" style={{ color: "var(--text-dim)" }}>
            Tracks the current Crimson Desert situation: official context, web chatter, player reports, useful links,
            and what still needs verification.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5 md:justify-end">
          <span className="badge badge-crimson">{readout.patchLabel}</span>
          <Link href="/report" className="btn">
            Report a bug
          </Link>
        </div>
      </section>

      <section className="panel space-y-4">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(260px,0.75fr)]">
          <div className="space-y-3">
            <div>
              <h2 className="h-section">Right now</h2>
              <p className="mt-1 text-sm leading-6" style={{ color: "var(--text-dim)" }}>
                Automation does the scanning. This is the human-readable readout.
              </p>
            </div>
            <ul className="space-y-2">
              {readout.observations.map((item) => (
                <li key={item} className="panel-inset border px-3 py-2 text-sm leading-6" style={{ color: "var(--text-dim)" }}>
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <aside className="panel-inset space-y-3 border p-3">
            <h2 className="text-sm font-semibold">Useful links</h2>
            <div className="grid gap-2">
              {readout.usefulLinks.map((link) =>
                link.external ? (
                  <a key={link.label} href={link.href} target="_blank" rel="noreferrer noopener" className="btn btn-ghost btn-sm justify-start">
                    {link.label}
                  </a>
                ) : (
                  <Link key={link.label} href={link.href} className="btn btn-ghost btn-sm justify-start">
                    {link.label}
                  </Link>
                ),
              )}
            </div>
          </aside>
        </div>
      </section>

      <section className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(260px,0.7fr)]">
        <div className="panel space-y-4">
          <div>
            <h2 className="h-section">Worth checking</h2>
            <p className="mt-1 text-sm leading-6" style={{ color: "var(--text-dim)" }}>
              These are not all proven. They are the areas the hub would check first.
            </p>
          </div>

          {readout.worthChecking.length > 0 ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {readout.worthChecking.map((issue) => (
                <article key={issue.id} className="panel-inset space-y-2 border px-3 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h3 className="text-sm font-semibold">{issue.title}</h3>
                    <span className={badgeClass(issue.tone)}>{issue.statusLabel}</span>
                  </div>
                  <p className="text-xs font-medium" style={{ color: "var(--text-dim)" }}>
                    {issue.countSummary}
                  </p>
                  <p className="text-xs leading-5" style={{ color: "var(--text-faint)" }}>
                    {issue.detail}
                  </p>
                  <Link href={issue.actionLabel === "View evidence" ? issue.href : "/report"} className="link text-xs">
                    {issue.actionLabel}
                  </Link>
                </article>
              ))}
            </div>
          ) : (
            <p className="panel-inset border px-3 py-3 text-sm leading-6" style={{ color: "var(--text-dim)" }}>
              {readout.emptyWorthCheckingCopy}
            </p>
          )}
        </div>

        <aside className="panel space-y-3">
          <h2 className="h-section">Trust rules</h2>
          <ul className="space-y-2">
            {readout.trustNotes.map((note) => (
              <li key={note} className="text-sm leading-6" style={{ color: "var(--text-dim)" }}>
                {note}
              </li>
            ))}
          </ul>
          <p className="border-t pt-3 text-xs leading-5" style={{ color: "var(--text-faint)" }}>
            {readout.scannerHeartbeat}
          </p>
        </aside>
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Rewrite `src/app/page.tsx` to use the transformer**

Replace the first-screen scanner/stat-heavy page with:

```tsx
import { RightNowHub } from "@/components/RightNowHub";
import { buildRightNowReadout } from "@/lib/rightNow";
import { getDashboardData, getPublicScannerData } from "@/lib/queries";
import { PEARL_ABYSS_SUPPORT_URL, SOURCE_URL } from "@/lib/site";

export const revalidate = 300;

export default async function HomePage() {
  const [dashboard, radar] = await Promise.all([getDashboardData(), getPublicScannerData()]);
  const readout = buildRightNowReadout({
    currentPatch: dashboard.currentPatch,
    scanner: radar,
    directReports: dashboard.directReports,
    communitySignals: dashboard.communitySignals,
    publicFindingsCount: dashboard.publicFindings.length,
    latestReportAt: dashboard.latestReportAt,
    topClusters: dashboard.topClusters,
    sourceUrl: SOURCE_URL,
    supportUrl: PEARL_ABYSS_SUPPORT_URL,
  });

  return <RightNowHub readout={readout} />;
}
```

Add `PEARL_ABYSS_SUPPORT_URL` in Task 3 before this compiles, or in this task if implementing inline.

- [ ] **Step 5: Run focused checks**

Run:

```bash
npm test -- tests/rightNow.test.ts
npm run test:e2e -- --grep "dashboard renders"
```

Expected: unit tests PASS; E2E dashboard test PASS after snapshot update is handled in Task 6.

- [ ] **Step 6: Commit**

```bash
git add src/components/RightNowHub.tsx src/app/page.tsx tests/e2e/public-visual.spec.ts
git commit -m "Rework homepage around right now readout"
```

---

### Task 3: Update Public Labels And Metadata

**Files:**
- Modify: `src/components/NavLinks.tsx`
- Modify: `src/lib/site.ts`
- Modify: `src/app/layout.tsx`
- Modify: `tests/e2e/public-visual.spec.ts`

**Interfaces:**
- Produces: broad hub naming that supports future sections without building them.

- [ ] **Step 1: Write failing nav assertions**

Add to the dashboard E2E test after `await page.goto("/")`:

```ts
await expect(page.getByRole("link", { name: "Right now" })).toHaveAttribute("href", "/");
await expect(page.getByRole("link", { name: "Known issues" })).toHaveAttribute("href", "/issues");
await expect(page.getByRole("link", { name: "Report" })).toHaveAttribute("href", "/report");
await expect(page.getByRole("link", { name: "How it works" })).toHaveAttribute("href", "/about");
await expect(page.getByRole("link", { name: "Source radar" })).toHaveAttribute("href", "/scanner");
```

- [ ] **Step 2: Run failing E2E slice**

Run: `npm run test:e2e -- --grep "dashboard renders"`

Expected: FAIL because current nav still says Dashboard, Issues, Submit report, About, Scanner.

- [ ] **Step 3: Update nav labels**

Modify `src/components/NavLinks.tsx`:

```ts
const NAV = [
  { href: "/", label: "Right now" },
  { href: "/issues", label: "Known issues" },
  { href: "/report", label: "Report" },
  { href: "/about", label: "How it works" },
  { href: "/scanner", label: "Source radar" },
];
```

- [ ] **Step 4: Update site constants**

Modify `src/lib/site.ts`:

```ts
export const SITE_URL = "https://crimsonreporthub.com";
export const SITE_NAME = "Crimson Desert Report Hub";
export const SITE_DESCRIPTION =
  "Unofficial Crimson Desert hub for the current game situation: official context, public web chatter, player reports, useful links, and source transparency.";
export const SOURCE_URL = "https://github.com/Statusnone420/Crimson-Desert-Report-Hub";
export const PEARL_ABYSS_SUPPORT_URL = "https://support.pearlabyss.com/";
```

- [ ] **Step 5: Update metadata titles**

Modify the title strings in `src/app/layout.tsx`:

```ts
title: {
  default: `${SITE_NAME} - current situation hub`,
  template: `%s | ${SITE_NAME}`,
},
...
title: `${SITE_NAME} - current situation hub`,
```

- [ ] **Step 6: Run focused checks**

Run:

```bash
npm run lint
npm run test:e2e -- --grep "dashboard renders"
```

Expected: lint PASS; E2E nav assertions PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/NavLinks.tsx src/lib/site.ts src/app/layout.tsx tests/e2e/public-visual.spec.ts
git commit -m "Rename public navigation around report hub"
```

---

### Task 4: Refine Issues, Report, About, And Scanner Copy

**Files:**
- Modify: `src/app/issues/page.tsx`
- Modify: `src/app/report/ReportForm.tsx`
- Modify: `src/app/about/page.tsx`
- Modify: `src/components/scanner/PublicScannerView.tsx`
- Modify: `tests/e2e/public-visual.spec.ts`

**Interfaces:**
- Consumes: existing page data.
- Produces: page roles aligned with the spec: evidence ledger, add your case, how the hub works, source radar.

- [ ] **Step 1: Write failing page-copy assertions**

Update E2E tests:

```ts
// Issues page
await expect(page.getByRole("heading", { name: "Known issues" })).toBeVisible();
await expect(page.getByText("One report is early evidence, not consensus.", { exact: false })).toBeVisible();
await expect(page.getByText("Private scanner candidates stay private.")).toBeVisible();

// Report page
await expect(page.getByRole("heading", { name: "Add your case to the hub" })).toBeVisible();
await expect(page.getByText("Useful even if you are the only one reporting it", { exact: false })).toBeVisible();

// About page
await expect(page.getByRole("heading", { name: "How this hub works" })).toBeVisible();
await expect(page.getByText("The hub can grow into notes, resources, guides, and patch history later.", { exact: true })).toBeVisible();

// Public scanner
await expect(page.getByRole("heading", { name: "Source radar" })).toBeVisible();
await expect(page.getByText("Operator view of how public chatter becomes evidence.")).toBeVisible();
```

- [ ] **Step 2: Run failing E2E slices**

Run:

```bash
npm run test:e2e -- --grep "issue clusters|report form|about page|public scanner"
```

Expected: FAIL because current copy still uses tracker/evidence-board/scanner-first labels.

- [ ] **Step 3: Update Issues page copy**

In `src/app/issues/page.tsx`:

- Change `SectionHeader` label/title/description to:

```tsx
<SectionHeader
  label="Evidence ledger"
  title="Known issues"
  description="Strict view of what is backed, what is only suspected, and what still needs another player or public source. One report is early evidence, not consensus. Private scanner candidates stay private."
/>
```

- Rename the watchlist heading from `Watchlist` to `Needs another source`.
- Keep `I&apos;m seeing this` links.
- Keep approved excerpts and public source links.

- [ ] **Step 4: Update Report page copy**

In `src/app/report/ReportForm.tsx`:

- Change the hero title to `Add your case to the hub`.
- Change the hero description to:

```tsx
No account, no email. Useful even if you are the only one reporting it: platform, hardware, repro steps, and patch version make the current situation clearer without publishing your raw words.
```

- Change the technical details summary to `Add technical detail for the report`.
- Change the submit button text to `Submit case`.
- Keep the API payload and form names unchanged.

- [ ] **Step 5: Update success-state copy carefully**

In `ReportForm`, success copy should say:

```tsx
It is checked and sorted into the right issue automatically. Your raw words stay private; public pages only use counts and neutral summaries. If you have crash logs or a PERS ID, keep Pearl Abyss support in the loop too.
```

- [ ] **Step 6: Update About page copy**

Replace `src/app/about/page.tsx` content with sections:

- Hero title: `How this hub works`
- Intro: `Crimson Desert Report Hub is an unofficial, fan-run way to understand the current game situation without turning thin chatter into proof.`
- Section `What it is`: official context, public web chatter, player reports, useful resources, source transparency.
- Section `What stays private`: raw reports, raw IPs, private scanner candidates, rejected URLs.
- Section `Evidence rules`: official notes are context; public evidence requires reports or publishable sources; one report is early.
- Section `Room to grow`: `The hub can grow into notes, resources, guides, and patch history later.`
- Section `Use official support too`: preserve official support guidance.

- [ ] **Step 7: Update PublicScannerView copy**

In `src/components/scanner/PublicScannerView.tsx`:

- Hero label: `Source radar`
- Hero title: `Source radar`
- Description:

```tsx
Operator view of how public chatter becomes evidence. The homepage shows the human readout; this page shows the funnel behind it.
```

- Keep `<SourceRadar />` unchanged.
- Keep privacy warning when scanner is disconnected.

- [ ] **Step 8: Run focused E2E checks**

Run:

```bash
npm run test:e2e -- --grep "issue clusters|report form|about page|public scanner"
```

Expected: PASS after snapshots are updated in Task 6.

- [ ] **Step 9: Commit**

```bash
git add src/app/issues/page.tsx src/app/report/ReportForm.tsx src/app/about/page.tsx src/components/scanner/PublicScannerView.tsx tests/e2e/public-visual.spec.ts
git commit -m "Refine public page roles and copy"
```

---

### Task 5: Preserve Privacy And Early-Evidence Semantics

**Files:**
- Modify: `tests/rightNow.test.ts`
- Modify: `tests/patchWatch.test.ts` only if current labels need adjustment.
- Modify: `tests/queries.test.ts` only if public finding shape changes.

**Interfaces:**
- Produces: automated proof that the hub can be useful without leaking private candidates or overstating weak evidence.

- [ ] **Step 1: Add transformer privacy tests**

Append to `tests/rightNow.test.ts`:

```ts
it("does not turn private candidates into public source links", () => {
  const readout = buildRightNowReadout({
    currentPatch: basePatch,
    scanner: {
      reviewedThisWeek: 10,
      filteredThisWeek: 8,
      keptThisWeek: 2,
      awaiting: 2,
      published: 0,
      lastCheckedAt: "2026-07-08T13:00:00.000Z",
      scannerActive: true,
      scannerConnected: true,
    },
    directReports: 0,
    communitySignals: 0,
    publicFindingsCount: 0,
    latestReportAt: null,
    topClusters: [
      {
        id: "crash",
        title: "Crashes and startup hangs",
        category: "crashes",
        description: "Crashes during launch or startup.",
        fix_status: "reported",
        directReportCount: 0,
        signalCount: 0,
        candidateSignalCount: 2,
        postCurrentPatchEvidenceCount: 0,
      },
    ],
    sourceUrl,
    supportUrl,
  });

  expect(readout.worthChecking[0]).toMatchObject({
    statusLabel: "Needs confirmation",
    countSummary: "0 reports · 0 public sources · 2 leads",
    actionLabel: "I am seeing this",
  });
  expect(JSON.stringify(readout)).not.toContain("http");
  expect(JSON.stringify(readout)).not.toContain("reddit.com");
  expect(JSON.stringify(readout)).not.toContain("reject");
});
```

- [ ] **Step 2: Confirm patchWatch semantics remain intact**

Run: `npm test -- tests/patchWatch.test.ts tests/rightNow.test.ts tests/queries.test.ts`

Expected: PASS.

- [ ] **Step 3: Commit if tests changed**

```bash
git add tests/rightNow.test.ts tests/patchWatch.test.ts tests/queries.test.ts
git commit -m "Cover right now privacy semantics"
```

If only `tests/rightNow.test.ts` changed and was committed in Task 1, fold this test into Task 1 instead of making a separate commit.

---

### Task 6: Update Visual Regression Screenshots

**Files:**
- Modify: `tests/e2e/__screenshots__/chromium/dashboard.png`
- Modify: `tests/e2e/__screenshots__/chromium/issues.png`
- Modify: `tests/e2e/__screenshots__/chromium/report-success.png`
- Modify: `tests/e2e/__screenshots__/chromium/report-import.png`
- Modify: `tests/e2e/__screenshots__/chromium/about.png`
- Modify: `tests/e2e/__screenshots__/chromium/scanner-public.png`
- Modify: matching `mobile-chromium` screenshots when Playwright updates them.

**Interfaces:**
- Consumes: rendered pages after Tasks 1-5.
- Produces: committed screenshot baselines and manual screenshot files for user review.

- [ ] **Step 1: Update Playwright screenshots**

Run:

```bash
npm run test:e2e:update
```

Expected: Tests run; screenshots update for changed pages.

- [ ] **Step 2: Run Playwright without update**

Run:

```bash
npm run test:e2e
```

Expected: PASS.

- [ ] **Step 3: Capture manual validation screenshots**

Start the app if it is not already running:

```bash
npm run dev
```

Use Playwright or browser tooling to save:

- `<local-temp>/cd-report-hub-right-now-home.png`
- `<local-temp>/cd-report-hub-right-now-issues.png`
- `<local-temp>/cd-report-hub-right-now-report.png`
- `<local-temp>/cd-report-hub-right-now-about.png`
- `<local-temp>/cd-report-hub-right-now-scanner.png`
- `<local-temp>/cd-report-hub-right-now-home-mobile.png`
- `<local-temp>/cd-report-hub-right-now-issues-mobile.png`

Expected: screenshots visually show homepage purpose in the first viewport and no text overlap.

- [ ] **Step 4: Read screenshots back before continuing**

Use the image viewing tool on each manual screenshot. Check:

- Homepage first screen says "Right now" and "Worth checking."
- It does not look like a patch notes page.
- Useful links are visible without scrolling on desktop.
- Mobile homepage preserves the order: brand, Right now, Useful links, Worth checking.
- Issues page reads stricter than homepage.
- Report page explains why one case matters.
- Scanner reads as source radar/operator view.

- [ ] **Step 5: Commit screenshots**

```bash
git add tests/e2e/__screenshots__
git commit -m "Update public visual baselines"
```

Manual screenshots in Temp are for user review and should not be committed.

---

### Task 7: Final Verification And Push

**Files:**
- No code files expected unless verification finds defects.

**Interfaces:**
- Produces: pushed feature branch with passing verification and screenshot evidence.

- [ ] **Step 1: Run lint**

Run: `npm run lint`

Expected: PASS.

- [ ] **Step 2: Run unit tests**

Run: `npm test`

Expected: PASS.

- [ ] **Step 3: Run TypeScript**

Run: `npm exec tsc -- --noEmit`

Expected: PASS.

- [ ] **Step 4: Run production build**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 5: Check git status**

Run: `git status --short --branch`

Expected: clean working tree on `feat/player-useful-patch-watch`, ahead of remote by implementation commits.

- [ ] **Step 6: Push**

Run: `git push`

Expected: branch pushes to `origin/feat/player-useful-patch-watch`.

- [ ] **Step 7: Present result**

Final response must include:

- Summary of what changed.
- Verification commands run and results.
- Manual screenshot paths for review.
- Any honest limitations, especially if Vercel preview data differs from local data.
- Git push directive in final response after successful push.

---

## Plan Self-Review

- Spec coverage: homepage Right Now readout is covered by Tasks 1-2; nav/metadata by Task 3; Issues/Report/About/Scanner roles by Task 4; privacy semantics by Task 5; screenshot validation by Task 6; required commands by Task 7.
- Scope control: no blog, notes, CMS, database tables, or new dependencies are included. Future content lanes are protected through copy and naming only.
- Type consistency: `RightNowReadout`, `RightNowIssue`, and `buildRightNowReadout` are defined in Task 1 and consumed in Task 2 with matching names.
- Privacy boundary: the new transformer accepts counts and public link counts only; it never accepts private raw text or URLs.
