import { PublicShell } from "@/components/dispatch/Chrome";
import { InformationPage } from "@/components/newspaper/InformationPage";
import { ReadingLink } from "@/components/newspaper/ReadingLink";

export default function NotFound() {
  return (
    <PublicShell>
      <div className="recovery-page">
        <InformationPage kicker="404" title="Page not found" description="This address does not match a page in the Hub.">
          <ReadingLink href="/" direction="back">Return to the front page</ReadingLink>
        </InformationPage>
      </div>
    </PublicShell>
  );
}
