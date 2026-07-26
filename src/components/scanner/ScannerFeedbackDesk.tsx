"use client";

import { useMemo, useState } from "react";
import { recordScannerDecision, undoScannerDecision } from "@/app/admin/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { scannerRuleScopeValue, type ScannerRuleScope } from "@/lib/automation/feedback";
import { plainSkipPhrase } from "@/lib/automation/runDisplay";
import { groupScannerLessons, summarizeScannerLessons } from "@/lib/scannerLessonGroups";
import type { RejectedCandidateRow, ScannerFeedbackRuleRow } from "@/lib/queries";

const DEFAULT_VISIBLE_CANDIDATES = 2;

function relativeTime(iso: string, nowMs: number): string {
  const minutes = Math.max(0, Math.floor((nowMs - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function expiryTime(iso: string, nowMs: number): string {
  const minutes = Math.ceil((new Date(iso).getTime() - nowMs) / 60_000);
  if (minutes <= 0) return "expired";
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 24) return `in ${hours}h`;
  return `in ${Math.ceil(hours / 24)}d`;
}

function DecisionCard({
  candidate,
  nowMs,
  feedbackLearningAvailable,
}: {
  candidate: RejectedCandidateRow;
  nowMs: number;
  feedbackLearningAvailable: boolean;
}) {
  const [scope, setScope] = useState<ScannerRuleScope>("exact_url");
  const storedScopeValue = scannerRuleScopeValue(scope, {
    url: candidate.url,
    sourceDomain: candidate.source_domain,
  });
  const scopeLabel =
    scope === "exact_url" ? "this exact page" : (storedScopeValue ?? "scope unavailable");

  return (
    <article className="decision-card">
      <div className="decision-card__heading">
        <div>
          <p className="decision-card__eyebrow">
            {candidate.source_domain ?? "unknown source"} · discovered {relativeTime(candidate.created_at, nowMs)}
          </p>
          <h3 className="decision-card__title">{candidate.title}</h3>
        </div>
        <a href={candidate.url} target="_blank" rel="noreferrer noopener" className="dispatch-link">
          Inspect source ↗
        </a>
      </div>

      {candidate.snippet ? <p className="decision-card__snippet">{candidate.snippet}</p> : null}

      <ol className="provenance-path" aria-label="Why this candidate is here">
        <li>
          <span>1</span>
          <div><b>Discovered</b><small>{candidate.source_domain ?? "Source unavailable"}</small></div>
        </li>
        <li>
          <span>2</span>
          <div><b>Screened</b><small>{plainSkipPhrase(candidate.reason)}</small></div>
        </li>
        <li>
          <span>3</span>
          <div><b>Held private</b><small>Expires {expiryTime(candidate.expires_at, nowMs)}</small></div>
        </li>
      </ol>

      <div className="decision-card__actions">
        <form action={recordScannerDecision}>
          <input type="hidden" name="id" value={candidate.id} />
          <input type="hidden" name="decision" value="relevant" />
          <input type="hidden" name="scope" value="exact_url" />
          <input type="hidden" name="reason" value="Operator inspected this page and confirmed it is a relevant Crimson Desert issue lead." />
          <SubmitButton className="dispatch-btn" pendingText="Keeping...">
            Keep as relevant
          </SubmitButton>
        </form>

        {feedbackLearningAvailable ? (
          <details className="decision-card__reject">
            <summary className="tap-btn">Reject and teach…</summary>
            <form action={recordScannerDecision} className="decision-form dispatch-field">
              <input type="hidden" name="id" value={candidate.id} />
              <label>
                <span>Why is it wrong?</span>
                <select name="decision" defaultValue={candidate.reason === "wrong_patch" ? "wrong_patch" : "off_topic"}>
                  <option value="off_topic">Off-topic</option>
                  <option value="wrong_patch">Wrong patch</option>
                  <option value="not_issue_report">Not an issue report</option>
                  <option value="duplicate">Duplicate</option>
                </select>
              </label>
              <label>
                <span>Operator reason</span>
                <textarea
                  name="reason"
                  minLength={3}
                  maxLength={500}
                  required
                  defaultValue={`Reviewed source: ${plainSkipPhrase(candidate.reason)}.`}
                />
              </label>
              <label>
                <span>Apply this lesson to</span>
                <select
                  name="scope"
                  value={scope}
                  onChange={(event) => setScope(event.target.value as ScannerRuleScope)}
                >
                  <option value="exact_url">This exact page</option>
                  <option value="source_path">This source section</option>
                  <option value="source_domain">This entire domain</option>
                </select>
              </label>
              <p className="decision-form__scope">Rule target: <code>{scopeLabel}</code></p>
              {scope !== "exact_url" ? (
                <label className="decision-form__confirm">
                  <input type="checkbox" name="confirm_broad" value="true" required />
                  <span>I understand this broader rule can affect future scanner results.</span>
                </label>
              ) : null}
              <SubmitButton className="tap-btn tap-btn--danger" pendingText="Recording...">
                Record decision
              </SubmitButton>
            </form>
          </details>
        ) : (
          <p className="decision-form__scope">Scanner learning unlocks after the database schema update.</p>
        )}
      </div>
    </article>
  );
}

export function ScannerFeedbackDesk({
  candidates,
  nowIso,
  feedbackLearningAvailable = true,
}: {
  candidates: RejectedCandidateRow[];
  nowIso: string;
  feedbackLearningAvailable?: boolean;
}) {
  const [query, setQuery] = useState("");
  const nowMs = new Date(nowIso).getTime();
  const undecided = useMemo(
    () => candidates.filter(
      (candidate) => !candidate.rescued_at && !candidate.decision_id && !candidate.feedback_rule_id,
    ),
    [candidates],
  );
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return undecided;
    return undecided.filter((candidate) =>
      [candidate.title, candidate.source_domain, candidate.snippet, plainSkipPhrase(candidate.reason)].some((value) =>
        value?.toLowerCase().includes(needle),
      ),
    );
  }, [query, undecided]);

  if (undecided.length === 0) {
    return <p className="decision-empty">Nothing needs teaching right now. New auto-rejects remain private and expire on their own.</p>;
  }

  return (
    <>
      <div className="decision-toolbar">
        <label className="dispatch-field">
          <span className="sr-only">Search optional scanner review</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search title, source, or rejection reason"
          />
        </label>
        <span>{query ? `${filtered.length} matches` : `${undecided.length} recent candidates`}</span>
      </div>
      <div className="decision-list">
        {filtered.slice(0, query ? filtered.length : DEFAULT_VISIBLE_CANDIDATES).map((candidate) => (
          <DecisionCard
            key={candidate.id}
            candidate={candidate}
            nowMs={nowMs}
            feedbackLearningAvailable={feedbackLearningAvailable}
          />
        ))}
      </div>
      {!query && filtered.length > DEFAULT_VISIBLE_CANDIDATES ? (
        <details className="decision-more">
          <summary>Show {filtered.length - DEFAULT_VISIBLE_CANDIDATES} more optional candidates →</summary>
          <div className="decision-list">
            {filtered.slice(DEFAULT_VISIBLE_CANDIDATES).map((candidate) => (
              <DecisionCard
                key={candidate.id}
                candidate={candidate}
                nowMs={nowMs}
                feedbackLearningAvailable={feedbackLearningAvailable}
              />
            ))}
          </div>
        </details>
      ) : null}
    </>
  );
}

function ruleLabel(rule: ScannerFeedbackRuleRow): string {
  if (rule.action === "allow") return "KEEP";
  if (rule.decision === "off_topic") return "BLOCK OFF-TOPIC";
  if (rule.decision === "wrong_patch") return "BLOCK WRONG PATCH";
  if (rule.decision === "not_issue_report") return "BLOCK NON-ISSUE";
  return "BLOCK DUPLICATE";
}

function feedbackRuleRow(rule: ScannerFeedbackRuleRow, nowMs: number) {
  return (
    <article key={rule.id} className="feedback-rule">
      <div>
        <p className={`feedback-rule__state feedback-rule__state--${rule.action}`}>{ruleLabel(rule)}</p>
        <p className="feedback-rule__target">{rule.scope_value}</p>
        <p className="feedback-rule__reason">{rule.reason}</p>
      </div>
      <div className="feedback-rule__meta">
        <span>{rule.scope_type.replace(/_/g, " ")} · {relativeTime(rule.created_at, nowMs)}</span>
        <form action={undoScannerDecision}>
          <input type="hidden" name="decision_id" value={rule.decision_id} />
          <SubmitButton className="tap-btn tap-btn--sm" pendingText="Undoing...">Undo</SubmitButton>
        </form>
      </div>
    </article>
  );
}

/**
 * These are decisions already made — a record, not a queue. One row per rule
 * turned them into most of the page's height, so they group by what they are
 * about. Every rule keeps its own row, reason and Undo one disclosure inside;
 * nothing is merged and nothing can be revoked in bulk.
 */
export function FeedbackRulesPanel({ rules, nowIso }: { rules: ScannerFeedbackRuleRow[]; nowIso: string }) {
  const nowMs = new Date(nowIso).getTime();
  const groups = useMemo(() => groupScannerLessons(rules), [rules]);
  const summary = useMemo(() => summarizeScannerLessons(rules), [rules]);

  if (rules.length === 0) {
    return <p className="decision-empty">No scanner lessons yet. Decisions you record above will appear here with an Undo control.</p>;
  }

  return (
    <div className="feedback-ledger__groups">
      <p className="feedback-ledger__summary">
        <b>{summary.total}</b> active {summary.total === 1 ? "rule" : "rules"} · {summary.blocks} block ·{" "}
        {summary.keeps} keep · {summary.domains} {summary.domains === 1 ? "domain" : "domains"}
      </p>
      {groups.map((group) => (
        <details key={group.key} className="feedback-group">
          <summary className="feedback-group__summary">
            <span className="feedback-group__label">{group.label}</span>
            <span className="feedback-group__scope">
              {group.action === "allow" ? "keep" : "block"} · {group.scopeType.replace(/_/g, " ")}
            </span>
            <span className="feedback-group__count">{group.rules.length}</span>
          </summary>
          <div className="feedback-rules">{group.rules.map((rule) => feedbackRuleRow(rule, nowMs))}</div>
        </details>
      ))}
    </div>
  );
}
