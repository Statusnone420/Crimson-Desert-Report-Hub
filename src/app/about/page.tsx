import Link from "next/link";

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <section className="space-y-2">
        <p className="stat-label">Purpose and privacy</p>
        <h1 className="text-3xl font-semibold">About this tracker</h1>
        <p className="text-sm leading-6" style={{ color: "var(--text-dim)" }}>
          A community-run way to turn scattered patch complaints into structured, moderated evidence.
        </p>
      </section>

      <section className="panel space-y-3 text-sm leading-6">
        <h2 className="text-lg font-semibold">What it is</h2>
        <p>
          Crimson Desert Report Hub is an unofficial, fan-run confirmation board. It organizes structured player
          reports, one-tap confirmations, and public source leads without turning any of them into a verdict.
        </p>
        <p>
          It is not affiliated with Pearl Abyss, Reddit, or X. No Pearl Abyss assets, logos, or artwork are used here.
        </p>
      </section>

      <section className="panel space-y-3 text-sm leading-6">
        <h2 className="text-lg font-semibold">Privacy posture</h2>
        <p>No accounts. No email. No ads. No analytics trackers.</p>
        <p>
          Submissions are anonymous. The server stores a salted one-way hash of the submitter IP for spam
          rate limiting only. Raw IPs are never stored. Report text is reviewed by a moderator before any
          excerpt can appear publicly.
        </p>
      </section>

      <section className="panel space-y-3 text-sm leading-6">
        <h2 className="text-lg font-semibold">Evidence, signals, and leads</h2>
        <p>
          Reports are evidence: structured submissions remain private except for counts and moderator-approved
          excerpts. Confirmations are signals: anonymous taps count what players say without declaring a verdict.
          Source links are leads: they provide inspectable context but never become player evidence.
        </p>
        <p>
          The <Link href="/scanner" className="link">Scanner page</Link> shows how public chatter is filtered into
          source leads and calm questions while private candidates stay private.
        </p>
      </section>

      <section className="panel space-y-3 text-sm leading-6">
        <h2 className="text-lg font-semibold">Public source</h2>
        <p>
          The website code is intended to be public for transparency, privacy review, and community contributions.
          Deployment secrets and private environment variables are never committed to the repository.
        </p>
        <a
          href="https://github.com/Statusnone420/Crimson-Desert-Report-Hub"
          target="_blank"
          rel="noreferrer noopener"
          style={{ color: "var(--blue)" }}
        >
          View the source on GitHub
        </a>
      </section>

      <section className="panel space-y-3 text-sm leading-6">
        <h2 className="text-lg font-semibold">Use official support too</h2>
        <p>
          This site aggregates community evidence; it does not replace official channels. If you have crash
          dumps, logs, or a Pearl Abyss PERS ID, file the official report first and include that reference in
          your community report here.
        </p>
      </section>
    </div>
  );
}
