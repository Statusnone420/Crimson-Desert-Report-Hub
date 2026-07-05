import { CATEGORY_LABELS, PLATFORM_LABELS } from "@/lib/constants";

export type DossierCluster = {
  title: string;
  fixStatus: string;
  confidence: string;
  count: number;
  signalCount: number;
  directReportCount: number;
  verifiedReportCount: number;
  topPlatform: string | null;
};

export type DossierCommunitySignal = {
  title: string;
  source: string;
  url: string;
  summary: string;
  category: string;
  clusterTitle: string | null;
};

export type DossierVerifiedReport = {
  title: string;
  excerpt: string;
  platform: string | null;
};

export type DossierInput = {
  generatedAt: string;
  patchVersion: string;
  totalSignals: number;
  totalDirectReports: number;
  totalVerifiedReports: number;
  pendingCount: number;
  byCategory: Record<string, number>;
  platforms: Record<string, number>;
  clusters: DossierCluster[];
  communitySignals: DossierCommunitySignal[];
  reproNotes: { title: string; steps: string }[];
  directReportEvidenceUrls: string[];
  verifiedReports: DossierVerifiedReport[];
};

const label = (map: Record<string, string>, key: string) => map[key] ?? key;
const clusterStrength = (cluster: DossierCluster): number =>
  cluster.signalCount + cluster.directReportCount * 3 + cluster.verifiedReportCount * 5;
const clusterEvidenceTotal = (cluster: DossierCluster): number =>
  cluster.signalCount + cluster.directReportCount + cluster.verifiedReportCount;

function countSignalCategories(signals: DossierCommunitySignal[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const signal of signals) out[signal.category] = (out[signal.category] ?? 0) + 1;
  return out;
}

export function buildDeterministicDossier(d: DossierInput): string {
  const ranked = [...d.clusters].sort((a, b) => clusterStrength(b) - clusterStrength(a));
  const top = ranked.filter((cluster) => clusterEvidenceTotal(cluster) > 0);
  const gaps = ranked.filter((cluster) => cluster.confidence === "seed_unverified" || cluster.confidence === "low");
  const persists = top.filter((cluster) => cluster.fixStatus === "persists");
  const catEntries = Object.entries(d.byCategory).sort((a, b) => b[1] - a[1]);
  const signalCatEntries = Object.entries(countSignalCategories(d.communitySignals)).sort((a, b) => b[1] - a[1]);
  const platEntries = Object.entries(d.platforms).sort((a, b) => b[1] - a[1]);

  const lines: string[] = [];
  lines.push(`# Crimson Desert community report dossier — patch ${d.patchVersion}`);
  lines.push("");
  lines.push(`Generated ${d.generatedAt} by the Crimson Desert Report Hub (unofficial community tracker).`);
  lines.push("");
  lines.push("## Executive summary");
  lines.push("");
  lines.push(
    `This dossier separates ${d.totalSignals} automated community signals, ${d.totalDirectReports} approved direct reports, ` +
      `and ${d.totalVerifiedReports} verified report excerpts for patch ${d.patchVersion}` +
      (d.pendingCount > 0 ? ` (${d.pendingCount} more awaiting moderation)` : "") +
      `. The largest direct-report category is ${catEntries[0] ? label(CATEGORY_LABELS, catEntries[0][0]) : "n/a"}` +
      (catEntries[0] ? ` with ${catEntries[0][1]} reports` : "") +
      `. Most affected platform: ${platEntries[0] ? label(PLATFORM_LABELS, platEntries[0][0]) : "n/a"}.`,
  );
  if (persists.length > 0) {
    lines.push("");
    lines.push(
      `${persists.length} issue(s) below are marked **persists after a claimed fix** — patch notes stated a fix, ` +
        "but community reports since the patch indicate the problem continues. These are flagged as the highest-value items to re-examine.",
    );
  }
  lines.push("");
  lines.push("## Top issues");
  lines.push("");
  lines.push(
    "| Rank | Issue | Community signals | Direct reports | Verified reports | Fix status | Confidence | Most-affected platform |",
  );
  lines.push("| ---- | ----- | ----------------- | -------------- | ---------------- | ---------- | ---------- | ---------------------- |");
  top.forEach((cluster, index) => {
    lines.push(
      `| ${index + 1} | ${cluster.title} | ${cluster.signalCount} | ${cluster.directReportCount} | ${cluster.verifiedReportCount} | ${cluster.fixStatus.replace(/_/g, " ")} | ${cluster.confidence.replace(/_/g, " ")} | ${
        cluster.topPlatform ? label(PLATFORM_LABELS, cluster.topPlatform) : "—"
      } |`,
    );
  });
  if (top.length === 0) lines.push("| — | No clusters have public signals or confirmed reports yet | — | — | — | — | — | — |");
  lines.push("");
  lines.push("## Community signal summary");
  lines.push("");
  lines.push(`- Total public automated community signals: ${d.totalSignals}`);
  for (const [category, count] of signalCatEntries) lines.push(`- ${label(CATEGORY_LABELS, category)}: ${count} signals`);
  if (signalCatEntries.length === 0) lines.push("- No public automated community signals yet.");
  if (d.communitySignals.length > 0) {
    lines.push("");
    for (const signal of d.communitySignals.slice(0, 10)) {
      lines.push(
        `- **${signal.title}** (${signal.source}${signal.clusterTitle ? `, ${signal.clusterTitle}` : ""}): ${signal.summary} — ${signal.url}`,
      );
    }
  }
  lines.push("");
  lines.push("## Direct reports");
  lines.push("");
  lines.push(`- Total approved direct reports: ${d.totalDirectReports}`);
  lines.push(`- Awaiting moderation: ${d.pendingCount}`);
  for (const [category, count] of catEntries) lines.push(`- ${label(CATEGORY_LABELS, category)}: ${count} direct reports`);
  if (catEntries.length === 0) lines.push("- No approved direct reports yet.");
  lines.push("");
  lines.push("## Platform and hardware breakdown");
  lines.push("");
  for (const [platform, count] of platEntries) lines.push(`- ${label(PLATFORM_LABELS, platform)}: ${count} direct reports`);
  if (platEntries.length === 0) lines.push("- No approved direct reports yet.");
  lines.push("");
  lines.push("## Reproduction patterns");
  lines.push("");
  for (const note of d.reproNotes) lines.push(`- **${note.title}**: ${note.steps}`);
  if (d.reproNotes.length === 0) lines.push("- No reproduction steps captured yet.");
  lines.push("");
  lines.push("## Evidence links");
  lines.push("");
  lines.push("Direct report evidence links only. Automated source URLs are listed under Community signal summary.");
  for (const url of d.directReportEvidenceUrls) lines.push(`- ${url}`);
  if (d.directReportEvidenceUrls.length === 0) lines.push("- No direct report evidence links yet.");
  lines.push("");
  lines.push("## Verified reports");
  lines.push("");
  lines.push(`- Total verified report excerpts: ${d.totalVerifiedReports}`);
  for (const report of d.verifiedReports.slice(0, 15)) {
    lines.push(
      `- **${report.title}**${report.platform ? ` (${label(PLATFORM_LABELS, report.platform)})` : ""}: ${report.excerpt}`,
    );
  }
  if (d.verifiedReports.length === 0) lines.push("- No admin-approved report excerpts yet.");
  lines.push("");
  lines.push("## Known confidence gaps");
  lines.push("");
  for (const gap of gaps) {
    lines.push(
      `- ${gap.title}: confidence is ${gap.confidence.replace(/_/g, " ")}` +
        (gap.directReportCount === 0
          ? ` and no direct reports yet (${gap.signalCount} community signals) — treat as unconfirmed.`
          : ` with ${gap.directReportCount} direct reports and ${gap.signalCount} community signals.`),
    );
  }
  if (gaps.length === 0) lines.push("- None — all listed clusters are backed by direct reports.");
  lines.push("");
  lines.push("## Recommended wording for Pearl Abyss");
  lines.push("");
  lines.push(
    `> Community telemetry for patch ${d.patchVersion} contains ${d.totalSignals} automated public signals, ` +
      `${d.totalDirectReports} approved direct reports, and ${d.totalVerifiedReports} verified excerpts. It shows ` +
      `${
        catEntries[0]
          ? `${label(CATEGORY_LABELS, catEntries[0][0]).toLowerCase()} as the dominant direct-report complaint (${catEntries[0][1]}/${d.totalDirectReports} reports)`
          : "no dominant category yet"
      }` +
      (persists.length > 0
        ? `, and ${persists.length} previously-patched issue(s) still being reported post-fix. We recommend prioritizing re-verification of the claimed fixes listed above.`
        : ". No previously-patched issues are currently reported as recurring."),
  );
  lines.push("");
  return lines.join("\n");
}
