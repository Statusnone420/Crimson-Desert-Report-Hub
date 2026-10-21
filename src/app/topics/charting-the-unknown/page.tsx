import type { ResolvingMetadata } from "next";
import { PublicShell } from "@/components/dispatch/Chrome";
import { ExpansionDesk } from "@/components/newspaper/ExpansionDesk";
import { EXPANSION } from "@/lib/expansion";
import { routeMetadata } from "@/lib/site";

// The countdown counts UTC days, so the page rebuilds as often as the front page.
export const revalidate = 300;

export function generateMetadata(_props: object, parent: ResolvingMetadata) {
  return routeMetadata(
    "Charting the Unknown: release time and what unlocks when",
    EXPANSION.path,
    "When Crimson Desert’s Charting the Unknown expansion lands, what unlocks when, and the official videos, from Pearl Abyss’s own notices.",
    parent,
  );
}

export default function ExpansionDeskPage() {
  const now = new Date();
  return <PublicShell active="news"><ExpansionDesk now={now.getTime()} /></PublicShell>;
}
