import { ReadingLink } from "@/components/newspaper/ReadingLink";
import Image from "next/image";
import Link from "next/link";
import { editorialArticles, type EditorialArticle } from "@/lib/editorialArticles";

function ReportImage({ article, lead = false }: { article: EditorialArticle; lead?: boolean }) {
  const image = article.heroImage;
  return (
    <figure>
      <div className={image.src === "/official/coast.jpg" ? "coast-crop" : "front-page-image"}>
        <Image
          src={image.src}
          width={image.width}
          height={image.height}
          alt={image.alt}
          preload={lead}
          sizes={lead ? "(max-width: 900px) 100vw, 60vw" : "(max-width: 650px) 108px, (max-width: 1000px) 220px, 300px"}
        />
      </div>
      <figcaption>Official artwork · Pearl Abyss</figcaption>
    </figure>
  );
}

function ReportDateline({ article }: { article: EditorialArticle }) {
  return (
    <p className="front-page-dateline">
      <span>{article.section}</span>
      <time dateTime={article.publishedAt}>
        {new Date(article.publishedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })}
      </time>
    </p>
  );
}

/** Lead with the selected news or patch report; retain the original reports below it. */
export function FrontPageReports({ articles = editorialArticles, leadUnavailable = false, latestPatchVersion }: { articles?: readonly EditorialArticle[]; leadUnavailable?: boolean; latestPatchVersion?: string }) {
  const [lead, ...rest] = articles;
  const showPatchFallback = leadUnavailable && (!lead || !!lead.patchVersion);
  const secondary = showPatchFallback ? articles : rest;
  if (!lead && !leadUnavailable) return null;

  return (
    <section className="front-page-reports" aria-label="Hub reports and patch rundowns">
      {showPatchFallback ? <article id="lead" className="front-page-lead front-page-lead-unavailable" aria-labelledby="lead-headline">
        <div className="front-page-lead-copy">
          <p className="kicker">The patch desk</p>
          <h2 id="lead-headline" className="headline"><Link href="/patches">{latestPatchVersion ? `Patch ${latestPatchVersion}: official notes` : "Latest patch stories unavailable"}</Link></h2>
          <p className="dek" role="status">Latest patch stories could not be loaded. Check the patch desk for the current official record.</p>
          <ReadingLink className="action" href="/patches">Read the patch desk</ReadingLink>
        </div>
      </article> : lead && <article id="lead" className="front-page-lead" aria-labelledby="lead-headline">
        <div className="front-page-lead-copy">
          <h2 id="lead-headline" className="headline"><Link href={lead.path}>{lead.title}</Link></h2>
          <ReportDateline article={lead} />
          <p className="dek">{lead.description}</p>
          <ReadingLink className="action" href={lead.path}>{lead.publicationKind === "rundown" ? "Read the rundown" : "Read the report"}</ReadingLink>
        </div>
        <ReportImage article={lead} lead />
      </article>}
      {leadUnavailable && !showPatchFallback && <p className="np-error" role="status">Latest patch stories could not be loaded. <Link href="/patches">{latestPatchVersion ? `Patch ${latestPatchVersion}: official notes` : "Check the patch desk for the current official record"}</Link>.</p>}
      {secondary.map((secondary) => (
        <article key={secondary.slug} className="front-page-secondary" aria-labelledby={`headline-${secondary.slug}`}>
          <div className="front-page-secondary-heading">
            <h2 id={`headline-${secondary.slug}`}><Link href={secondary.path}>{secondary.title}</Link></h2>
            <ReportDateline article={secondary} />
          </div>
          <ReportImage article={secondary} />
          <div className="front-page-secondary-summary">
            <p>{secondary.description}</p>
            <ReadingLink className="action" href={secondary.path}>Read the report</ReadingLink>
          </div>
        </article>
      ))}
      <ReadingLink variant="quiet" className="chart-link" href="/news">More from the news desk</ReadingLink>
    </section>
  );
}
