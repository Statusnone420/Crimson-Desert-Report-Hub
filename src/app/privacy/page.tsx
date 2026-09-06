import type { ResolvingMetadata } from "next";
import { connection } from "next/server";
import Link from "next/link";
import { PublicShell } from "@/components/dispatch/Chrome";
import { routeMetadata, SOURCE_URL } from "@/lib/site";

export function generateMetadata(_props: object, parent: ResolvingMetadata) {
  return routeMetadata(
    "Privacy",
    "/privacy",
    "No accounts, no email field, no ads or analytics trackers. Reports stay private unless a moderator approves a short excerpt.",
    parent,
  );
}

const POLICY = `${SOURCE_URL}/blob/main/docs/PRIVACY.md`;
const WIKI = `${SOURCE_URL}/blob/main/docs/wiki/Privacy-and-Moderation.md`;

/**
 * Public privacy note. The Method page still answers the same question at
 * `#privacy`; this route is the address the footer and `/privacy` guessers use.
 */
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
              No accounts, no email, no ads or trackers. Raw reports stay private unless a short excerpt is approved.
            </p>
          </div>
        </header>

        <dl className="method-registers">
          <dt className="method-registers__term">No accounts</dt>
          <dd className="method-registers__def">There is no player sign-in and nothing to register.</dd>
          <dt className="method-registers__term">No email field</dt>
          <dd className="method-registers__def">The report form never asks for an address.</dd>
          <dt className="method-registers__term">No ads or trackers</dt>
          <dd className="method-registers__def">This project does not include advertising code or analytics trackers.</dd>
          <dt className="method-registers__term">No raw IP storage</dt>
          <dd className="method-registers__def">The database does not store your IP address.</dd>
          <dt className="method-registers__term">Reports stay private</dt>
          <dd className="method-registers__def">
            Raw report text stays private unless a moderator approves a short excerpt.
          </dd>
        </dl>

        <section className="privacy-note" aria-labelledby="privacy-note">
          <p className="kicker">The short version</p>
          <h2 id="privacy-note">What can appear on the board</h2>
          <p>
            Submissions are anonymous. To limit spam we keep a scrambled fingerprint of your connection. It can&rsquo;t
            be turned back into an address and it never appears on the site.
          </p>
          <p>
            What can show up publicly: a count, a summary built from the options you picked, or a short excerpt a
            moderator approved — never your raw words by default. You can add an evidence link; the report form does
            not read or upload files from your device.
          </p>
          <p>
            Scanner intelligence and hosting providers are described in the full policy. The Method page keeps the same
            short answer next to the rest of the board&rsquo;s vocabulary.
          </p>
        </section>

        <div className="privacy-outro">
          <p>
            <Link href="/about#privacy" className="dispatch-link">
              Method · privacy
            </Link>
            {" · "}
            <a href={POLICY} target="_blank" rel="noreferrer noopener" className="dispatch-link">
              Full privacy policy
            </a>
            {" · "}
            <a href={WIKI} target="_blank" rel="noreferrer noopener" className="dispatch-link">
              Privacy &amp; moderation
            </a>
            {" · "}
            <a href={SOURCE_URL} target="_blank" rel="noreferrer noopener" className="dispatch-link">
              View the source on GitHub
            </a>
          </p>
        </div>
      </div>
    </PublicShell>
  );
}
