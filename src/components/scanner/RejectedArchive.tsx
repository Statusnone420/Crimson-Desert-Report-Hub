"use client";

import { useMemo, useState } from "react";
import { rescueRejectedCandidate } from "@/app/admin/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { plainSkipPhrase } from "@/lib/automation/runDisplay";
import type { RejectedCandidateRow } from "@/lib/queries";

function ReviewCandidate({ candidate }: { candidate: RejectedCandidateRow }) {
  return (
    <div className="border-b py-3 last:border-0" style={{ borderColor: "var(--border)" }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold">{candidate.title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
            {candidate.source_domain ? (
              <span className="num" style={{ color: "var(--text-faint)" }}>
                {candidate.source_domain}
              </span>
            ) : null}
            <span style={{ color: "var(--text-dim)" }}>{plainSkipPhrase(candidate.reason)}</span>
            <a href={candidate.url} target="_blank" rel="noreferrer noopener" className="link">
              Open source
            </a>
          </div>
        </div>
        <form action={rescueRejectedCandidate}>
          <input type="hidden" name="id" value={candidate.id} />
          <SubmitButton className="btn btn-ghost btn-sm" pendingText="Rescuing...">
            Rescue
          </SubmitButton>
        </form>
      </div>
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
      <label className="block space-y-1 text-xs" style={{ color: "var(--text-dim)" }}>
        <span>Search recent archive</span>
        <input
          type="search"
          className="w-full"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Title, domain, or rejection reason"
        />
      </label>
      <p className="text-xs" style={{ color: "var(--text-faint)" }} role="status" aria-live="polite">
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
              <summary className="cursor-pointer text-sm" style={{ color: "var(--text-dim)" }}>
                Show {hidden.length} more before they expire
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
        <p className="text-sm" style={{ color: "var(--text-dim)" }}>
          No rejected candidates match that search.
        </p>
      )}
    </>
  );
}
