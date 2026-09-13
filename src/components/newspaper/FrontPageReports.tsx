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

/** The same published original reports as News, in the desk's curated order. */
export function FrontPageReports({ articles = editorialArticles }: { articles?: readonly EditorialArticle[] }) {
  const [lead, secondary] = articles;
  if (!lead) return null;

  return (
    <section className="front-page-reports" aria-label="Original Hub reports">
      <article id="lead" className="front-page-lead" aria-labelledby="lead-headline">
        <div className="front-page-lead-copy">
          <h2 id="lead-headline" className="headline"><Link href={lead.path}>{lead.title}</Link></h2>
          <ReportDateline article={lead} />
          <p className="dek">{lead.description}</p>
          <ReadingLink className="action" href={lead.path}>Read the report</ReadingLink>
        </div>
        <ReportImage article={lead} lead />
      </article>
      {secondary ? (
        <article className="front-page-secondary" aria-labelledby="secondary-headline">
          <div className="front-page-secondary-heading">
            <h2 id="secondary-headline"><Link href={secondary.path}>{secondary.title}</Link></h2>
            <ReportDateline article={secondary} />
          </div>
          <ReportImage article={secondary} />
          <div className="front-page-secondary-summary">
            <p>{secondary.description}</p>
            <ReadingLink className="action" href={secondary.path}>Read the report</ReadingLink>
          </div>
        </article>
      ) : null}
      <ReadingLink variant="quiet" className="chart-link" href="/news">More from the news desk</ReadingLink>
    </section>
  );
}
