import { Fragment } from "react";
import Link from "next/link";
import { uniqueClaimAttributions } from "@/lib/claims";

type Claim = { fixText: string; category: string | null; section: string | null };
type Poll = { fixedCount: number; stillCount: number };
type ClaimCluster = {
  id: string;
  category: string;
  fix_claimed_at: string | null;
  readout: { poll: Poll | null };
};

const CLAIM_TAG_PATTERN = /^\[([^\[\]]{1,40})\]\s*([\s\S]+)$/;

function shortDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).toUpperCase();
}

function splitClaimTag(fixText: string): { tag: string; quote: string } | null {
  const match = CLAIM_TAG_PATTERN.exec(fixText);
  if (!match) return null;
  const tag = match[1].trim();
  const quote = match[2].trim();
  if (!tag || !quote || quote.startsWith("[")) return null;
  return { tag, quote };
}

function verdictNote(poll: Poll): string {
  if (poll.stillCount > poll.fixedCount) return "Contested.";
  if (poll.fixedCount > poll.stillCount) return "Leaning fixed.";
  return "Split.";
}

function VerdictSplit({ poll }: { poll: Poll }) {
  const total = poll.fixedCount + poll.stillCount;
  if (total === 0) return null;
  const fixedPct = Math.round((poll.fixedCount / total) * 100);
  return (
    <>
      <div className="verdict-bar" role="presentation">
        <div className="verdict-bar__fixed" style={{ width: fixedPct + "%" }} />
        <div className="verdict-bar__still" style={{ width: 100 - fixedPct + "%" }} />
      </div>
      <div className="verdict-labels">
        <span className="verdict-labels__fixed">{poll.fixedCount} fixed for me</span>
        <span className="verdict-labels__still">{poll.stillCount} still happening</span>
      </div>
      <div className="verdict-note">{verdictNote(poll)}</div>
    </>
  );
}

/**
 * The official notes have no claim-to-cluster key. A player verdict appears
 * only when the category uniquely identifies one claim and one current-patch
 * cluster; every other row remains unlinked rather than guessing.
 */
export function ClaimVerdicts({
  claims,
  clusters,
  patchPublishedAt,
  evidenceUnavailable,
}: {
  claims: Claim[];
  clusters: ClaimCluster[];
  patchPublishedAt: string | null;
  evidenceUnavailable: boolean;
}) {
  if (claims.length === 0) return null;

  const attributedByCategory = uniqueClaimAttributions(claims, clusters);
  const claimRows = claims.map((claim) => {
    const attributed = claim.category === null ? null : attributedByCategory.get(claim.category) ?? null;
    const poll = attributed?.readout.poll ?? null;
    const claimedOn = shortDate(attributed?.fix_claimed_at ?? null) ?? shortDate(patchPublishedAt) ?? "PATCH PUBLISH";
    return { claim, attributed, poll, claimedOn };
  });
  const verdictsElsewhere = clusters.length > 0 && claimRows.every((row) => row.attributed === null);
  const votedClaimRows = claimRows.filter((row) => row.poll !== null && row.poll.fixedCount + row.poll.stillCount > 0);
  const quietClaimRows = claimRows.filter((row) => !votedClaimRows.includes(row));
  const quietClaimDates = [...new Set(quietClaimRows.map((row) => row.claimedOn))];
  const sharedQuietDate = quietClaimDates.length === 1 ? quietClaimDates[0] : null;
  const rowLevelClaimDates = sharedQuietDate === null && !evidenceUnavailable && !verdictsElsewhere;
  const quietRowMarker = sharedQuietDate !== null && votedClaimRows.length > 0 && !evidenceUnavailable && !verdictsElsewhere;
  const claimGroups = claimRows.reduce<{ section: string | null; rows: typeof claimRows }[]>((groups, row) => {
    const last = groups[groups.length - 1];
    if (last && last.section === row.claim.section) last.rows.push(row);
    else groups.push({ section: row.claim.section, rows: [row] });
    return groups;
  }, []);

  return (
    <details className="claims-verdicts">
      <summary>Read per-claim player verdicts</summary>
      <div className="claims-verdicts__content">
        <p className="claims-intro">
          {evidenceUnavailable ? (
            <>Player verdicts can&apos;t be read right now — not counted as zero.</>
          ) : verdictsElsewhere ? (
            <>Player verdicts for this patch are tracked per issue on the <Link href="/issues">issue board</Link>; the notes don&apos;t tie {claimRows.length === 1 ? "this exact line" : "these exact lines"} to one issue.</>
          ) : quietClaimRows.length === 0 ? (
            <>Players have answered {claimRows.length === 1 ? "the claim" : "every claim"} below. <Link href="/about#player-verdicts">Verdicts</Link> count only taps made after the fix was claimed, this patch only.</>
          ) : sharedQuietDate === null ? (
            <>{quietClaimRows.length === claimRows.length ? "No player verdicts on any of these " + claimRows.length + " claims yet" : "No player verdicts yet on " + quietClaimRows.length + " of these " + claimRows.length + " claims"} — these fixes were claimed on different dates, so each row names its own.{votedClaimRows.length > 0 ? <> <Link href="/about#player-verdicts">Verdicts</Link> count only taps made after the claim, this patch only.</> : null}</>
          ) : votedClaimRows.length > 0 ? (
            <>Players have answered {votedClaimRows.length} of these {claimRows.length} claims; the other {quietClaimRows.length === 1 ? "one has" : quietClaimRows.length + " have"} no verdicts yet. Only taps made after {sharedQuietDate} <Link href="/about#player-verdicts">count toward a claim</Link>, this patch only.</>
          ) : (
            <>{claimRows.length === 1 ? "No player verdicts on this claim yet." : "No player verdicts on any of these " + claimRows.length + " claims yet."}</>
          )}
        </p>
        <div className="claim-rows">
          {claimGroups.map((group, groupIndex) => (
            <Fragment key={"claim-group-" + groupIndex}>
              {group.section ? <h3 className="claim-group__label dispatch-desktop-only">{group.section}</h3> : null}
              {group.rows.map((row, rowIndex) => {
                const taggedClaim = splitClaimTag(row.claim.fixText);
                return (
                  <div key={row.claim.fixText + "-" + groupIndex + "-" + rowIndex} className="claim-row">
                    <blockquote className="claim-row__quote">
                      {taggedClaim ? <span className="claim-tag">{taggedClaim.tag}</span> : null}
                      &ldquo;{taggedClaim ? taggedClaim.quote : row.claim.fixText}&rdquo;
                    </blockquote>
                    <div className="claim-row__verdict">
                      {row.poll && row.poll.fixedCount + row.poll.stillCount > 0 ? <VerdictSplit poll={row.poll} /> : rowLevelClaimDates ? <div className="verdict-quiet">No player verdicts yet · only taps after {row.claimedOn} count</div> : quietRowMarker ? <div className="verdict-quiet dispatch-mobile-only">No verdicts yet</div> : null}
                    </div>
                  </div>
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>
    </details>
  );
}
