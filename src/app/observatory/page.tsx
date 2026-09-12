import { ReadingLink } from "@/components/newspaper/ReadingLink";
import { SectionNavigation } from "@/components/newspaper/SectionNavigation";
import type { ResolvingMetadata } from "next";
import { PublicShell } from "@/components/dispatch/Chrome";
import { Observatory } from "@/components/newspaper/Observatory";
import { getPublicScannerData } from "@/lib/queries";
import { getPatchRadarData } from "@/lib/radar.server";
import { routeMetadata } from "@/lib/site";
import { isCurrentPatchVerified } from "@/lib/patchWatch";

export function generateMetadata(_props: object, parent: ResolvingMetadata) {
  return routeMetadata(
    "The Observatory",
    "/observatory",
    "Recorded Steam review movement, Twitch audience activity, and the current public-source radar for Crimson Desert.",
    parent,
  );
}

export const dynamic = "force-dynamic";

const sections = [
  { id: "review-record", label: "The review record" },
  { id: "platform-activity", label: "Platform activity" },
  { id: "scanner-radar", label: "The source radar" },
];

export default async function ObservatoryPage() {
  const [data, radar] = await Promise.all([getPublicScannerData(), getPatchRadarData()]);

  return (
    <PublicShell active="observatory">
      <div id="observatory-top" className="dispatch-container observatory-paper">
        <a className="skip" href="#review-record">Skip to the charts</a>
        <section className="observatory-heading">
          <ReadingLink variant="quiet" direction="back" className="back-link" href="/"> Back to the front page</ReadingLink>
          <p className="kicker">The Observatory · {isCurrentPatchVerified(radar.patch) ? `Patch ${radar.patch.version}` : "Current patch unverified"}</p>
          <h1>The game, in context.</h1>
          <p>Recorded reviews, audience activity, and the signals coming in from across the web.</p>
        </section>
        <SectionNavigation sections={sections} label="Observatory sections" />
        <Observatory data={data} radar={radar} />
        <div className="observatory-footer">
          <ReadingLink href="/issues">Read the player reports</ReadingLink>
          <ReadingLink variant="quiet" direction="up" href="#observatory-top">Back to top</ReadingLink>
        </div>
        <p className="np-capture-note">Steam reviews and Twitch captures are recorded aggregates, not a live feed. Scanner leads are context with a source, never player reports.</p>
      </div>
    </PublicShell>
  );
}
