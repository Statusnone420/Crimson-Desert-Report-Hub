import { getEditorialCoverage } from "@/lib/editorialCoverage";
import { editorialSourceById } from "@/lib/editorialSources";

export function PublicationFeed({ type = "article" }: { type?: "article" | "video" }) {
  const publications = getEditorialCoverage().filter((item) => item.type === type);
  if (publications.length === 0) return null;
  const solo = publications.length === 1;
  const kicker = type === "video" ? "Creator spotlight" : "From the wire";
  const heading = type === "video" ? "A creator’s view of Pywel" : "Around the expansion reveal";
  return <section className="np-wire" aria-label={type === "video" ? "Selected creator coverage" : "Selected press coverage"}>
    {solo ? null : <><p className="kicker">{kicker}</p><h2>{heading}</h2></>}
    <div className={solo ? "np-wire-feature" : undefined}>{publications.map((item) => <article key={item.url}>
      <div>
        {solo ? <><p className="kicker">{kicker}</p><h2>{heading}</h2></> : null}
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
