import { ReadingLink } from "@/components/newspaper/ReadingLink";
import { SectionNavigation } from "@/components/newspaper/SectionNavigation";
import type { ResolvingMetadata } from "next";
import { PublicShell } from "@/components/dispatch/Chrome";
import { Observatory } from "@/components/newspaper/Observatory";
import { DailyReviews } from "@/components/newspaper/DailyReviews";
import { UpdateTimeline } from "@/components/newspaper/UpdateTimeline";
import { UpdateWindows } from "@/components/newspaper/UpdateWindows";
import { getActivityHistory } from "@/lib/activityHistory.server";
import { getPatchPublications } from "@/lib/patchPublications.server";
import { getPublicScannerData } from "@/lib/queries";
import { getPatchRadarData } from "@/lib/radar.server";
import { routeMetadata } from "@/lib/site";
import { isCurrentPatchVerified } from "@/lib/patchWatch";
import { getSteamPlayerHistory } from "@/lib/steamPlayerHistory.server";

export function generateMetadata(_props: object, parent: ResolvingMetadata) {
  return routeMetadata(
    "The Observatory",
    "/observatory",
    "Recorded Steam review movement, Twitch audience activity, and the current public-source radar for Crimson Desert.",
    parent,
  );
}

// Cached for an hour; each completed scan also refreshes it with the other public pages.
export const revalidate = 3600;

const sections = [
  { id: "updates", label: "Around the updates" },
  { id: "daily-reviews", label: "Daily reviews" },
  { id: "review-record", label: "The review record" },
  { id: "platform-activity", label: "Platform activity" },
  { id: "scanner-radar", label: "The source radar" },
];

export default async function ObservatoryPage() {
  const [data, radar, players, activity, publications] = await Promise.all([
    getPublicScannerData(),
    getPatchRadarData(),
    getSteamPlayerHistory(),
    getActivityHistory(),
    getPatchPublications(),
  ]);
  const patches = publications.editions.map((edition) => ({
    version: edition.version,
    publishedAt: edition.publishedAt,
    fixes: edition.totalClaimedFixes ?? edition.fixes.length,
  }));

  return (
    <PublicShell active="observatory">
      <div id="observatory-top" className="dispatch-container observatory-paper">
        <a className="skip" href="#updates">Skip to the charts</a>
        <section className="observatory-heading">
          <ReadingLink variant="quiet" direction="back" className="back-link" href="/">Back to the front page</ReadingLink>
          <p className="kicker">The Observatory · {isCurrentPatchVerified(radar.patch) ? `Patch ${radar.patch.version}` : "Current patch unverified"}</p>
          <h1>The game, in context.</h1>
          <p>Recorded reviews, audience activity, and the signals coming in from across the web.</p>
        </section>
        <SectionNavigation sections={sections} label="Observatory sections" />
        <section id="updates" tabIndex={-1} className="obs-section" aria-labelledby="updates-title">
          <div className="obs-section-heading"><div><p className="kicker">Around the updates</p><h2 id="updates-title">What changed after each update</h2></div><p>Steam reviews, Twitch viewers and Steam players in the week before and the week after each official update. Movement around an update does not prove the update caused it.</p></div>
          {publications.unavailable
            ? <p className="np-error">The official patch record could not be read, so updates are not compared or marked.</p>
            : <UpdateWindows history={activity} patches={patches} />}
          <UpdateTimeline history={activity} patches={patches} />
        </section>
        <section id="daily-reviews" tabIndex={-1} className="obs-section" aria-labelledby="daily-reviews-title">
          <DailyReviews history={activity} patches={patches} />
        </section>
        <Observatory data={data} radar={radar} players={players} />
        <div className="observatory-footer">
          <ReadingLink href="/issues">Read the player reports</ReadingLink>
          <ReadingLink variant="quiet" direction="up" href="#observatory-top">Back to top</ReadingLink>
        </div>
        <p className="np-capture-note">Steam reviews and Twitch captures are recorded aggregates, not a live feed. Scanner leads are context with a source, never player reports.</p>
      </div>
    </PublicShell>
  );
}
