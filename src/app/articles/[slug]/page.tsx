import type { ResolvingMetadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { PublicShell } from "@/components/dispatch/Chrome";
import { ReadingLink } from "@/components/newspaper/ReadingLink";
import { getPatchPublications } from "@/lib/patchPublications.server";
import { patchPath, patchRundown, patchVersionFromSlug, RUNDOWN_FIX_LIMIT } from "@/lib/patchPublications";
import { routeMetadata } from "@/lib/site";
import { newsArticleJsonLd, serializeJsonLd } from "@/lib/structuredData";
import { matchesPatchVersion } from "@/lib/patchWatch";

export const revalidate = 300;
type Props = { params: Promise<{ slug: string }> };

async function resolveRundown({ params }: Props) {
  const { slug } = await params;
  const version = slug.startsWith("patch-") ? patchVersionFromSlug(slug.slice(6)) : null;
  if (!version) notFound();
  const catalog = await getPatchPublications();
  if (catalog.unavailable) throw new Error("Patch notes are temporarily unavailable. Please try again shortly.");
  const edition = catalog.editions.find((item) => item.version === version);
  if (!edition) notFound();
  const article = catalog.articles.find((item) => matchesPatchVersion(item.patchVersion, edition.version)) ?? patchRundown(edition);
  if (article.path !== `/articles/${slug}`) permanentRedirect(article.path);
  return { edition, article };
}

export async function generateMetadata(props: Props, parent: ResolvingMetadata) {
  const { article } = await resolveRundown(props);
  return routeMetadata(article.searchTitle, article.path, article.description, parent);
}

export default async function PatchRundownPage(props: Props) {
  const { edition, article } = await resolveRundown(props);
  const fixes = edition.fixes.slice(0, RUNDOWN_FIX_LIMIT);
  return <PublicShell active="news">
    <article className="dispatch-container article-paper patch-rundown" id="article-top">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(newsArticleJsonLd(article)) }} />
      <header className="article-heading">
        <ReadingLink variant="quiet" direction="back" className="back-link" href="/">Back to the front page</ReadingLink>
        <p className="kicker">Patch notes rundown</p>
        <h1>{article.title}</h1>
        <p className="article-deck">{article.description}</p>
        <p className="article-meta">{edition.publishedAt ? "Official notes published" : "First recorded by the Hub"} <time dateTime={article.publishedAt}>{new Date(article.publishedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })}</time></p>
      </header>
      <div className="article-body rundown-body">
        <h2>From the official fix list</h2>
        {fixes.length ? <><p>Pearl Abyss lists the following fixes{edition.fixes.length > fixes.length ? " among this patch’s changes" : ""}:</p><ul>{fixes.map((fix) => <li key={fix.fixText}>{fix.fixText}</li>)}</ul></> : <p>No fix bullets are available in the Hub’s record for this version. Read the complete notes for the changes.</p>}
        <p>This rundown covers listed fixes. Read the official notes for the complete change list and platform rollout details. A listed fix does not establish that a player’s issue is resolved.</p>
        <div className="patch-heading-actions">
          <ReadingLink href={patchPath(edition.version)}>Read this patch’s claim record</ReadingLink>
          <ReadingLink variant="source" href={edition.officialUrl} target="_blank" rel="noopener noreferrer">Read Pearl Abyss’s complete notes</ReadingLink>
          <ReadingLink variant="quiet" href="/patches">Current patch desk</ReadingLink>
        </div>
      </div>
    </article>
  </PublicShell>;
}
