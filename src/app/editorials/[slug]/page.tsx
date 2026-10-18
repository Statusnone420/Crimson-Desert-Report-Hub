import type { ResolvingMetadata } from "next";
import { notFound } from "next/navigation";
import { PublicShell } from "@/components/dispatch/Chrome";
import { ReadingLink } from "@/components/newspaper/ReadingLink";
import { COLUMN_EDITOR, COLUMN_NAME, editionDescription, editorialPath, formatUtcTimestamp, sourceProvenance } from "@/lib/editorials/content";
import { getPublicEditionBySlug } from "@/lib/editorials/store.server";
import { routeMetadata } from "@/lib/site";
import { editionJsonLd, serializeJsonLd } from "@/lib/structuredData";

export const revalidate = 300;
type Props = { params: Promise<{ slug: string }> };

async function resolveEdition({ params }: Props) {
  const { slug } = await params;
  const edition = await getPublicEditionBySlug(slug);
  if (!edition) notFound();
  return edition;
}

export async function generateMetadata(props: Props, parent: ResolvingMetadata) {
  const edition = await resolveEdition(props);
  return routeMetadata(edition.title, editorialPath(edition.slug), editionDescription(edition), parent);
}

export default async function EditionPage(props: Props) {
  const edition = await resolveEdition(props);
  const sources = new Map(edition.factsBox.sources.map((source) => [source.id, source]));
  return <PublicShell active="news">
    <article className="dispatch-container article-paper column-edition" id="article-top">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(editionJsonLd(edition)) }} />
      <header className="article-heading">
        <ReadingLink variant="quiet" direction="back" className="back-link" href="/">Back to the front page</ReadingLink>
        <p className="kicker">{COLUMN_NAME}</p>
        <h1>{edition.title}</h1>
        {edition.dek ? <p className="article-deck">{edition.dek}</p> : null}
        <div className="article-meta">
          <span className="column-byline">By {edition.author}</span>
          <span>Edited by {COLUMN_EDITOR}</span>
          <time dateTime={edition.publishAt}>{formatUtcTimestamp(edition.publishAt)}</time>
        </div>
      </header>
      <div className="article-body column-body">
        {edition.sections.map((section) => <section key={section.subhead}>
          <h2>{section.subhead}</h2>
          {section.paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
        </section>)}
        <aside className="column-facts" aria-labelledby="column-facts-heading">
          <h2 id="column-facts-heading">What&apos;s actually true</h2>
          <ul>{edition.factsBox.items.map((item) => <li key={item.text}>
            {item.text}{" "}
            {item.sourceIds.map((id) => sources.get(id)).filter((source) => source !== undefined).map((source) => (
              <a key={source.id} className="inline-source" href={source.url} {...(source.url.startsWith("/") ? {} : { target: "_blank", rel: "noopener noreferrer" })}>{source.label}</a>
            ))}
          </li>)}</ul>
        </aside>
        <section className="article-sources" aria-labelledby="column-sources-heading">
          <h2 id="column-sources-heading">Sources</h2>
          <ol>{edition.factsBox.sources.map((source) => (
            <li key={source.id}><ReadingLink variant="source" source={sourceProvenance(source.url)} href={source.url}>{source.label}</ReadingLink></li>
          ))}</ol>
        </section>
      </div>
    </article>
  </PublicShell>;
}
