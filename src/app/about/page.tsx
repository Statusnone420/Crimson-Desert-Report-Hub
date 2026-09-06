import type { ResolvingMetadata } from "next";
import { connection } from "next/server";
import Link from "next/link";
import { PublicShell } from "@/components/dispatch/Chrome";
import { routeMetadata, SOURCE_URL } from "@/lib/site";

export function generateMetadata(_props: object, parent: ResolvingMetadata) {
  return routeMetadata(
    "Method",
    "/about",
    "How Crimson Desert Report Hub sources its journalism, credits creators, and keeps news separate from player reports and official fix claims.",
    parent,
  );
}

const WIKI = {
  privacy: `${SOURCE_URL}/blob/main/docs/wiki/Privacy-and-Moderation.md`,
  sources: `${SOURCE_URL}/blob/main/docs/wiki/Data-Sources-and-Automation.md`,
};

/**
 * The site answers what a reader needs to read the board correctly: one line,
 * plus a couple of sentences if they open it. Thresholds, schema, provider
 * costs, and moderation procedure stay in the public repo — this page links to
 * them rather than restating them.
 *
 * Each row's answer lives in the summary, so a deep link that lands on a
 * collapsed row still reads without opening it. `id="privacy"` stays as the
 * Method-page answer; the site footer links to /privacy.
 */
export default async function AboutPage() {
  // Keep PublicShell's dateline tied to the request instead of the deployment day.
  await connection();

  return (
    <PublicShell active="method">
      <div className="dispatch-container">
        <header className="dispatch-pagehead" style={{ paddingBottom: 34 }}>
          <div className="dispatch-pagehead__copy">
            <p className="dispatch-kicker">The Method</p>
            <h1 className="dispatch-pagehead__title">How the Report Hub works</h1>
            <p className="dispatch-pagehead__dek">
              What the words on this site mean, and what we won&rsquo;t claim to know.
            </p>
          </div>
        </header>

        <section className="np-wire" aria-labelledby="journalism">
          <p className="kicker">An independent fan newspaper</p>
          <h2 id="journalism">Reporting on Crimson Desert</h2>
          <p className="small">Crimson Desert news, expansions and creators. Stories credit their sources. The issue scanner cannot publish articles.</p>
        </section>
        <dl className="method-registers" id="registers">
          <dt className="method-registers__term">Player reports are evidence</dt>
          <dd className="method-registers__def">You wrote it yourself. The strongest input here.</dd>
          <dt className="method-registers__term">Confirmations are signals</dt>
          <dd className="method-registers__def">A tap. Counted, never a verdict.</dd>
          <dt className="method-registers__term">Scanner links are leads</dt>
          <dd className="method-registers__def">A source to investigate; it does not establish a bug.</dd>
          <dt className="method-registers__term">Official notes are context</dt>
          <dd className="method-registers__def">Pearl Abyss said it. That starts a question, not an answer.</dd>
        </dl>

        <dl className="method-registers" id="numbers">
          <dt className="method-registers__term">Published</dt>
          <dd className="method-registers__def">
            A full issue card published on this site. Publication is visibility, not an evidence verdict.
          </dd>
          <dt className="method-registers__term">Watchlist</dt>
          <dd className="method-registers__def">A public issue that isn&rsquo;t published yet.</dd>
          <dt className="method-registers__term">Watched</dt>
          <dd className="method-registers__def">Both together, counted across every patch — not just this one.</dd>
          <dt className="method-registers__term">Tracked leads</dt>
          <dd className="method-registers__def">
            Pages the radar is holding for this patch — some public links, some still private. Still{" "}
            <em>leads</em>, not reports.
          </dd>
          <dt className="method-registers__term">Problem areas</dt>
          <dd className="method-registers__def">Distinct areas holding at least one tracked lead.</dd>
          <dt className="method-registers__term">Reviewed</dt>
          <dd className="method-registers__def">Candidates the radar screened — not the coverage we vetted.</dd>
        </dl>

        <div className="method-rows">
          <details className="method-row" id="player-verdicts">
            <summary className="method-row__q">
              <span className="method-row__ask">What counts as a player verdict?</span>
              <span className="method-row__mark" aria-hidden="true" />
              <span className="method-row__say">
                When the patch desk records an official fix claim, it notes the date. Only what players say
                after that date counts toward whether the fix held.
              </span>
            </summary>
            <div className="method-row__more">
              <p>
                Nothing counts down. No amount of silence turns a claimed fix into a confirmed one — only
                players saying so does that.
              </p>
              <p>
                It resets on the next patch. A fix claimed in one patch isn&rsquo;t a claim about the one after
                it.
              </p>
            </div>
          </details>

          <details className="method-row" id="radar">
            <summary className="method-row__q">
              <span className="method-row__ask">Does a radar lead mean the bug is real?</span>
              <span className="method-row__mark" aria-hidden="true" />
              <span className="method-row__say">
                No. A lead is a public page that exists and mentioned something. Finding it proves nothing.
              </span>
            </summary>
            <div className="method-row__more">
              <p>
                An empty category doesn&rsquo;t mean nothing is wrong either — it means nothing turned up. Titles
                and links stay private until something backs them up.
              </p>
              <p>
                Teaching the scanner changes what it keeps next time. It can&rsquo;t put a link past the
                publishing bar. The{" "}
                <Link href="/scanner" className="dispatch-link">
                  Observatory
                </Link>{" "}
                shows the whole flow.
              </p>
            </div>
          </details>

          <details className="method-row" id="freshness">
            <summary className="method-row__q">
              <span className="method-row__ask">How do you know a source is about this patch?</span>
              <span className="method-row__mark" aria-hidden="true" />
              <span className="method-row__say">
                It has to name this patch outright, or have gone up on or after patch day. When a page
                doesn&rsquo;t say when it went up, we say that instead of guessing.
              </span>
            </summary>
            <div className="method-row__more">
              <p>
                Times on the radar are when we last saw a page, not when anything happened in the game.
              </p>
            </div>
          </details>

          <details className="method-row" id="privacy">
            <summary className="method-row__q">
              <span className="method-row__ask">What do you store about me?</span>
              <span className="method-row__mark" aria-hidden="true" />
              <span className="method-row__say">
                No account, no email, no trackers, and never your IP address. Your raw report text stays private.
              </span>
            </summary>
            <div className="method-row__more">
              <p>
                To limit spam we keep a scrambled fingerprint of your connection. It can&rsquo;t be turned back
                into an address and it never appears on the site.
              </p>
              <p>
                What can show up publicly: a count, a summary built from the options you picked, or a short
                excerpt a moderator approved — never your raw words by default. You can add an evidence link; the
                report form does not read or upload files from your device.
              </p>
              <p>
                Scanner intelligence defaults to{" "}
                <a
                  href="https://openrouter.ai/openai/gpt-5.6-luna"
                  target="_blank"
                  rel="noreferrer noopener"
                  className="dispatch-link"
                >
                  GPT‑5.6 Luna
                </a>{" "}
                through{" "}
                <a
                  href="https://openrouter.ai/docs/guides/privacy/data-collection"
                  target="_blank"
                  rel="noreferrer noopener"
                  className="dispatch-link"
                >
                  OpenRouter
                </a>
                . DeepSeek V4 Flash remains an approved manual rollback. When Luna is used, OpenAI does not train
                on API data by default;{" "}
                <a
                  href="https://developers.openai.com/api/docs/guides/your-data"
                  target="_blank"
                  rel="noreferrer noopener"
                  className="dispatch-link"
                >
                  abuse-monitoring logs may be retained for up to 30 days
                </a>
                .
              </p>
            </div>
          </details>

          <details className="method-row" id="quiet">
            <summary className="method-row__q">
              <span className="method-row__ask">Why does quiet not count as fixed?</span>
              <span className="method-row__mark" aria-hidden="true" />
              <span className="method-row__say">
                Because nobody answered. Silence never turns green here — an issue with no answers is just an
                issue with no answers.
              </span>
            </summary>
            <div className="method-row__more">
              <p>Report and tap counts are never invented, estimated, or rounded.</p>
            </div>
          </details>

          <details className="method-row" id="source">
            <summary className="method-row__q">
              <span className="method-row__ask">When does a source link go public?</span>
              <span className="method-row__mark" aria-hidden="true" />
              <span className="method-row__say">
                When a trusted source lines up with an approved player report, or several independent sources say
                the same thing. It stays a lead either way.
              </span>
            </summary>
            <div className="method-row__more">
              <p>
                A link from a site we don&rsquo;t know needs more backup than one from a site we do — a report
                alone isn&rsquo;t enough to publish it. Links that don&rsquo;t clear the bar stay private unless a
                maintainer publishes one by hand.
              </p>
              <p>
                Published issues show the links and excerpts behind them, so you can check them yourself instead
                of taking our word for it.
              </p>
            </div>
          </details>

          <details className="method-row" id="official-support">
            <summary className="method-row__q">
              <span className="method-row__ask">Should I still report to Pearl Abyss?</span>
              <span className="method-row__mark" aria-hidden="true" />
              <span className="method-row__say">
                Yes — first. Nothing filed here reaches them.
              </span>
            </summary>
            <div className="method-row__more">
              <p>
                Crash dumps, logs, and a PERS ID belong in the official report — Pearl Abyss is the only one who
                can actually fix it. Mention it in your{" "}
                <Link href="/report" className="dispatch-link">
                  report here
                </Link>{" "}
                afterward so the record shows you did.
              </p>
            </div>
          </details>
        </div>

        <div className="method-outro">
          <p className="method-outro__copy">
            Everything else is in the public repo — how the counting works, what gets stored, what it costs to
            run, and every rule a moderator follows.
          </p>
          <p className="method-outro__copy">
            <Link href="/privacy" className="dispatch-link">
              Privacy
            </Link>
            {" · "}
            <a href={WIKI.privacy} target="_blank" rel="noreferrer noopener" className="dispatch-link">
              Privacy &amp; moderation
            </a>
            {" · "}
            <a href={WIKI.sources} target="_blank" rel="noreferrer noopener" className="dispatch-link">
              Data sources
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
