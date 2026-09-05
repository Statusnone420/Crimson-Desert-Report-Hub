import type { ResolvingMetadata } from "next";
import Link from "next/link";
import { PublicShell } from "@/components/dispatch/Chrome";
import { PublicationFeed } from "@/components/newspaper/PublicationFeed";
import { chartingTheUnknown } from "@/lib/editorialArticles";
import { routeMetadata } from "@/lib/site";

export const revalidate = 300;

export function generateMetadata(_props: object, parent: ResolvingMetadata) {
  return routeMetadata(
    "Charting the Unknown",
    "/topics/charting-the-unknown",
    "The source-backed Crimson Desert topic page for the Charting the Unknown expansion and its October 15 release.",
    parent,
  );
}

export default function ChartingTheUnknownTopicPage() {
  const [releaseNotice, expansionOverview] = chartingTheUnknown.sources;
  return (
    <PublicShell active="expansion">
      <div className="dispatch-container">
        <section className="article-heading">
          <Link className="back-link" href="/news">← Back to the news desk</Link>
          <p className="kicker">Expansion topic</p>
          <h1>Charting the Unknown</h1>
          <p className="article-deck">The official record, the current report, and the questions Pearl Abyss has not answered yet.</p>
        </section>
        <section className="np-wire" aria-labelledby="confirmed">
          <p className="kicker">What is confirmed</p>
          <h2 id="confirmed">The official outline</h2>
          <div>
            <article>
              <p className="np-date">Release schedule</p>
              <h3>October 15 at 6 pm Eastern</h3>
              <p>Pearl Abyss’s release notice sets the expansion’s launch time and regional schedule.</p>
              <a className="action" href={releaseNotice.url} target="_blank" rel="noreferrer noopener">Read the official notice ↗</a>
            </article>
            <article>
              <p className="np-date">New adventure</p>
              <h3>Ships, islands, underwater ruins, and housing</h3>
              <p>The official overview lists offshore exploration, underwater treasures, upgraded housing, and facilities to manage.</p>
              <a className="action" href={expansionOverview.url} target="_blank" rel="noreferrer noopener">Read the official overview ↗</a>
            </article>
          </div>
        </section>
        <PublicationFeed />
        <PublicationFeed type="video" />
        <section className="np-wire" aria-labelledby="open-questions">
          <p className="kicker">Still unconfirmed</p>
          <h2 id="open-questions">The details still missing</h2>
          <p className="small">The linked official sources do not establish the expansion’s length, download size, or progression requirements. The expansion report keeps those gaps separate from confirmed details.</p>
          <Link className="action" href={chartingTheUnknown.path}>Read the expansion report →</Link>
        </section>
      </div>
    </PublicShell>
  );
}
