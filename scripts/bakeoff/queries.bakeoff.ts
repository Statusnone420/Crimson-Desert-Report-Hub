/**
 * Query bake-off. Runs the REAL query pack against the LIVE Tavily API on the
 * development key, then judges every result with the REAL pre-screen, and reports
 * where each one would land: kept as a signal, routed to an observation lane, or
 * dropped.
 *
 *   npm run scan:bakeoff
 *
 * Why it exists: the scanner spent three weeks asking two community domains and
 * nothing else, and nobody could see it. Unit tests prove the code does what it was
 * told; only this shows whether what it was told is worth doing.
 *
 * Safety:
 *   - reads the key from `.env.local` ONLY, which holds the development key. It
 *     never reads process.env, so a production key cannot leak in from a shell.
 *   - refuses to run in CI or on a deployment host.
 *   - read-only: no database, no writes, nothing in the app touched.
 *   - lives outside `tests/`, and the root vitest config includes only `tests/**`,
 *     so `npm run test` and CI never execute it.
 *
 * Cost: one Tavily credit per query, on the development key's free monthly
 * allowance. A full run is roughly a dozen.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { it } from "vitest";

import { canonicalizeUrl } from "@/lib/automation/dedupe";
import { domainTier, registrableDomain } from "@/lib/automation/domains";
import { buildMemorySearchQueries } from "@/lib/automation/memory";
import { shouldCollectObservation } from "@/lib/automation/observations";
import { preScreenCandidate } from "@/lib/automation/relevance";
import { isBriefEligibleObservation } from "@/lib/observationDisplay";
import { buildSearchQueries, buildWireNewsQuery, tavilySearch, type SearchResult } from "@/lib/automation/search";

const ROOT = path.resolve(__dirname, "..", "..");
const OUT_DIR = path.join(ROOT, "output", "bakeoff");

/**
 * The patch to measure against. Update both together when a new patch lands —
 * the bake-off is only meaningful against a patch the world has had time to
 * write about, and a version-pinned query on a two-day-old patch measures the
 * calendar, not the query.
 */
const PATCH_VERSION = "1.15.00";
const PATCH_PUBLISHED_AT = "2026-07-24T02:40:00.000Z";

/**
 * A representative open-cluster title for the corroborate lane. That lane builds a
 * different query string from the discovery pack — it carries a cluster title — so
 * measuring the pack says nothing about it. What this probe measures is whether the
 * site scope survives once a title is appended and whether the results stay on topic;
 * the title's own yield is not the subject. Any symptom phrase of this shape does.
 */
const CORROBORATE_PROBE_TITLE = "stuttering and frame drops in open world";

/**
 * Read the development key from .env.local without adding a dotenv dependency.
 *
 * LAST assignment wins, matching `node --env-file`, and empty assignments are
 * ignored. This file legitimately carries blank placeholders above real values,
 * and taking the first match read the placeholder — which made the whole run skip
 * while reporting success.
 */
function devTavilyKey(): string | null {
  const envPath = path.join(ROOT, ".env.local");
  if (!existsSync(envPath)) return null;
  let key: string | null = null;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = /^\s*TAVILY_API_KEY\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const value = match[1].trim().replace(/^["']|["']$/g, "");
    if (value) key = value;
  }
  return key;
}

type Judged = {
  lane: string;
  query: string;
  domain: string;
  trusted: boolean;
  dated: boolean;
  title: string;
  outcome: string;
};

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "(unparseable)";
  }
}

function judge(lane: string, query: string, results: SearchResult[]): Judged[] {
  return results.map((result) => {
    const domain = result.sourceDomain ?? hostOf(result.url);
    const decision = preScreenCandidate(
      {
        title: result.title,
        snippet: result.snippet,
        url: result.url,
        sourceDomain: domain,
        sourcePublishedAt: result.sourcePublishedAt ?? null,
      },
      { currentPatchVersion: PATCH_VERSION, currentPatchPublishedAt: PATCH_PUBLISHED_AT },
    );
    const registrable = registrableDomain(domain);

    // The pre-screen only ROUTES a result to an observation genre. Production then
    // puts it through shouldCollectObservation, which requires a trusted registrable
    // domain — and store.steampowered.com reduces to steampowered.com, which is not
    // one. Judging at the pre-screen alone reported observations the pipeline throws
    // away, which is the exact silent-success failure this harness exists to catch.
    // collectedThisRun is 0 deliberately: the per-run cap is a budget, not a property
    // of the query, and folding it in here would attribute a cap to whichever query
    // happened to run last.
    const observationKind = decision.keep ? undefined : decision.observationKind;
    const collected =
      observationKind !== undefined &&
      shouldCollectObservation(
        {
          title: result.title,
          snippet: result.snippet,
          url: result.url,
          sourceDomain: domain,
          observationKind,
        },
        0,
      );

    // Collected is still not displayed. The Brief additionally requires a real
    // source_published_at, and general search almost never returns one — which is
    // why the Brief's observation sections are dark in production while the table
    // has rows in it. Counting a stored-but-undated row as reaching the Brief is
    // the same overstatement as counting a discarded one, one gate further down.
    const displayed =
      collected &&
      observationKind !== undefined &&
      isBriefEligibleObservation(
        {
          kind: observationKind,
          title: result.title,
          url: result.url,
          source_domain: domain,
          snippet: result.snippet,
          source_published_at: result.sourcePublishedAt ?? null,
          is_public: true,
        },
        { version: PATCH_VERSION, publishedAt: PATCH_PUBLISHED_AT },
      );

    return {
      lane,
      query,
      domain,
      trusted: registrable ? domainTier(registrable) === "trusted" : false,
      dated: Boolean(result.sourcePublishedAt),
      title: result.title,
      outcome: decision.keep
        ? "KEPT"
        : observationKind
          ? `${displayed ? "OBSERVATION" : collected ? "OBSERVATION_STORED" : "OBSERVATION_REJECTED"}:${observationKind}`
          : `DROPPED:${decision.reason}`,
    };
  });
}

it("measures the live query pack against the real pre-screen", async () => {
  const key = devTavilyKey();
  const onDeploymentHost = Boolean(process.env.CI || process.env.VERCEL || process.env.GITHUB_ACTIONS);

  // A tool that reports success while doing nothing is the exact failure this
  // harness exists to catch, so the only silent exit is the one that cannot happen
  // by accident. Everything else fails loudly.
  if (onDeploymentHost) {
    console.warn("scan:bakeoff is a local tool and does not run on CI. Skipped, no credits spent.");
    return;
  }
  if (!key) {
    throw new Error(
      "scan:bakeoff found no usable TAVILY_API_KEY in .env.local. Add your DEVELOPMENT key (never the production one) " +
        "on its own line. Note that a later assignment overrides an earlier one, so a blank placeholder above the real " +
        "value is fine. Nothing ran and no credits were spent.",
    );
  }
  // Tavily issues development keys with a `tvly-dev-` prefix. The production key lives
  // in Vercel and must never reach a local tool, so the prefix is a hard stop rather
  // than a warning. The key itself is never echoed, here or anywhere else.
  if (!key.startsWith("tvly-dev-")) {
    throw new Error(
      "scan:bakeoff refuses to run: the TAVILY_API_KEY in .env.local is not a development key. " +
        "A development key begins with `tvly-dev-`; the production key belongs in Vercel only. " +
        "Nothing ran and no credits were spent.",
    );
  }

  // The queries are imported, not restated, so this can never measure a query the
  // scanner has stopped running. `startDate` mirrors collectInputs exactly.
  const startDate = PATCH_PUBLISHED_AT.slice(0, 10);
  const packQueries = buildSearchQueries(Number.MAX_SAFE_INTEGER, PATCH_VERSION);
  // The corroborate lane appends a cluster title and rotates its own site list, so it
  // is a different query string from anything in the pack. Measuring the pack said
  // nothing about it. One probe per site rotation covers the whole rotation: with a
  // single title, the lane's site turn advances once per rotation offset.
  const corroborateQueries = [0, 1, 2, 3]
    .map(
      (rotationOffset) =>
        buildMemorySearchQueries(1, PATCH_VERSION, "corroborate_cluster", {
          rotationOffset,
          laneCount: 1,
          targetClusterTitles: [CORROBORATE_PROBE_TITLE],
        })[0],
    )
    .filter((query): query is string => Boolean(query));
  const plan: { lane: string; query: string; topic?: "news" }[] = [
    ...packQueries.map((query) => ({ lane: "discovery", query })),
    { lane: "wire", query: buildWireNewsQuery(), topic: "news" as const },
    ...corroborateQueries.map((query) => ({ lane: "corroborate", query })),
  ];
  const env = { TAVILY_API_KEY: key };

  const judged: Judged[] = [];
  // Production judges a page once PER RUN: prepareSignals canonicalizes every URL
  // and the first encounter wins (run.ts). Here every query models its OWN run.
  // The scheduled budget runs one pack query per run at the default policy
  // (budget.ts caps scheduled at three, policy default is one), the rotation
  // window is time-derived so larger budgets produce OVERLAPPING windows a
  // harness that runs each query once cannot reproduce, and a page a previous
  // run saw is re-judged as a reobservation — it counts. So dedup spans one
  // query, and cross-query overlap is REPORTED, never suppressed. The wire query
  // is the one run production never issues alone — the wire slot needs a budget
  // of two — so its overlap with discovery lands in that reported count too.
  const seenAcrossQueries = new Set<string>();
  let repeatsSkipped = 0;
  let crossQueryRepeats = 0;
  const lines: string[] = [];
  const emit = (line = "") => {
    lines.push(line);
    console.log(line);
  };

  emit(`patch ${PATCH_VERSION} published ${startDate}`);
  emit(`${plan.length} queries, one Tavily credit each, development key`);
  emit(`corroborate probe title: "${CORROBORATE_PROBE_TITLE}"`);
  // A self-describing marker, because this changed what the totals count. An
  // on-disk baseline without this line judged every repeat and is not comparable.
  emit(
    "dedupe: each query models its own production run (at the default search depth a scheduled run issues one pack query), " +
      "so urls are judged once per query and cross-query overlap is reported, not suppressed. " +
      "Reports without this line are not comparable baselines",
  );

  const failures: string[] = [];

  for (const { lane, query, topic } of plan) {
    let results: SearchResult[] = [];
    try {
      results = await tavilySearch(query, {
        env,
        startDate,
        ...(topic ? { topic } : {}),
      });
    } catch (error) {
      // Recorded, not swallowed. The run continues so the report still shows which
      // queries DID work, and then it throws below — a bad key, an outage, or a rate
      // limit would otherwise print a zero-result report and exit 0, presenting "no
      // query behaviour was measured" as "the pack returns nothing". That is the exact
      // silent-success failure this harness exists to catch.
      const message = `${query} -> ${(error as Error).message}`;
      failures.push(message);
      emit(`\n! ${message}`);
      continue;
    }
    emit(`\n[${lane}] ${query}`);
    const seenUrls = new Set<string>();
    const fresh: SearchResult[] = [];
    let repeats = 0;
    let unparseable = 0;
    for (const result of results) {
      let canonical: string;
      try {
        canonical = canonicalizeUrl(result.url);
      } catch {
        // Production records an error and skips a signal whose URL will not parse
        // (run.ts); judging it here would count a row production never takes in.
        // Loud, because a silent drop is this harness's enemy.
        unparseable += 1;
        emit(`  ! unparseable url skipped: ${result.url}`);
        continue;
      }
      if (seenUrls.has(canonical)) {
        repeats += 1;
        continue;
      }
      seenUrls.add(canonical);
      // Judged, not skipped: a page an earlier query already returned would be a
      // separate run's reobservation in production. Counted so the overlap stays
      // visible in the totals.
      if (seenAcrossQueries.has(canonical)) crossQueryRepeats += 1;
      seenAcrossQueries.add(canonical);
      // Production pre-screens the canonical URL, not the raw one (run.ts), and
      // the pre-screen reads URL text — so hand judge() the same string.
      fresh.push({ ...result, url: canonical });
    }
    repeatsSkipped += repeats;
    const rows = judge(lane, query, fresh);
    judged.push(...rows);

    // A query whose every result was a repeat or a broken URL did NOT return
    // nothing — saying so would be the self-contradicting report this tool exists
    // to prevent.
    if (rows.length === 0 && repeats === 0 && unparseable === 0) emit("  (no results)");
    if (repeats > 0) {
      emit(`  (${repeats} repeat url${repeats === 1 ? "" : "s"} within this query skipped — production judges a url once per run)`);
    }
    for (const row of rows) {
      emit(
        `  ${row.outcome.padEnd(30)} ${(row.dated ? "dated" : "  -  ").padEnd(6)} ${row.domain.padEnd(26)} ${row.title.slice(0, 58)}`,
      );
    }
  }

  const kept = judged.filter((row) => row.outcome === "KEPT").length;
  const observations = judged.filter((row) => row.outcome.startsWith("OBSERVATION:")).length;
  const observationsStored = judged.filter((row) => row.outcome.startsWith("OBSERVATION_STORED:")).length;
  const observationsRejected = judged.filter((row) => row.outcome.startsWith("OBSERVATION_REJECTED:")).length;
  const dropped = judged.filter((row) => row.outcome.startsWith("DROPPED")).length;
  const domains = new Set(judged.map((row) => registrableDomain(row.domain) ?? row.domain));
  const community = new Set(["reddit.com", "steamcommunity.com"]);
  const independent = [...domains].filter((domain) => !community.has(domain));
  // Distinct trusted DOMAINS, not trusted rows. Diversity is what publication needs
  // — five results from one outlet is one domain, and counting rows here would have
  // read as five, overstating the metric this whole exercise turns on.
  const trustedDomains = new Set(
    judged.filter((row) => row.trusted).map((row) => registrableDomain(row.domain) ?? row.domain),
  );

  emit("\n=== TOTALS ===");
  emit(`results               ${judged.length}`);
  emit(`repeat urls skipped   ${repeatsSkipped}   (within one query; production judges a url once per run)`);
  emit(`cross-query repeats   ${crossQueryRepeats}   (judged each time — separate runs reobserve; only a burst run bundles discovery queries)`);
  emit(`kept as signals       ${kept}`);
  emit(`render in the Brief   ${observations}   (collected AND displayable)`);
  emit(`stored, never shown   ${observationsStored}   (collected, but the Brief needs a publication date)`);
  emit(`routed but discarded  ${observationsRejected}   (pre-screen said observation, observation gate said no)`);
  emit(`dropped               ${dropped}`);
  emit(`dated                 ${judged.filter((row) => row.dated).length}`);
  emit(`trusted results       ${judged.filter((row) => row.trusted).length}`);
  emit(`trusted domains       ${trustedDomains.size} (${[...trustedDomains].join(", ") || "NONE"})`);
  emit(`distinct domains      ${domains.size}`);
  emit(`non-community         ${independent.length} (${independent.join(", ") || "NONE"})`);

  // Per lane, because the lanes answer different questions: discovery finds signals,
  // corroborate has to reach a SECOND registrable domain, and the wire lane exists
  // only for dates. A single blended total hides a lane that returns nothing useful.
  emit("\nby lane");
  for (const lane of ["discovery", "wire", "corroborate"]) {
    const rows = judged.filter((row) => row.lane === lane);
    // Domains from rows that actually supplied something. A rejected or dropped
    // row's host proved nothing, and counting it let a corroborate probe claim
    // domains that corroborated nothing. For discovery and wire, "something" is a
    // kept signal or an observation the Brief renders; for corroborate it is kept
    // signals ONLY, because production's independent-domain count reads
    // source_signals and an observation never corroborates a cluster.
    const evidenceDomains = new Set(
      rows
        .filter((row) =>
          row.outcome === "KEPT" || (lane !== "corroborate" && row.outcome.startsWith("OBSERVATION:")),
        )
        .map((row) => registrableDomain(row.domain) ?? row.domain),
    );
    // Two definitions must not share one label: corroborate's number is a
    // different metric from the other lanes', and the report has to say so.
    const domainsLabel = lane === "corroborate" ? "corroborating domains" : "evidence domains";
    emit(
      `  ${lane.padEnd(13)} ${String(rows.length).padStart(3)} results  ` +
        `${String(rows.filter((row) => row.outcome === "KEPT").length).padStart(2)} kept  ` +
        `${String(rows.filter((row) => row.dated).length).padStart(2)} dated  ` +
        `${evidenceDomains.size} ${domainsLabel} (${[...evidenceDomains].join(", ") || "NONE"})`,
    );
  }

  const drops = new Map<string, number>();
  for (const row of judged) {
    if (!row.outcome.startsWith("DROPPED")) continue;
    drops.set(row.outcome, (drops.get(row.outcome) ?? 0) + 1);
  }
  emit("\ndrop reasons");
  for (const [reason, count] of [...drops].sort((a, b) => b[1] - a[1])) emit(`  ${reason.padEnd(34)} ${count}`);

  if (failures.length > 0) {
    emit(`\n${failures.length} of ${plan.length} queries failed:`);
    for (const failure of failures) emit(`  ${failure}`);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  // Stamped, so a "before" run is still on disk to compare against after a change.
  // A fixed name overwrote the very baseline the comparison depends on.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = path.join(OUT_DIR, `bakeoff-${PATCH_VERSION}-${stamp}.txt`);
  writeFileSync(reportPath, lines.join("\n"));
  console.log(`\nreport written to ${reportPath}`);

  // Diagnostics first, then fail. A run that could not reach Tavily measured nothing,
  // and its numbers must never be quotable as a before/after in a PR.
  if (judged.length === 0 && failures.length === 0) {
    throw new Error(
      `scan:bakeoff completed every query but judged nothing. ${plan.length} queries returning zero rows between ` +
        "them is a broken response shape or an exhausted allowance, not a finding about the pack. " +
        `These numbers must not be reported as a before/after. See ${reportPath}.`,
    );
  }
  if (failures.length > 0) {
    throw new Error(
      `scan:bakeoff could not complete ${failures.length} of ${plan.length} queries. ` +
        `These results measure nothing and must not be reported as a before/after. See ${reportPath}.`,
    );
  }
});
