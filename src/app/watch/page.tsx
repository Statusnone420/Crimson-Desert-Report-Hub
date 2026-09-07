import type { ResolvingMetadata } from "next";
import Link from "next/link";
import { PublicShell } from "@/components/dispatch/Chrome";
import { WatchDesk } from "@/components/newspaper/WatchDesk";
import { getWatchSelections } from "@/lib/watchSelections";
import { routeMetadata } from "@/lib/site";

export const revalidate = 300;

export function generateMetadata(_props: object, parent: ResolvingMetadata) {
  return routeMetadata("Crimson Desert videos", "/watch", "The Crimson Desert reveal trailer and selected creator coverage of Charting the Unknown, with links to the original videos.", parent);
}

export default function WatchPage() {
  const selections = getWatchSelections();
  const hasCreator = selections.some((selection) => selection.kind === "creator");
  return <PublicShell active="watch">
    <section className="article-heading">
      <Link className="back-link" href="/">← Back to the front page</Link>
      <p className="kicker">Watch</p>
      <h1>Crimson Desert, in motion</h1>
      <p className="article-deck">{hasCreator ? "The official Charting the Unknown reveal, then one creator’s reading of it." : "Pearl Abyss’s Charting the Unknown reveal trailer."}</p>
    </section>
    <WatchDesk selections={selections} />
    <Link className="chart-link" href="/articles/charting-the-unknown">Read the confirmed expansion details →</Link>
    <p className="np-capture-note">Videos open on their original channels. Creator commentary reflects the creator’s perspective; confirmed release information comes from Pearl Abyss.</p>
  </PublicShell>;
}
