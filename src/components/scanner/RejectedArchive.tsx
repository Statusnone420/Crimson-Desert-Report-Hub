"use client";

import { useMemo, useState } from "react";
import { rescueRejectedCandidate } from "@/app/admin/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { plainSkipPhrase } from "@/lib/automation/runDisplay";
import type { RejectedCandidateRow } from "@/lib/queries";

function ReviewCandidate({ candidate }: { candidate: RejectedCandidateRow }) {
  return (
    <div className="archive-item">
      <div className="min-w-0">
        <div className="archive-item__title">{candidate.title}</div>
        <div className="archive-item__meta">
          {candidate.source_domain ? `${candidate.source_domain} · ` : ""}
          {plainSkipPhrase(candidate.reason)} ·{" "}
          <a href={candidate.url} target="_blank" rel="noreferrer noopener" className="dispatch-link">
            Open source
          </a>
        </div>
      </div>
      <form action={rescueRejectedCandidate} style={{ alignSelf: "center" }}>
        <input type="hidden" name="id" value={candidate.id} />
        <SubmitButton className="tap-btn tap-btn--sm" pendingText="Rescuing...">
          Rescue
        </SubmitButton>
      </form>
    </div>
  );
}

export function RejectedArchive({ candidates }: { candidates: RejectedCandidateRow[] }) {
  const [query, setQuery] = useState("");
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return candidates;
    return candidates.filter((candidate) =>
      [candidate.title, candidate.source_domain, plainSkipPhrase(candidate.reason)].some((value) =>
        value?.toLowerCase().includes(needle),
      ),
    );
  }, [candidates, query]);
  const searching = query.trim().length > 0;
  const visible = searching ? matches : matches.slice(0, 3);
  const hidden = searching ? [] : matches.slice(3);

  return (
    <>
      <label className="dispatch-field block space-y-1 text-xs">
        <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clipPath: "inset(50%)" }}>
          Search recent archive
        </span>
        <input
          type="search"
          className="w-full"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search title, domain, or rejection reason"
        />
      </label>
      <p className="op-note" style={{ margin: "8px 0" }} role="status" aria-live="polite">
        {searching ? `${matches.length} matching candidates` : `${candidates.length} recent candidates loaded`}
      </p>
      {visible.length > 0 ? (
        <>
          <div>
            {visible.map((candidate) => (
              <ReviewCandidate key={candidate.id} candidate={candidate} />
            ))}
          </div>
          {hidden.length > 0 ? (
            <details className="pt-1">
              <summary className="cursor-pointer text-sm dispatch-link" style={{ listStyle: "none" }}>
                Show {hidden.length} more before they expire →
              </summary>
              <div className="mt-2">
                {hidden.map((candidate) => (
                  <ReviewCandidate key={candidate.id} candidate={candidate} />
                ))}
              </div>
            </details>
          ) : null}
        </>
      ) : (
        <p className="op-note">No rejected candidates match that search.</p>
      )}
    </>
  );
}
