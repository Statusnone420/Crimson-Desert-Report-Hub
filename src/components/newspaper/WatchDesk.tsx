import Image from "next/image";
import type { WatchSelection } from "@/lib/watchSelections";

const stillSizes = "(max-width:650px) 100vw, 50vw";

function sourceDate(value: string): string {
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function WatchPick({ selection, preload }: { selection: WatchSelection; preload?: boolean }) {
  return (
    <article className="watch-pick">
      <a className="watch-still" href={selection.url} target="_blank" rel="noreferrer noopener">
        <figure>
          <Image
            src={selection.still.src}
            width={selection.still.width}
            height={selection.still.height}
            sizes={stillSizes}
            alt={selection.still.alt}
            preload={preload}
          />
        </figure>
      </a>
      <div className="watch-copy">
        <p className="kicker">{selection.kindLabel}</p>
        <p className="np-date">
          {selection.sourceLabel}
          {selection.publishedAt ? (
            <>
              {" · "}
              <time dateTime={selection.publishedAt}>{sourceDate(selection.publishedAt)}</time>
            </>
          ) : null}
        </p>
        <a href={selection.url} target="_blank" rel="noreferrer noopener">
          <h2>{selection.headline}</h2>
        </a>
        <p className="watch-reason">{selection.reason}</p>
        <a className="action" href={selection.url} target="_blank" rel="noreferrer noopener">
          {selection.actionLabel}
        </a>
      </div>
    </article>
  );
}

export function WatchDesk({ selections }: { selections: readonly WatchSelection[] }) {
  return (
    <section className="watch-desk" aria-label="Selected videos">
      <div className="watch-desk-list" data-count={selections.length}>
        {selections.map((selection, index) => (
          <WatchPick key={selection.url} selection={selection} preload={index === 0} />
        ))}
      </div>
    </section>
  );
}
