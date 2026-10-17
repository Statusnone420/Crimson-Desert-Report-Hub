import { DayScrubber, type ScrubItem } from "./DayScrubber";
import { MonthAxis, PatchLabels, dayLabel, type ChartPatch } from "./PatchSeismograph";
import { patchMarkers, slotCenter } from "@/lib/activityCharts";
import { reviewShare, type ActivityHistory } from "@/lib/activityHistory";

/** Fewer new reviews than this in a day make its share too noisy to colour. */
export const MOOD_MIN_REVIEWS = 50;

const STEPS = [
  { className: "mood-n3", label: "10+ points cooler" },
  { className: "mood-n2", label: "5–10 cooler" },
  { className: "mood-n1", label: "2–5 cooler" },
  { className: "mood-z", label: "within 2 points" },
  { className: "mood-p1", label: "2–5 warmer" },
  { className: "mood-p2", label: "5–10 warmer" },
  { className: "mood-p3", label: "10+ points warmer" },
] as const;

/** Points from the period average to a colour step; edges round toward the neutral middle. */
export function moodClass(deviation: number): string {
  const size = Math.abs(deviation);
  if (size <= 2) return "mood-z";
  return `mood-${deviation < 0 ? "n" : "p"}${size <= 5 ? 1 : size <= 10 ? 2 : 3}`;
}

export function MoodRibbon({ history, patches }: { history: ActivityHistory; patches: ChartPatch[] }) {
  const days = history.days;
  const period = reviewShare(days, 5);
  if (history.lanes.reviews === "unavailable") return <p className="np-error">Steam review totals could not be read.</p>;
  if (!period || days.length === 0) return <p className="obs-note">Not enough daily Steam review records yet to compare days.</p>;
  const markers = patchMarkers(days, patches);
  const cells = days.map((day, index) => {
    const readable = day.newReviews !== null && day.newPositive !== null && day.newReviews > 0 && day.newPositive >= 0 && day.newPositive <= day.newReviews;
    const share = readable ? (day.newPositive! / day.newReviews!) * 100 : null;
    const deviation = share === null ? null : share - period.share;
    const small = readable && day.newReviews! < MOOD_MIN_REVIEWS;
    return { day, index, share, deviation, small, className: deviation === null ? "is-empty" : small ? "is-small" : moodClass(deviation) };
  });
  const items: ScrubItem[] = cells.map(({ day, index, share, deviation, small }) => ({
    x: slotCenter(index, days.length),
    title: dayLabel(day.day),
    detail: share === null || deviation === null
      ? "No readable change in Steam reviews that day"
      : `${day.newReviews!.toLocaleString("en-US")} new reviews, ${share.toFixed(1)}% positive, ${deviation >= 0 ? "+" : "−"}${Math.abs(deviation).toFixed(1)} points against the period average${small ? " · a small day, not coloured" : ""}`,
  }));
  const lastReadable = cells.findLastIndex((cell) => cell.share !== null);
  const firstRecord = days.findIndex((day) => day.totalReviews !== null);

  return (
    <figure className="dd-figure" aria-labelledby="mood-title">
      <figcaption className="dd-figcaption">
        <h3 id="mood-title">The mood ribbon</h3>
        <p>One cell per day: the share of new Steam reviews that were positive, against the period average of {period.share.toFixed(1)}%. Blue is warmer than usual, red is cooler.</p>
      </figcaption>
      <DayScrubber id="mood" label="Move through the days" items={items} initialIndex={lastReadable < 0 ? days.length - 1 : lastReadable}>
        <PatchLabels markers={markers} />
        <div className="dd-ribbon" aria-hidden="true">
          {cells.map((cell) => <span key={cell.day.day} className={`dd-cell ${cell.className}`} />)}
        </div>
        <MonthAxis days={days} />
      </DayScrubber>
      <ul className="dd-legend" aria-label="Colour scale">
        {STEPS.map((step) => <li key={step.className}><i className={`dd-swatch ${step.className}`} aria-hidden="true" />{step.label}</li>)}
        <li><i className="dd-swatch is-small" aria-hidden="true" />under {MOOD_MIN_REVIEWS} new reviews</li>
      </ul>
      <details className="dd-table">
        <summary>Read the daily shares</summary>
        <div className="dd-table-scroll">
          <table>
            <caption>Net new Steam reviews per day, UTC.</caption>
            <thead><tr><th scope="col">Day</th><th scope="col">New reviews</th><th scope="col">Positive</th><th scope="col">Against average</th></tr></thead>
            <tbody>
              {[...cells].reverse().map((cell) => (
                <tr key={cell.day.day}>
                  <th scope="row">{dayLabel(cell.day.day)}</th>
                  <td>{cell.day.newReviews === null ? "" : cell.day.newReviews.toLocaleString("en-US")}</td>
                  <td>{cell.share === null ? "" : `${cell.share.toFixed(1)}%`}</td>
                  <td>{cell.deviation === null ? "" : `${cell.deviation >= 0 ? "+" : "−"}${Math.abs(cell.deviation).toFixed(1)}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <p className="dd-source">Built from Steam&apos;s own daily review totals, so a day counts every new review, net of removals and changed votes.{firstRecord > 0 ? ` Totals were first recorded on ${dayLabel(days[firstRecord].day)}.` : ""}</p>
    </figure>
  );
}
