"use client";

import Link from "next/link";
import { useState } from "react";
import type { CollectionHealth, CollectionHealthLane } from "@/lib/collectionHealth";

export type OperatorRunSummary = {
  startedAt: string;
  finishedAt: string | null;
  status: "success" | "partial" | "failed" | "skipped" | "running" | "other";
  skipSummary: string;
};

export type OperatorOverviewData = {
  operatorReadAvailable: boolean;
  scannerReadAvailable: boolean;
  scannerReadFailures: string[];
  scannerFailedRuns: number | null;
  collection: CollectionHealth;
  runs: OperatorRunSummary[];
};

function captureTime(value: string | null): string {
  if (!value) return "Unknown time";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone: "UTC",
    }) + " UTC"
    : "Unknown time";
}

function scannerFailureLabel(failure: string): string {
  const labels: Record<string, string> = {
    week: "Weekly scanner record",
    heartbeat: "Scanner heartbeat",
    awaiting: "Awaiting-corroboration register",
    published: "Published-issue register",
  };
  return labels[failure] ?? "Scanner register";
}

export function runStatusLabel(status: OperatorRunSummary["status"]): string {
  if (status === "success") return "Completed";
  if (status === "partial") return "Completed with limits";
  if (status === "failed") return "Failed";
  if (status === "skipped") return "Skipped";
  if (status === "running") return "Running";
  return "Unknown";
}

function runTone(status: OperatorRunSummary["status"]): string {
  return status === "failed" ? "op-danger" : status === "other" ? "op-caution" : "";
}

function laneTone(lane: CollectionHealthLane): string {
  return lane.state === "ok" || lane.state === "disabled"
    ? ""
    : lane.state === "unknown" || lane.state === "unavailable"
      ? "op-danger"
      : "op-caution";
}

function RunRecord({ runs, unavailable }: { runs: OperatorRunSummary[]; unavailable: boolean }) {
  const [selected, setSelected] = useState(() => Math.max(0, runs.length - 1));
  if (unavailable) {
    return (
      <section className="op-run-record" aria-labelledby="op-run-title">
        <div className="op-section-heading"><div><p className="op-eyebrow">The scanner record</p><h2 id="op-run-title" style={{ fontSize: 48 }}>A little history. A clear picture.</h2></div><span className="op-caption">Run history unavailable</span></div>
        <p className="op-unavailable">The authenticated run record could not be read. Run outcomes and scan history are unavailable.</p>
      </section>
    );
  }
  if (runs.length === 0) {
    return (
      <section className="op-run-record" aria-labelledby="op-run-title">
        <div className="op-section-heading"><div><p className="op-eyebrow">The scanner record</p><h2 id="op-run-title" style={{ fontSize: 48 }}>A little history. A clear picture.</h2></div><span className="op-caption">No run record returned</span></div>
        <p className="op-unavailable">No scanner runs are available to this page load, so the recent run strip is unavailable.</p>
      </section>
    );
  }
  const ordered = [...runs].reverse();
  const active = ordered[Math.min(selected, ordered.length - 1)];

  return (
    <section className="op-run-record" aria-labelledby="op-run-title">
      <div className="op-section-heading"><div><p className="op-eyebrow">The scanner record</p><h2 id="op-run-title" style={{ fontSize: 48 }}>A little history. A clear picture.</h2></div><span className="op-caption">{runs.length} latest recorded run{runs.length === 1 ? "" : "s"} · UTC</span></div>
      <div className="op-run-strip" role="group" aria-label="Explore the latest scanner runs">
        {ordered.map((run, index) => (
          <button key={run.startedAt + index} type="button" aria-label={captureTime(run.startedAt) + ", " + runStatusLabel(run.status)} aria-pressed={selected === index} className={"op-run op-run-" + run.status} onClick={() => setSelected(index)}>
            <span /><small>{captureTime(run.startedAt).replace(/.*?,\s*/, "")}</small>
          </button>
        ))}
      </div>
      <div className="op-run-detail" aria-live="polite"><span className={"op-status " + runTone(active.status)}>{runStatusLabel(active.status)}</span><strong>{captureTime(active.finishedAt ?? active.startedAt)}</strong><p>{active.skipSummary}</p></div>
      <p className="op-legend"><span><i className="op-completed" />Completed</span><span><i className="op-skipped" />Completed with limits</span><span><i className="op-failed" />Failed</span></p>
    </section>
  );
}

export function scannerSummary(scannerReadAvailable: boolean, scannerFailedRuns: number | null) {
  return !scannerReadAvailable
    ? { label: "Scanner", status: "Unavailable", detail: "The scanner aggregate read did not complete.", tone: "op-danger" }
    : scannerFailedRuns === null
      ? { label: "Scanner", status: "Unknown", detail: "The failed-run total could not be read.", tone: "op-caution" }
      : scannerFailedRuns > 0
        ? { label: "Scanner", status: "Needs attention", detail: scannerFailedRuns + " failed run" + (scannerFailedRuns === 1 ? "" : "s") + " in the last 7 days.", tone: "op-danger" }
        : { label: "Scanner", status: "No recorded failures", detail: "No failed runs are recorded in the last 7 days. This does not establish a schedule.", tone: "" };
}

function Services({ data }: { data: OperatorOverviewData }) {
  const scannerState = scannerSummary(data.scannerReadAvailable, data.scannerFailedRuns);
  const lanes = data.collection.lanes;

  return (
    <section className="op-services" aria-labelledby="op-services-title">
      <div className="op-section-heading"><h2 id="op-services-title">Behind the pages</h2><span className="op-caption">Current stored readings</span></div>
      <div className="op-service"><span className="op-icon" aria-hidden="true" /><div><h3>{scannerState.label}</h3><p>{scannerState.detail}</p></div><span className={"op-status " + scannerState.tone}>{scannerState.status}</span></div>
      {lanes.map((lane) => (
        <div className="op-service" key={lane.key}>
          <span className="op-icon" aria-hidden="true" />
          <div><h3>{lane.label}</h3><p>{lane.lastSuccessfulCaptureAt ? "Last successful capture " + captureTime(lane.lastSuccessfulCaptureAt) + ". " : ""}{lane.detail}</p></div>
          <span className={"op-status " + laneTone(lane)}>{lane.labelText}</span>
        </div>
      ))}
    </section>
  );
}

function Attention({ data, unknown, attentionCount }: { data: OperatorOverviewData; unknown: boolean; attentionCount: number }) {
  const namedScannerFailures = data.scannerReadFailures.map(scannerFailureLabel);
  const providerFailures = data.collection.lanes.filter((lane) => lane.needsAttention || lane.state === "unknown");
  if (!unknown && attentionCount === 0) return null;

  return (
    <section className="op-attention" aria-labelledby="op-attention-title">
      <div className="op-section-heading"><div><p className="op-eyebrow">{unknown ? "Check the connection" : "Needs attention"}</p><h2 id="op-attention-title">{unknown ? "A missing read is not an empty queue." : "A few checks need a look."}</h2></div></div>
      <div className="op-exceptions">
        {!data.operatorReadAvailable ? <article><span className="op-status op-danger">Operator record · Unavailable</span><h3>Run history could not be read.</h3><p>The overview cannot verify current scanner outcomes. Open the scanner monitor to inspect the authenticated records.</p><Link className="op-link" href="/scanner">Open scanner monitor →</Link></article> : null}
        {!data.scannerReadAvailable ? <article><span className="op-status op-danger">Source radar · Unavailable</span><h3>The scanner aggregate could not be read.</h3><p>Lead counts and scanner health are unavailable for this page load. This does not mean the scanner is idle.</p><Link className="op-link" href="/scanner">Inspect scanner monitor →</Link></article> : null}
        {namedScannerFailures.map((failure) => <article key={failure}><span className="op-status op-caution">Scanner · Unavailable</span><h3>{failure} could not be read.</h3><p>Its value is unknown for this page load. It is not a report of zero activity.</p><Link className="op-link" href="/scanner">Inspect scanner monitor →</Link></article>)}
        {providerFailures.map((lane) => <article key={lane.key}><span className={"op-status " + laneTone(lane)}>{lane.label} · {lane.labelText}</span><h3>{lane.nextAction ?? "Check the latest provider capture."}</h3><p>{lane.detail}</p><Link className="op-link" href="/scanner">Inspect scanner monitor →</Link></article>)}
        {!unknown && data.scannerFailedRuns !== null && data.scannerFailedRuns > 0 ? <article><span className="op-status op-danger">Scanner · Failed run</span><h3>Recent scan failures need review.</h3><p>The scanner has {data.scannerFailedRuns} failed run{data.scannerFailedRuns === 1 ? "" : "s"} in its seven-day aggregate.</p><Link className="op-link" href="/scanner">Inspect scanner monitor →</Link></article> : null}
      </div>
    </section>
  );
}

export function OperatorOverview({ data }: { data: OperatorOverviewData }) {
  const unknown =
    !data.operatorReadAvailable ||
    !data.scannerReadAvailable ||
    data.scannerReadFailures.length > 0 ||
    data.collection.status === "unknown";
  const providerAttention = data.collection.attentionCount;
  const scannerAttention = data.scannerFailedRuns ?? 0;
  const attentionCount = unknown ? null : providerAttention + scannerAttention;
  const quiet = attentionCount === 0;

  return (
    <div id="operator-top" className="op-shell">
      <section className={"op-lead" + (unknown ? " op-lead-unknown" : !quiet ? " op-lead-attention" : "")} aria-labelledby="op-status-title">
        <div className="op-lead-copy">
          <p className="op-eyebrow"><span className="op-lamp" />{unknown ? "Health not verified" : quiet ? "All required checks read" : "Exceptions need attention"}</p>
          <h1 id="op-status-title">{unknown ? "Status unavailable." : quiet ? "Running quietly." : "A few things need a look."}</h1>
          <p>{unknown ? "One or more required reads did not complete. Restore access and review the named unavailable records before relying on this overview." : quiet ? "The scanner, provider records, and authenticated run history were read. No current exception is recorded here." : "Start with the named scanner or provider exception. This page only links to the places where an operator can act."}</p>
        </div>
        <div className="op-attention-count"><span>{unknown ? "Needs attention" : "Checks to review"}</span><strong className={unknown ? "op-count-unknown" : ""}>{attentionCount === null ? "—" : attentionCount}</strong><span>{unknown ? "Count unavailable" : quiet ? "No exceptions recorded" : "Scanner and provider checks"}</span></div>
      </section>

      <Attention data={data} unknown={unknown} attentionCount={attentionCount ?? 0} />
      <div className="op-overview-spread">
        <Services data={data} />
        <aside className="op-daily"><p className="op-eyebrow">Your daily check</p><h2>A second set of eyes.</h2><div className="op-clock"><strong>9:00<span>am</span></strong><span>Eastern · Every day</span></div><p>Schedule confirmed by you. This page does not query the ChatGPT task, so it does not claim a live task status.</p><div className="op-schedule-note"><span className="op-status">Daily schedule</span><p>Use your ChatGPT task for the result and any action request.</p></div></aside>
      </div>
      <RunRecord runs={data.runs} unavailable={!data.operatorReadAvailable} />
      <section className="op-tools" aria-labelledby="op-tools-title">
        <div><p className="op-eyebrow">Operator tools</p><h2 id="op-tools-title">Inspect first. Act in the right console.</h2><p>These links open existing authenticated controls. This overview does not change reports, scanner state, providers, or dossiers.</p></div>
        <div className="op-tool-links"><Link className="op-link" href="/scanner">Scanner monitor →</Link><Link className="op-link" href="/admin">Report review →</Link><Link className="op-link" href="/admin/compile">Dossiers →</Link></div>
      </section>
      <div className="op-footer"><Link href="/">← Back to the paper</Link><a href="#operator-top">Back to top ↑</a></div>
    </div>
  );
}
