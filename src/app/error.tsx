"use client";

import { InformationPage } from "@/components/newspaper/InformationPage";
import { ReadingLink } from "@/components/newspaper/ReadingLink";

// Keep recovery independent of the server data that may have failed.
export default function RouteError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="newspaper">
      <div className="paper article-paper">
        <main id="main-content" className="recovery-page">
          <InformationPage kicker="Server error" title="Something broke on our side." description="This page could not be loaded. Try again, or return to the front page.">
            <div className="recovery-actions">
              <button type="button" className="reading-link" onClick={() => reset()}>Try again</button>
              <ReadingLink variant="quiet" href="/" direction="back">Return to the front page</ReadingLink>
            </div>
          </InformationPage>
        </main>
      </div>
    </div>
  );
}
