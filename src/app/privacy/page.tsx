import { ReadingLink } from "@/components/newspaper/ReadingLink";
import { InformationPage } from "@/components/newspaper/InformationPage";
import type { ResolvingMetadata } from "next";
import { connection } from "next/server";
import Link from "next/link";
import { PublicShell } from "@/components/dispatch/Chrome";
import { routeMetadata } from "@/lib/site";

export function generateMetadata(_props: object, parent: ResolvingMetadata) {
  return routeMetadata(
    "Privacy",
    "/privacy",
    "Anonymous issue check-ins use Turnstile and one current response per network, issue, and exact patch. No raw IP address is stored.",
    parent,
  );
}

export default async function PrivacyPage() {
  await connection();

  return (
    <PublicShell>
      <InformationPage
        kicker="The desk"
        title="Privacy"
        description="Anonymous check-ins, no accounts, no raw IP storage, and no ads or analytics trackers."
      >
        <dl className="method-registers">
          <dt className="method-registers__term">No accounts</dt>
          <dd className="method-registers__def">There is no player sign-in or registration. Check-ins do not ask for email.</dd>
          <dt className="method-registers__term">One current response</dt>
          <dd className="method-registers__def">A network can hold one current check-in for each public issue and exact patch.</dd>
          <dt className="method-registers__term">No raw IP storage</dt>
          <dd className="method-registers__def">The database does not store raw IP addresses.</dd>
          <dt className="method-registers__term">No ads or trackers</dt>
          <dd className="method-registers__def">This project does not include advertising code or analytics trackers. The expansion desk&rsquo;s video player loads from YouTube only when a reader clicks play.</dd>
          <dt className="method-registers__term">Historical written reports</dt>
          <dd className="method-registers__def">The public free-form report flow is retired. Approved historical reports and excerpts may remain in the record.</dd>
          <dt className="method-registers__term">Private reports</dt>
          <dd className="method-registers__def">Problem reports and any email you add stay private. They are kept until deleted by hand; nothing is deleted automatically.</dd>
        </dl>

        <section className="privacy-note" aria-labelledby="privacy-note">
          <p className="kicker">The short version</p>
          <h2 id="privacy-note">How anonymous check-ins work</h2>
          <p>
            A Turnstile check helps limit automated submissions. The server stores a salted one-way network hash for
            rate limits and replacement rules. The database does not store raw IP addresses, and the hash never appears publicly.
          </p>
          <p>
            Choosing another response replaces the previous response from that network for the same issue and exact
            patch. People sharing a network share that response. Check-in totals do not verify unique players.
          </p>
          <p>
            Crimson Desert Report Hub is an independent fan site and is not affiliated with or endorsed by Pearl
            Abyss. It cannot provide game or account support.
          </p>
        </section>

        <section className="privacy-note" aria-labelledby="problem-report-privacy">
          <h2 id="problem-report-privacy">Private problem reports</h2>
          <p>
            The on-site Report a problem form collects a report type, your description, the current page address
            without its query string or fragment, and an email address if you provide one. Email is optional except
            for creator content removal requests, where it is required for verification. See the{" "}
            <Link className="dispatch-link" href="/contact">Contact page</Link> for availability and guidance.
          </p>
          <p>
            Reports, email addresses, review statuses, and review notes stay private in the Hub&rsquo;s database and
            admin inbox. They are never published or sent to an external issue tracker. Nothing changes automatically
            after a report; each request waits for review, with no promised response time.
          </p>
          <p>
            Cloudflare Turnstile helps prevent automated submissions. On the report form the check is invisible;
            Cloudflare&rsquo;s{" "}
            <a
              href="https://www.cloudflare.com/turnstile-privacy-policy/"
              target="_blank"
              rel="noreferrer noopener"
              className="dispatch-link"
            >
              Turnstile Privacy Addendum
            </a>{" "}
            explains what Turnstile collects. To limit reports to about one per network per
            day, the server stores IP addresses only as salted one-way hashes, never as raw addresses. People sharing
            a network share that limit. Hashes never appear publicly. Avoid including passwords or sensitive account
            information in the description.
          </p>
        </section>

        <div className="privacy-outro">
          <div className="reading-resources">
            <ReadingLink variant="source" href="/about#privacy">
              Method · privacy
            </ReadingLink>
          </div>
        </div>
      </InformationPage>
    </PublicShell>
  );
}
