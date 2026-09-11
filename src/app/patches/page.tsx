import type { ResolvingMetadata } from "next";
import Link from "next/link";
import { ClaimsRecord } from "@/components/newspaper/ClaimsRecord";
import { ClaimVerdicts } from "@/components/newspaper/ClaimVerdicts";
import { PublicShell } from "@/components/dispatch/Chrome";
import { uniqueClaimAttributions } from "@/lib/claims";
import { editorialArticles } from "@/lib/editorialArticles";
import { matchesPatchVersion } from "@/lib/patchWatch";
import { getDashboardData } from "@/lib/queries";
import { routeMetadata } from "@/lib/site";

export const revalidate = 300;

export function generateMetadata(_props: object, parent: ResolvingMetadata) {
  return routeMetadata(
    "Crimson Desert patch notes: what changed",
    "/patches",
    "Follow the latest Crimson Desert patch notes, official fix claims, and player reports. See what changed and what still needs checking.",
    parent,
  );
}

export default async function PatchesPage() {
  const data = await getDashboardData();
  const patch = data.currentPatch;
  const report = editorialArticles.find((article) => "patchVersion" in article && matchesPatchVersion(article.patchVersion, patch.version));
  const verifying = data.topClusters.filter((cluster) => cluster.fix_claimed_patch_version === patch.version);
  const attributed = uniqueClaimAttributions(data.claimedFixes, verifying);
  const contested = [...attributed.values()].filter((cluster) => {
    const poll = cluster.readout.poll;
    return poll !== null && poll.stillCount > poll.fixedCount && poll.stillCount > 0;
  }).length;
  const reportLabel = data.evidenceUnavailable ? "Player record unavailable" : `Player report${data.total === 1 ? "" : "s"} this patch`;
  const verdictsUnavailable = data.evidenceUnavailable || data.claimsUnavailable;
  const contestedLabel = verdictsUnavailable
    ? "Claim verdicts unavailable"
    : `Claim${contested === 1 ? "" : "s"} with more players saying it still happens`;

  return (
    <PublicShell active="patches">
      <div id="patch-top" className="dispatch-container article-paper patch-paper">
        <a className="skip" href="#claims">Skip to fix claims</a>
        <section className="patch-heading">
          <Link className="back-link" href="/">← Back to the front page</Link>
          <p className="kicker">The patch desk</p>
          <h1>Patch {patch.version}</h1>
          <p className="patch-deck">What changed. What players are seeing.</p>
          {patch.summary ? <p className="patch-intro">{patch.summary}</p> : null}
          <div className="patch-heading-actions">
            {report ? <Link className="action" href={report.path}>Read the report →</Link> : null}
            <a className="action" href={patch.officialUrl} target="_blank" rel="noreferrer noopener">Read Pearl Abyss’s complete notes ↗</a>
          </div>
        </section>
        <div className="patch-register" aria-label="Patch summary">
          <div><strong>{data.claimsUnavailable ? "unreadable" : data.claimedFixes.length}</strong><span>Official fix claims{data.claimedFixTotal !== null && data.claimedFixTotal > data.claimedFixes.length ? " stored" : ""}</span></div>
          <div><strong>{data.evidenceUnavailable ? "unreadable" : data.total}</strong><span>{reportLabel}</span></div>
          <div><strong>{verdictsUnavailable ? "unreadable" : contested}</strong><span>{contestedLabel}</span></div>
          <p>These are different records. An official fix claim does not establish that a player’s issue is resolved.</p>
        </div>
        <ClaimsRecord claims={data.claimedFixes} claimsUnavailable={data.claimsUnavailable} sourceTotal={data.claimedFixTotal} officialUrl={patch.officialUrl} />
        {!data.claimsUnavailable ? (
          <ClaimVerdicts
            claims={data.claimedFixes}
            clusters={verifying.map((cluster) => ({
              id: cluster.id,
              category: cluster.category,
              fix_claimed_at: cluster.fix_claimed_at ?? null,
              readout: { poll: cluster.readout.poll },
            }))}
            patchPublishedAt={patch.publishedAt}
            evidenceUnavailable={data.evidenceUnavailable}
          />
        ) : null}
        <section className="patch-player-record" aria-labelledby="player-record-heading">
          <div>
            <h2 id="player-record-heading">The player record</h2>
            <p>{data.evidenceUnavailable ? "The player record could not be read right now." : "A quiet board does not mean every issue is fixed."}</p>
          </div>
          <div className="patch-player-actions">
            <Link href="/issues">View player reports →</Link>
            <a href="#patch-top">Back to top ↑</a>
          </div>
        </section>
      </div>
    </PublicShell>
  );
}
