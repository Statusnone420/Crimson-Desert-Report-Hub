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

import { domainTier, registrableDomain } from "@/lib/automation/domains";
import { preScreenCandidate } from "@/lib/automation/relevance";
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

function judge(query: string, results: SearchResult[]): Judged[] {
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
    return {
      query,
      domain,
      trusted: registrable ? domainTier(registrable) === "trusted" : false,
      dated: Boolean(result.sourcePublishedAt),
      title: result.title,
      outcome: decision.keep
        ? "KEPT"
        : decision.observationKind
          ? `OBSERVATION:${decision.observationKind}`
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

  // The pack is imported, not restated, so this can never measure a query the
  // scanner has stopped running. `startDate` mirrors collectInputs exactly.
  const startDate = PATCH_PUBLISHED_AT.slice(0, 10);
  const packQueries = buildSearchQueries(Number.MAX_SAFE_INTEGER, PATCH_VERSION);
  const env = { TAVILY_API_KEY: key };

  const judged: Judged[] = [];
  const lines: string[] = [];
  const emit = (line = "") => {
    lines.push(line);
    console.log(line);
  };

  emit(`patch ${PATCH_VERSION} published ${startDate}`);
  emit(`${packQueries.length + 1} queries, one Tavily credit each, development key`);

  const failures: string[] = [];

  for (const query of [...packQueries, buildWireNewsQuery()]) {
    const isWire = query === buildWireNewsQuery();
    let results: SearchResult[] = [];
    try {
      results = await tavilySearch(query, {
        env,
        startDate,
        ...(isWire ? { topic: "news" as const } : {}),
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
    const rows = judge(query, results);
    judged.push(...rows);

    emit(`\n${isWire ? "[wire] " : ""}${query}`);
    if (rows.length === 0) emit("  (no results)");
    for (const row of rows) {
      emit(
        `  ${row.outcome.padEnd(30)} ${(row.dated ? "dated" : "  -  ").padEnd(6)} ${row.domain.padEnd(26)} ${row.title.slice(0, 58)}`,
      );
    }
  }

  const kept = judged.filter((row) => row.outcome === "KEPT").length;
  const observations = judged.filter((row) => row.outcome.startsWith("OBSERVATION")).length;
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
  emit(`results             ${judged.length}`);
  emit(`kept as signals     ${kept}`);
  emit(`routed to Brief     ${observations}`);
  emit(`dropped             ${dropped}`);
  emit(`dated               ${judged.filter((row) => row.dated).length}`);
  emit(`trusted results     ${judged.filter((row) => row.trusted).length}`);
  emit(`trusted domains     ${trustedDomains.size} (${[...trustedDomains].join(", ") || "NONE"})`);
  emit(`distinct domains    ${domains.size}`);
  emit(`non-community       ${independent.length} (${independent.join(", ") || "NONE"})`);

  const drops = new Map<string, number>();
  for (const row of judged) {
    if (!row.outcome.startsWith("DROPPED")) continue;
    drops.set(row.outcome, (drops.get(row.outcome) ?? 0) + 1);
  }
  emit("\ndrop reasons");
  for (const [reason, count] of [...drops].sort((a, b) => b[1] - a[1])) emit(`  ${reason.padEnd(34)} ${count}`);

  if (failures.length > 0) {
    emit(`\n${failures.length} of ${packQueries.length + 1} queries failed:`);
    for (const failure of failures) emit(`  ${failure}`);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const reportPath = path.join(OUT_DIR, `bakeoff-${PATCH_VERSION}.txt`);
  writeFileSync(reportPath, lines.join("\n"));
  console.log(`\nreport written to ${reportPath}`);

  // Diagnostics first, then fail. A run that could not reach Tavily measured nothing,
  // and its numbers must never be quotable as a before/after in a PR.
  if (failures.length > 0) {
    throw new Error(
      `scan:bakeoff could not complete ${failures.length} of ${packQueries.length + 1} queries. ` +
        `These results measure nothing and must not be reported as a before/after. See ${reportPath}.`,
    );
  }
});
