import Link from "next/link";
import { ConfirmButtons } from "@/components/ConfirmButtons";
import { SourceRadar } from "@/components/scanner/SourceRadar";
import { ReadoutBadge } from "@/components/ui";
import type { IntegrationStatus } from "@/lib/env";
import { patchFamilyKey } from "@/lib/patchWatch";
import type { DecoratedCluster, PublicScannerData } from "@/lib/queries";

export function PublicScannerView({
  data,
  integrations,
  patchVersion,
  leadQuestions,
}: {
  data: PublicScannerData;
  integrations: IntegrationStatus[];
  patchVersion: string;
  leadQuestions: DecoratedCluster[];
}) {
  const patchFamily = patchFamilyKey(patchVersion) ?? patchVersion;
  const visibleLeadQuestions = leadQuestions.slice(0, 4);
  const scannerLabel = data.scannerConnected
    ? data.scannerActive
      ? "Scanner scheduled"
      : "Scanner paused"
    : "Scanner unavailable";
  const scannerBadgeClass = data.scannerConnected
    ? data.scannerActive
      ? "badge badge-green badge-dot"
      : "badge badge-amber badge-dot"
    : "badge badge-dim badge-dot";

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <p className="stat-label">Public source radar</p>
          <h1 className="h-display">Scanner</h1>
          <p className="max-w-2xl text-sm leading-6" style={{ color: "var(--text-dim)" }}>
            {`Crimson Desert ${patchVersion} web chatter, filtered into source health, mapped leads, and published links. A lead is a rumor with a link — players can add a confirmation signal on the issue board.`}
          </p>
        </div>
        <span className={scannerBadgeClass}>{scannerLabel}</span>
      </section>

      <SourceRadar data={data} integrations={integrations} />

      <section className="panel space-y-4">
        <div className="space-y-1">
          <p className="stat-label">Mapped leads</p>
          <h2 className="h-section">Questions from the radar</h2>
          <p className="text-sm leading-6" style={{ color: "var(--text-dim)" }}>
            Do any of these match your game? These are mapped leads, not evidence. A tap adds a counted player signal
            without publishing the private candidate link.
          </p>
        </div>
        {leadQuestions.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-2">
            {visibleLeadQuestions.map((cluster) => (
              <article key={cluster.id} className="panel-inset space-y-3 border p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h3 className="text-sm font-semibold">{cluster.title}</h3>
                  <ReadoutBadge label="Radar lead" tone="blue" />
                </div>
                <p className="text-xs leading-5" style={{ color: "var(--text-dim)" }}>
                  The scanner mapped {cluster.candidateSignalCount}{" "}
                  {cluster.candidateSignalCount === 1 ? "lead" : "leads"} to this issue. Leads do not change its
                  evidence count.
                </p>
                <ConfirmButtons
                  clusterId={cluster.id}
                  storageScope={patchFamily}
                  question="Do you have this?"
                  kinds={["have_it"]}
                  counts={{ have_it: cluster.confirmations.byKind.have_it.count }}
                />
              </article>
            ))}
          </div>
        ) : (
          <p className="panel-inset border px-3 py-2 text-sm" style={{ color: "var(--text-dim)" }}>
            {data.scannerConnected
              ? "No mapped radar questions this patch. Official patch context remains available."
              : "No mapped radar questions are available in this environment. Official patch context remains available."}
          </p>
        )}
        {leadQuestions.length > visibleLeadQuestions.length ? (
          <p className="text-xs" style={{ color: "var(--text-faint)" }}>
            Showing {visibleLeadQuestions.length} of {leadQuestions.length} mapped questions. The complete set remains
            listed on the issue board.
          </p>
        ) : null}
      </section>

      {!data.scannerConnected ? (
        <p className="panel-inset border px-4 py-3 text-sm leading-6" style={{ color: "var(--text-dim)" }}>
          Offline view. Scanner data is unavailable in this environment; private candidates and rejected URLs stay
          hidden.
        </p>
      ) : null}

      <p className="panel-inset border px-4 py-3 text-sm leading-6" style={{ color: "var(--text-dim)" }}>
        Source links display only after an approved player report plus source trust, or corroboration across
        independent sources (with stricter thresholds for untrusted sites). The link still remains a lead, not player
        evidence.
      </p>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="panel space-y-1">
          <h2 className="text-sm font-semibold">Privacy</h2>
          <p className="text-sm leading-6" style={{ color: "var(--text-faint)" }}>
            Raw submissions, rejected candidates, scanner logs, and source URLs that fail review stay private.
          </p>
        </div>
        <div className="panel space-y-1">
          <h2 className="text-sm font-semibold">Publishing rule</h2>
          <p className="text-sm leading-6" style={{ color: "var(--text-faint)" }}>
            A full issue card needs an approved player report or corroboration from independent public sources.
          </p>
        </div>
        <div className="panel space-y-1">
          <h2 className="text-sm font-semibold">Published links</h2>
          <p className="text-sm leading-6" style={{ color: "var(--text-faint)" }}>
            Published issues show reviewed source links and approved report excerpts so readers can inspect each
            input themselves.
          </p>
        </div>
      </section>

      <section className="flex flex-wrap gap-3">
        <Link href="/issues" className="btn">
          See the issue board
        </Link>
        <Link href="/report" className="btn btn-ghost">
          Submit a report
        </Link>
      </section>
    </div>
  );
}
