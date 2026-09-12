import { ReadingLink } from "@/components/newspaper/ReadingLink";
import type { ResolvingMetadata } from "next";
import { connection } from "next/server";
import { PublicShell } from "@/components/dispatch/Chrome";
import { routeMetadata, SOURCE_URL } from "@/lib/site";

export function generateMetadata(_props: object, parent: ResolvingMetadata) {
  return routeMetadata(
    "Privacy",
    "/privacy",
    "Anonymous issue check-ins use Turnstile and one current response per network, issue, and exact patch. No raw IP address is stored.",
    parent,
  );
}

const POLICY = `${SOURCE_URL}/blob/main/docs/PRIVACY.md`;
const WIKI = `${SOURCE_URL}/blob/main/docs/wiki/Privacy-and-Moderation.md`;

export default async function PrivacyPage() {
  await connection();

  return (
    <PublicShell>
      <div className="dispatch-container">
        <header className="dispatch-pagehead" style={{ paddingBottom: 34 }}>
          <div className="dispatch-pagehead__copy">
            <p className="dispatch-kicker">The desk</p>
            <h1 className="dispatch-pagehead__title">Privacy</h1>
            <p className="dispatch-pagehead__dek">
              Anonymous check-ins, no accounts, no raw IP storage, and no ads or analytics trackers.
            </p>
          </div>
        </header>

        <dl className="method-registers">
          <dt className="method-registers__term">No accounts</dt>
          <dd className="method-registers__def">There is no player sign-in, registration, or email field.</dd>
          <dt className="method-registers__term">One current response</dt>
          <dd className="method-registers__def">A network can hold one current check-in for each public issue and exact patch.</dd>
          <dt className="method-registers__term">No raw IP storage</dt>
          <dd className="method-registers__def">The database does not store raw IP addresses.</dd>
          <dt className="method-registers__term">No ads or trackers</dt>
          <dd className="method-registers__def">This project does not include advertising code or analytics trackers.</dd>
          <dt className="method-registers__term">Historical written reports</dt>
          <dd className="method-registers__def">The public free-form report flow is retired. Approved historical reports and excerpts may remain in the record.</dd>
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
            Abyss. It does not provide a support desk or support response.
          </p>
        </section>

        <div className="privacy-outro">
          <div className="reading-resources">
            <ReadingLink variant="source" href="/about#privacy">
              Method · privacy
            </ReadingLink>
            <ReadingLink variant="source" href={POLICY} target="_blank" rel="noreferrer noopener">
              Full privacy policy
            </ReadingLink>
            <ReadingLink variant="source" href={WIKI} target="_blank" rel="noreferrer noopener">
              Privacy &amp; moderation
            </ReadingLink>
            <ReadingLink variant="source" href={SOURCE_URL} target="_blank" rel="noreferrer noopener">
              View the source on GitHub
            </ReadingLink>
          </div>
        </div>
      </div>
    </PublicShell>
  );
}
