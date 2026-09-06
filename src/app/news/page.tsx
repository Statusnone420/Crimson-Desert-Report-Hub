import type { ResolvingMetadata } from "next";
import Link from "next/link";
import { PublicShell } from "@/components/dispatch/Chrome";
import { PublicationFeed } from "@/components/newspaper/PublicationFeed";
import { chartingTheUnknown, editorialArticles } from "@/lib/editorialArticles";
import { routeMetadata } from "@/lib/site";

export const revalidate = 300;

export function generateMetadata(_props: object, parent: ResolvingMetadata) {
  return routeMetadata(
    "News",
    "/news",
    "Source-backed Crimson Desert news and expansion reports from the Crimson Desert Report Hub.",
    parent,
  );
}

export default function NewsPage() {
  return (
    <PublicShell active="news">
      <div className="dispatch-container">
        <section className="article-heading">
          <Link className="back-link" href="/">← Back to the front page</Link>
          <p className="kicker">The news desk</p>
          <h1>Crimson Desert news</h1>
          <p className="article-deck">Source-backed reports on the game, its expansions, and the official record.</p>
        </section>
        <section className="np-wire" aria-labelledby="news-reports">
          <p className="kicker">Published reports</p>
          <h2 id="news-reports">What the desk has reported</h2>
          <div>
            {editorialArticles.map((article) => (
              <article key={article.slug}>
                <p className="np-date">{article.section} · Published <time dateTime={article.publishedAt}>{new Date(article.publishedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })}</time></p>
                <Link href={article.path}><h3>{article.title}</h3></Link>
                <p>{article.description}</p>
                <p className="small">{article.sourceNote}</p>
                <Link className="action" href={article.path}>Read the report →</Link>
              </article>
            ))}
          </div>
        </section>
        <PublicationFeed />
        <section className="np-wire" aria-labelledby="news-sourcing">
          <p className="kicker">The record</p>
          <h2 id="news-sourcing">Sources stay with the story</h2>
          <p className="small">This desk publishes original reports with their source links. Public scanner results remain separate source context, not articles by the Report Hub.</p>
          <Link className="action" href={chartingTheUnknown.path}>Read the full expansion article →</Link>
        </section>
      </div>
    </PublicShell>
  );
}
