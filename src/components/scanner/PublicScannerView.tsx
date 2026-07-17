import Link from "next/link";
import { ConfirmButtons } from "@/components/ConfirmButtons";
import { SourceRadar } from "@/components/scanner/SourceRadar";
import { ReadoutMark, SectionHeader } from "@/components/ui";
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

  return (
    <div className="page-stack editorial-page scanner-page">
      <section className="editorial-page__hero">
        <SectionHeader
          as="h1"
          label="Public source radar"
          title="Scanner"
          description={`Crimson Desert ${patchVersion} web chatter, filtered into source health, mapped leads, and published links. A lead is a rumor with a link — players can add a confirmation signal on the issue board.`}
        />
      </section>

      <SourceRadar data={data} integrations={integrations} />

      <section className="brief-section">
        <div className="section-intro">
          <div>
            <div className="eyebrow">Mapped leads</div>
            <h2>Questions from the radar</h2>
          </div>
          <p>
            Do any of these match your game? These are mapped leads, not evidence. A tap adds a counted player signal
            without publishing the private candidate link.
          </p>
        </div>
        {leadQuestions.length > 0 ? (
          <div className="issue-board">
            {visibleLeadQuestions.map((cluster) => (
              <article key={cluster.id} className="issue-entry">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
                  <h3 className="min-w-0 text-base font-semibold">{cluster.title}</h3>
                  <ReadoutMark label="Radar lead" tone="blue" />
                </div>
                <p className="mt-2 max-w-prose text-xs leading-5" style={{ color: "var(--text-dim)" }}>
                  The scanner mapped {cluster.candidateSignalCount}{" "}
                  {cluster.candidateSignalCount === 1 ? "lead" : "leads"} to this issue. Leads do not change its
                  evidence count.
                </p>
                <div className="mt-3">
                  <ConfirmButtons
                    clusterId={cluster.id}
                    storageScope={patchFamily}
                    question="Do you have this?"
                    kinds={["have_it"]}
                    counts={{ have_it: cluster.confirmations.byKind.have_it.count }}
                  />
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p
            className="border-t pt-4 text-sm leading-6"
            style={{ borderColor: "var(--ink-rule)", color: "var(--text-dim)" }}
          >
            {data.scannerConnected
              ? "No mapped radar questions this patch. Official patch context remains available."
              : "No mapped radar questions are available in this environment. Official patch context remains available."}
          </p>
        )}
        {leadQuestions.length > visibleLeadQuestions.length ? (
          <p className="mt-3 text-xs" style={{ color: "var(--text-faint)" }}>
            Showing {visibleLeadQuestions.length} of {leadQuestions.length} mapped questions. The complete set remains
            listed on the issue board.
          </p>
        ) : null}
      </section>

      {!data.scannerConnected ? (
        <p
          className="border-t pt-4 text-sm leading-6"
          style={{ borderColor: "var(--ink-rule)", color: "var(--text-dim)" }}
        >
          Offline view. Scanner data is unavailable in this environment; private candidates and rejected URLs stay
          hidden.
        </p>
      ) : null}

      <section className="method-note" aria-label="Display rule">
        <div className="eyebrow">Display rule</div>
        <p>
          Source links display only after an approved player report plus source trust, or corroboration across
          independent sources (with stricter thresholds for untrusted sites). The link still remains a lead, not
          player evidence.
        </p>
        <div className="method-note__links">
          <Link href="/about" className="link">Read the method ↗</Link>
        </div>
      </section>

      <section className="rule-grid" aria-label="Privacy and publishing posture">
        <div>
          <h2>Privacy</h2>
          <p className="mt-2 text-sm leading-6" style={{ color: "var(--text-faint)" }}>
            Raw submissions, rejected candidates, scanner logs, and source URLs that fail review stay private.
          </p>
        </div>
        <div>
          <h2>Publishing rule</h2>
          <p className="mt-2 text-sm leading-6" style={{ color: "var(--text-faint)" }}>
            A full issue card needs an approved player report or corroboration from independent public sources.
          </p>
        </div>
        <div>
          <h2>Published links</h2>
          <p className="mt-2 text-sm leading-6" style={{ color: "var(--text-faint)" }}>
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
