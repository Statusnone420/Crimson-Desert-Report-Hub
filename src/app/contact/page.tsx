import type { ResolvingMetadata } from "next";
import { PublicShell } from "@/components/dispatch/Chrome";
import { ReadingLink } from "@/components/newspaper/ReadingLink";
import { InformationPage } from "@/components/newspaper/InformationPage";
import { PEARL_ABYSS_SUPPORT_URL, routeMetadata } from "@/lib/site";

// Keep shared publication data on News's five-minute refresh interval.
// This informational page does not need request-time rendering.
export const revalidate = 300;

export function generateMetadata(_props: object, parent: ResolvingMetadata) {
  return routeMetadata(
    "Contact the Hub",
    "/contact",
    "Report a website problem, request a correction or content removal, and find the right place for game support at Crimson Desert Report Hub.",
    parent,
  );
}

export default function ContactPage() {
  return (
    <PublicShell>
      <InformationPage
        kicker="Letters to the desk"
        title="Contact the Hub"
        description="Spotted a wrong detail or a broken link? Help keep the paper accurate and useful."
      >
        <div className="contact-sections">
          <section className="privacy-note" aria-labelledby="site-corrections">
            <p className="kicker">About this website</p>
            <h2 id="site-corrections">Report a problem</h2>
            <p>
              Use the Report a problem button on the page that needs attention for broken links, wrong or outdated
              information, or creator content removal requests. If the button is not available yet, private on-site
              reporting has not opened.
            </p>
            <p>
              Reports go privately to Crimson Desert Report Hub. No account is needed. An email address is optional
              except for creator content removal requests, where it is needed to verify the request. Please leave
              out passwords, account details, and private messages. Reports wait for review; there is no promised
              response time.
            </p>
          </section>

          <section className="privacy-note" aria-labelledby="game-support">
            <p className="kicker">About the game</p>
            <h2 id="game-support">Game and account support</h2>
            <p>
              For crashes, save files, purchases, or account help, use Pearl Abyss&rsquo;s official support channel.
              The Hub is an independent fan publication and cannot provide game support.
            </p>
            <div className="reading-resources">
              <ReadingLink variant="source" href={PEARL_ABYSS_SUPPORT_URL}>Pearl Abyss support</ReadingLink>
            </div>
          </section>

          <section className="privacy-note" aria-labelledby="player-check-ins">
            <p className="kicker">The player record</p>
            <h2 id="player-check-ins">Share what you are seeing</h2>
            <p>
              The issue board accepts anonymous check-ins about listed issues on the current patch. No account is
              needed on the Hub. Check-ins record player experiences; they are not support tickets.
            </p>
            <div className="reading-resources">
              <ReadingLink variant="source" href="/issues">Find an issue to check in on</ReadingLink>
            </div>
          </section>
        </div>
      </InformationPage>
    </PublicShell>
  );
}
