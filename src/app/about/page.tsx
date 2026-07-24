import type { Metadata } from "next";
import Link from "next/link";
import { PublicShell } from "@/components/dispatch/Chrome";
import { SOURCE_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Method",
  alternates: { canonical: "/about" },
};

export default function AboutPage() {
  return (
    <PublicShell active="method">
      <div className="dispatch-container">
        <header className="dispatch-pagehead" style={{ paddingBottom: 40 }}>
          <div className="dispatch-pagehead__copy">
            <p className="dispatch-kicker">The Method · Purpose and privacy</p>
            <h1 className="dispatch-pagehead__title">How this tracker thinks</h1>
            <p className="dispatch-pagehead__dek">
              A community-run way to turn scattered patch complaints into structured, moderated evidence — without
              turning any of it into a verdict.
            </p>
          </div>
        </header>

        <div className="method-grid">
          <section className="method-block">
            <h2 className="method-block__heading">What it is</h2>
            <p className="method-block__copy">
              An unofficial, fan-run confirmation board. It organizes structured player reports, one-tap
              confirmations, and public source leads without turning any of them into a verdict. Not affiliated
              with Pearl Abyss, Reddit, or X — no Pearl Abyss assets, logos, or artwork are used here.
            </p>
          </section>

          <section className="method-block" id="privacy">
            <h2 className="method-block__heading">Privacy posture</h2>
            <p className="method-block__copy">
              No accounts. No email. No ads. No analytics trackers. Submissions are anonymous — the server stores
              a salted one-way hash of the submitter IP for spam limiting only. Raw IPs are never stored. Raw
              report text stays private: public excerpts are either moderator-approved or deterministic neutral
              summaries, never your raw words.
            </p>
          </section>

          <section className="method-block">
            <h2 className="method-block__heading">Evidence, signals, and leads</h2>
            <p className="method-block__copy">
              Reports are evidence: structured submissions stay private except for counts and approved excerpts.
              Confirmations are signals: anonymous taps count what players say without declaring a verdict. Source
              links are leads: inspectable context that never becomes player evidence. The{" "}
              <Link href="/scanner" className="dispatch-link">
                Observatory
              </Link>{" "}
              shows how public chatter is filtered while private candidates stay private.
            </p>
          </section>

          <section className="method-block method-block--stacked">
            <div>
              <h2 className="method-block__heading">Public source</h2>
              <p className="method-block__copy">
                The website code is public for transparency, privacy review, and community contributions.
                Deployment secrets are never committed.{" "}
                <a href={SOURCE_URL} target="_blank" rel="noreferrer noopener" className="dispatch-link">
                  View the source on GitHub
                </a>
              </p>
            </div>
            <div>
              <h2 className="method-block__heading">Use official support too</h2>
              <p className="method-block__copy">
                This site aggregates community evidence; it does not replace official channels. If you have crash
                dumps, logs, or a PERS ID, file the official report first and reference it in your community
                report here.
              </p>
            </div>
          </section>
        </div>
      </div>
    </PublicShell>
  );
}
