import type { ResolvingMetadata } from "next";
import Link from "next/link";
import { PublicShell } from "@/components/dispatch/Chrome";
import { PublicationFeed } from "@/components/newspaper/PublicationFeed";
import { routeMetadata } from "@/lib/site";

export const revalidate = 300;

export function generateMetadata(_props: object, parent: ResolvingMetadata) {
  return routeMetadata("Crimson Desert videos", "/watch", "The Crimson Desert reveal trailer and selected creator coverage of Charting the Unknown, with links to the original videos.", parent);
}

export default function WatchPage() {
  return <PublicShell active="watch">
    <section className="article-heading">
      <Link className="back-link" href="/">← Back to the front page</Link>
      <p className="kicker">Watch</p>
      <h1>Crimson Desert, in motion</h1>
      <p className="article-deck">The reveal, the details, and the people exploring Pywel.</p>
    </section>
    <section className="np-wire">
      <p className="kicker">Start here · Official trailer</p>
      <h2>Charting the Unknown</h2>
      <p className="small">The reveal introduces the expansion’s offshore adventure and life on land. Start with Pearl Abyss’s trailer, then explore an independent creator’s commentary below.</p>
      <a className="action" href="https://www.youtube.com/watch?v=HaCtG1F_hfE" target="_blank" rel="noreferrer noopener">Watch the official reveal ↗</a>
      <Link className="chart-link" href="/articles/charting-the-unknown">Read the confirmed expansion details →</Link>
    </section>
    <PublicationFeed type="video" />
    <p className="np-capture-note">Videos open on their original channels. Creator commentary reflects the creator’s perspective; confirmed release information comes from Pearl Abyss.</p>
  </PublicShell>;
}
