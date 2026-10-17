import { ReadingLink } from "@/components/newspaper/ReadingLink";
import type { ResolvingMetadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { PublicShell } from "@/components/dispatch/Chrome";
import { PublicationFeed } from "@/components/newspaper/PublicationFeed";
import { chartingTheUnknown } from "@/lib/editorialArticles";
import { routeMetadata } from "@/lib/site";
import { getPatchPublications } from "@/lib/patchPublications.server";

export const revalidate = 300;

export function generateMetadata(_props: object, parent: ResolvingMetadata) {
  return routeMetadata(
    "Crimson Desert news",
    "/news",
    "Source-backed Crimson Desert news and expansion reports from the Crimson Desert Report Hub.",
    parent,
  );
}

export default async function NewsPage() {
  // Next's prerenderer always streams metadata, ignoring htmlLimitedBots.
  // Render this navigation entry point on request so its head hydrates with
  // the page. Publication queries still use their five-minute data cache.
  await connection();
  const { articles, unavailable } = await getPatchPublications();
  return (
    <PublicShell active="news">
      <div className="dispatch-container">
        <section className="article-heading">
          <ReadingLink variant="quiet" direction="back" className="back-link" href="/">Back to the front page</ReadingLink>
          <p className="kicker">The news desk</p>
          <h1>Crimson Desert news</h1>
          <p className="article-deck">Source-backed reports on the game, its expansions, and the official record.</p>
        </section>
        <section className="np-wire" aria-labelledby="news-reports">
          <p className="kicker">Published reports</p>
          <h2 id="news-reports">What the desk has reported</h2>
          <div>
            {unavailable && <p role="status">Latest patch rundowns could not be loaded. Previously published reports are shown below.</p>}
            {articles.map((article) => (
              <article key={article.slug}>
                <p className="np-date">{article.section} · Published <time dateTime={article.publishedAt}>{new Date(article.publishedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })}</time></p>
                <Link href={article.path}><h3>{article.title}</h3></Link>
                <p>{article.description}</p>
                <p className="small">{article.sourceNote}</p>
                <ReadingLink className="action" href={article.path}>{article.publicationKind === "rundown" ? "Read the rundown" : "Read the report"}</ReadingLink>
              </article>
            ))}
          </div>
        </section>
        <PublicationFeed />
        <section className="np-wire" aria-labelledby="news-sourcing">
          <p className="kicker">The record</p>
          <h2 id="news-sourcing">Sources stay with the story</h2>
          <p className="small">This desk publishes original reports with their source links. Public scanner results remain separate source context, not articles by the Report Hub.</p>
          <ReadingLink className="action" href={chartingTheUnknown.path}>Read the full expansion article</ReadingLink>
        </section>
      </div>
    </PublicShell>
  );
}
