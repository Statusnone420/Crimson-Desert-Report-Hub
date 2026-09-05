import type { ResolvingMetadata } from "next";
import Link from "next/link";
import { PublicShell } from "@/components/dispatch/Chrome";
import { Observatory } from "@/components/newspaper/Observatory";
import { getPublicScannerData } from "@/lib/queries";
import { getPatchRadarData } from "@/lib/radar.server";
import { routeMetadata } from "@/lib/site";

export function generateMetadata(_props: object, parent: ResolvingMetadata) {
  return routeMetadata(
    "The Observatory",
    "/observatory",
    "Recorded Steam review movement, Twitch audience activity, and the current public-source radar for Crimson Desert.",
    parent,
  );
}

export const dynamic = "force-dynamic";

export default async function ObservatoryPage() {
  const [data, radar] = await Promise.all([getPublicScannerData(), getPatchRadarData()]);

  return (
    <PublicShell active="observatory">
      <div id="observatory-top" className="dispatch-container observatory-paper">
        <a className="skip" href="#review-record">Skip to the charts</a>
        <section className="observatory-heading">
          <Link className="back-link" href="/">← Back to the front page</Link>
          <p className="kicker">The Observatory · Patch {radar.patch.version}</p>
          <h1>The game, in context.</h1>
          <p>Recorded reviews, audience activity, and the signals coming in from across the web.</p>
        </section>
        <div className="observatory-sections" role="navigation" aria-label="Observatory sections">
          <a href="#review-record">The review record ↓</a>
          <a href="#platform-activity">Platform activity ↓</a>
          <a href="#scanner-radar">The source radar ↓</a>
        </div>
        <Observatory data={data} radar={radar} />
        <div className="observatory-footer">
          <Link href="/issues">Read the player reports →</Link>
          <a href="#observatory-top">Back to top ↑</a>
        </div>
        <p className="np-capture-note">Steam reviews and Twitch captures are recorded aggregates, not a live feed. Scanner leads are context with a source, never player reports.</p>
      </div>
    </PublicShell>
  );
}
