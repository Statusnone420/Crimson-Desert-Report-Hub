import { getEditorialCoverage } from "@/lib/editorialCoverage";
import { editorialSourceById } from "@/lib/editorialSources";

export function PublicationFeed({ type = "article" }: { type?: "article" | "video" }) {
  const publications = getEditorialCoverage().filter((item) => item.type === type);
  if (publications.length === 0) return null;
  return <section className="np-wire" aria-label={type === "video" ? "Selected creator coverage" : "Selected press coverage"}>
    <p className="kicker">{type === "video" ? "Creator spotlight" : "From the wire"}</p>
    <h2>{type === "video" ? "A creator’s view of Pywel" : "Around the expansion reveal"}</h2>
    <div className={publications.length === 1 ? "np-wire-feature" : undefined}>{publications.map((item) => <article key={item.url}>
      <div>
        <p className="np-date">{editorialSourceById(item.sourceId)?.label} · {item.sourceKind === "official" ? "Official" : item.type === "video" ? "Creator commentary" : "Press coverage"} · <time dateTime={item.publishedAt}>{new Date(item.publishedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}</time></p>
        <a href={item.url} target="_blank" rel="noreferrer noopener"><h3>{item.headline}</h3></a>
      </div>
      <div>
        <p>{item.excerpt}</p>
        <a className="action" title={item.sourceTitle} href={item.url} target="_blank" rel="noreferrer noopener">{type === "video" ? "Watch on YouTube" : "Read at the source"} ↗</a>
      </div>
    </article>)}</div>
  </section>;
}
