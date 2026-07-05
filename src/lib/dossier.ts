import { CATEGORY_LABELS, PLATFORM_LABELS } from "@/lib/constants";

export type DossierCluster = {
  title: string;
  fixStatus: string;
  confidence: string;
  count: number;
  topPlatform: string | null;
};

export type DossierInput = {
  generatedAt: string;
  patchVersion: string;
  totalApproved: number;
  pendingCount: number;
  byCategory: Record<string, number>;
  platforms: Record<string, number>;
  clusters: DossierCluster[];
  reproNotes: { title: string; steps: string }[];
  evidenceUrls: string[];
};

const label = (map: Record<string, string>, key: string) => map[key] ?? key;

export function buildDeterministicDossier(d: DossierInput): string {
  const ranked = [...d.clusters].sort((a, b) => b.count - a.count);
  const top = ranked.filter((cluster) => cluster.count > 0);
  const gaps = ranked.filter((cluster) => cluster.confidence === "seed_unverified" || cluster.confidence === "low");
  const persists = top.filter((cluster) => cluster.fixStatus === "persists");
  const catEntries = Object.entries(d.byCategory).sort((a, b) => b[1] - a[1]);
  const platEntries = Object.entries(d.platforms).sort((a, b) => b[1] - a[1]);

  const lines: string[] = [];
  lines.push(`# Crimson Desert community report dossier — patch ${d.patchVersion}`);
  lines.push("");
  lines.push(`Generated ${d.generatedAt} by the Crimson Desert Report Hub (unofficial community tracker).`);
  lines.push("");
  lines.push("## Executive summary");
  lines.push("");
  lines.push(
    `This dossier aggregates ${d.totalApproved} moderated community reports for patch ${d.patchVersion}` +
      (d.pendingCount > 0 ? ` (${d.pendingCount} more awaiting moderation)` : "") +
      `. The largest category is ${catEntries[0] ? label(CATEGORY_LABELS, catEntries[0][0]) : "n/a"}` +
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
  lines.push("| Rank | Issue | Reports | Fix status | Confidence | Most-affected platform |");
  lines.push("| ---- | ----- | ------- | ---------- | ---------- | ---------------------- |");
  top.forEach((cluster, index) => {
    lines.push(
      `| ${index + 1} | ${cluster.title} | ${cluster.count} | ${cluster.fixStatus.replace(/_/g, " ")} | ${cluster.confidence.replace(/_/g, " ")} | ${
        cluster.topPlatform ? label(PLATFORM_LABELS, cluster.topPlatform) : "—"
      } |`,
    );
  });
  if (top.length === 0) lines.push("| — | No clusters have confirmed reports yet | — | — | — | — |");
  lines.push("");
  lines.push("## Platform and hardware breakdown");
  lines.push("");
  for (const [platform, count] of platEntries) lines.push(`- ${label(PLATFORM_LABELS, platform)}: ${count} reports`);
  if (platEntries.length === 0) lines.push("- No approved reports yet.");
  lines.push("");
  for (const [category, count] of catEntries) lines.push(`- ${label(CATEGORY_LABELS, category)}: ${count} reports`);
  lines.push("");
  lines.push("## Reproduction patterns");
  lines.push("");
  for (const note of d.reproNotes) lines.push(`- **${note.title}**: ${note.steps}`);
  if (d.reproNotes.length === 0) lines.push("- No reproduction steps captured yet.");
  lines.push("");
  lines.push("## Evidence links");
  lines.push("");
  for (const url of d.evidenceUrls) lines.push(`- ${url}`);
  if (d.evidenceUrls.length === 0) lines.push("- No admin-verified evidence links yet.");
  lines.push("");
  lines.push("## Known confidence gaps");
  lines.push("");
  for (const gap of gaps) {
    lines.push(
      `- ${gap.title}: confidence is ${gap.confidence.replace(/_/g, " ")}` +
        (gap.count === 0 ? " and no direct community reports yet — treat as unconfirmed." : ` with ${gap.count} reports.`),
    );
  }
  if (gaps.length === 0) lines.push("- None — all listed clusters are backed by direct reports.");
  lines.push("");
  lines.push("## Recommended wording for Pearl Abyss");
  lines.push("");
  lines.push(
    `> Community telemetry (self-reported, moderated) for patch ${d.patchVersion} shows ` +
      `${
        catEntries[0]
          ? `${label(CATEGORY_LABELS, catEntries[0][0]).toLowerCase()} as the dominant complaint (${catEntries[0][1]}/${d.totalApproved} reports)`
          : "no dominant category yet"
      }` +
      (persists.length > 0
        ? `, and ${persists.length} previously-patched issue(s) still being reported post-fix. We recommend prioritizing re-verification of the claimed fixes listed above.`
        : ". No previously-patched issues are currently reported as recurring."),
  );
  lines.push("");
  return lines.join("\n");
}
