import { ReadingLink } from "@/components/newspaper/ReadingLink";
import { InformationPage } from "@/components/newspaper/InformationPage";
import type { ResolvingMetadata } from "next";
import { connection } from "next/server";
import Link from "next/link";
import { PublicShell } from "@/components/dispatch/Chrome";
import { PEARL_ABYSS_SUPPORT_URL, routeMetadata } from "@/lib/site";

export function generateMetadata(_props: object, parent: ResolvingMetadata) {
  return routeMetadata(
    "Method",
    "/about",
    "How Crimson Desert Report Hub sources its journalism, credits creators, and keeps news separate from player reports and official fix claims.",
    parent,
  );
}

/**
 * The site answers what a reader needs to read the board correctly: one line,
 * plus a couple of sentences if they open it.
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
      <InformationPage
        kicker="The Method"
        title="How the Report Hub works"
        description="What the words on this site mean, and what this site does not claim to know."
      >
        <section className="np-wire" aria-labelledby="journalism">
          <p className="kicker">An independent fan newspaper</p>
          <h2 id="journalism">Reporting on Crimson Desert</h2>
          <p className="small">Stories credit their sources. Official notes also supply automatic patch rundowns.</p>
          <ReadingLink variant="source" href="/contact">Corrections and broken links</ReadingLink>
        </section>
        <dl className="method-registers" id="registers">
          <dt className="method-registers__term">Earlier reports are evidence</dt>
          <dd className="method-registers__def">Approved written accounts retained with their patch context.</dd>
          <dt className="method-registers__term">Check-ins are experiences</dt>
          <dd className="method-registers__def">An anonymous response, not a verified player count.</dd>
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
          <dd className="method-registers__def">Candidates screened by the radar — not independently reviewed coverage.</dd>
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
                <Link href="/observatory" className="dispatch-link">
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
                doesn&rsquo;t say when it went up, that uncertainty is stated instead of guessed.
              </span>
            </summary>
            <div className="method-row__more">
              <p>
                Times on the radar show when a page was last seen, not when anything happened in the game.
              </p>
            </div>
          </details>

          <details className="method-row" id="privacy">
            <summary className="method-row__q">
              <span className="method-row__ask">What does the site store?</span>
              <span className="method-row__mark" aria-hidden="true" />
              <span className="method-row__say">
                No accounts, trackers, or raw IP storage. Email is collected only if you add it to a private problem report. Check-ins keep one current response per network, issue, and exact patch.
              </span>
            </summary>
            <div className="method-row__more">
              <p>
                A salted one-way network hash limits repeat check-ins. The database does not store raw IP
                addresses, and the hash never appears publicly. Turnstile checks help limit automated submissions.
              </p>
              <p>
                A later choice replaces that network&rsquo;s response for the same issue and exact patch. Shared
                networks share a response, so counts do not verify unique players. Historical approved reports and
                excerpts may remain.
              </p>
              <p>
                Scanner enrichment uses approved server-side models through{" "}
                <a
                  href="https://openrouter.ai/docs/guides/privacy/data-collection"
                  target="_blank"
                  rel="noreferrer noopener"
                  className="dispatch-link"
                >
                  OpenRouter
                </a>
                . Maintainers select and test the model, provider, and retention policy before activation.
                Requests follow the saved privacy and spending limits. With{" "}
                <a
                  href="https://openrouter.ai/docs/guides/features/zdr"
                  target="_blank"
                  rel="noreferrer noopener"
                  className="dispatch-link"
                >
                  zero data retention
                </a>
                {" "}selected, routing is restricted to endpoints with that policy. Other routes may retain data
                under the provider&rsquo;s policy. Check-ins do not call these models.
              </p>
            </div>
          </details>

          <details className="method-row" id="quiet">
            <summary className="method-row__q">
              <span className="method-row__ask">Why does quiet not count as fixed?</span>
              <span className="method-row__mark" aria-hidden="true" />
              <span className="method-row__say">
                No answers means no verdict. Silence never counts as a fix.
              </span>
            </summary>
            <div className="method-row__more">
              <p>Report and check-in counts are never invented, estimated, or rounded.</p>
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
                A link from an unfamiliar site needs more backup than one from a known site — a report alone
                isn&rsquo;t enough to publish it. Links that don&rsquo;t clear the bar stay private unless a
                maintainer publishes one by hand.
              </p>
              <p>
                Published issues show the links and excerpts behind them, so readers can check them directly.
              </p>
            </div>
          </details>

          <details className="method-row" id="official-support">
            <summary className="method-row__q">
              <span className="method-row__ask">Where can I send a support report?</span>
              <span className="method-row__mark" aria-hidden="true" />
              <span className="method-row__say">
                Use Pearl Abyss&rsquo;s official channel. This independent fan site is not a support channel.
              </span>
            </summary>
            <div className="method-row__more">
              <p>
                Crash dumps, logs, and account details belong with Pearl Abyss. This site cannot receive, forward, or answer support requests.
              </p>
            </div>
          </details>
        </div>

        <div className="method-outro">
          <p className="method-outro__copy">
            Read the privacy note for details about anonymous check-ins and stored data.
          </p>
          <div className="reading-resources">
            <ReadingLink variant="source" href="/privacy">
              Privacy
            </ReadingLink>
            <ReadingLink variant="source" href={PEARL_ABYSS_SUPPORT_URL}>
              Pearl Abyss support
            </ReadingLink>
          </div>
        </div>
      </InformationPage>
    </PublicShell>
  );
}
