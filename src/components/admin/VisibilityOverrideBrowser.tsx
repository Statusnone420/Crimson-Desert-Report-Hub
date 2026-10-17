"use client";

import { useMemo, useState } from "react";
import { setClusterVisibilityOverride } from "@/app/admin/actions";
import { SubmitButton } from "@/components/SubmitButton";

type VisibilityCluster = {
  id: string;
  title: string;
  is_public: boolean;
};

const RESULT_LIMIT = 8;

export function VisibilityOverrideBrowser({ clusters }: { clusters: VisibilityCluster[] }) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const matches = useMemo(
    () =>
      needle.length < 2
        ? []
        : clusters.filter((cluster) => cluster.title.toLowerCase().includes(needle)).slice(0, RESULT_LIMIT),
    [clusters, needle],
  );

  return (
    <details className="ledger-nested" aria-label="Create visibility override">
      <summary className="ledger-nested__summary">Create a new override →</summary>
      <div className="ledger-nested__body override-browser">
        <div className="override-browser__intro">
          <div>
            <h3>Find one engine-owned issue</h3>
            <p>
              Search by title. Nothing changes until you open one result, explain why, and confirm the
              break-glass action.
            </p>
          </div>
          <span>{clusters.length} automatic records</span>
        </div>
        <label className="dispatch-field override-browser__search">
          <span>Issue title</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search issue title"
          />
        </label>

        <p className="override-browser__status" role="status">
          {needle.length < 2
            ? "Type at least 2 characters. Automatic records stay out of the page until you search."
            : matches.length === 0
              ? "No matching engine-owned issues."
              : `${matches.length}${clusters.filter((cluster) => cluster.title.toLowerCase().includes(needle)).length > RESULT_LIMIT ? "+" : ""} matching issues.`}
        </p>

        <div className="override-browser__results">
          {matches.map((cluster) => (
            <details key={cluster.id} className="override-create">
              <summary>
                <span>{cluster.title}</span>
                <span className="mono-label">{cluster.is_public ? "PUBLIC" : "PRIVATE"} · ENGINE OWNED</span>
                <i>Override…</i>
              </summary>
              <form action={setClusterVisibilityOverride} className="override-create__form dispatch-field">
                <input type="hidden" name="cluster_id" value={cluster.id} />
                <label>
                  <span>Temporary visibility</span>
                  <select name="visibility" defaultValue="force_hidden">
                    <option value="force_hidden">Force hidden</option>
                    <option value="force_public">Force public</option>
                  </select>
                </label>
                <label>
                  <span>Why are you overriding the engine?</span>
                  <textarea name="reason" minLength={3} maxLength={500} required />
                </label>
                <label className="decision-form__confirm">
                  <input type="checkbox" name="confirm_override" value="true" required />
                  <span>I understand this immediately changes the public Issue Board until I reset it.</span>
                </label>
                <SubmitButton className="tap-btn tap-btn--danger" pendingText="Applying...">
                  Apply break-glass override
                </SubmitButton>
              </form>
            </details>
          ))}
        </div>
      </div>
    </details>
  );
}
