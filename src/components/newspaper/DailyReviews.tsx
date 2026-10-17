import { DayScrubber, type ScrubItem } from "./DayScrubber";
import { dayLabel, MonthAxis, PatchLabels, type ChartPatch } from "./chartParts";
import { patchMarkers, slotCenter } from "@/lib/activityCharts";
import { reviewShare, type ActivityHistory } from "@/lib/activityHistory";

/** Fewer new reviews than this in a day make its share too noisy to colour. */
export const DAY_MIN_REVIEWS = 50;

/** Worse days are red and better days blue, matching how people read the two colours. */
const STEPS = [
  { className: "rv-w3", label: "10+ points worse" },
  { className: "rv-w2", label: "5–10 worse" },
  { className: "rv-w1", label: "2–5 worse" },
  { className: "rv-z", label: "within 2 points" },
  { className: "rv-b1", label: "2–5 better" },
  { className: "rv-b2", label: "5–10 better" },
  { className: "rv-b3", label: "10+ points better" },
] as const;

/** Points from the period average to a colour step; edges round toward the neutral middle. */
export function reviewDayClass(deviation: number): string {
  const size = Math.abs(deviation);
  if (size <= 2) return "rv-z";
  return `rv-${deviation < 0 ? "w" : "b"}${size <= 5 ? 1 : size <= 10 ? 2 : 3}`;
}

/** "4.4 points worse" or "1.2 better"; null when level at the displayed precision. */
function against(deviation: number, unit: string): string | null {
  if (Math.abs(deviation) < 0.05) return null;
  return `${Math.abs(deviation).toFixed(1)}${unit} ${deviation < 0 ? "worse" : "better"}`;
}

export function DailyReviews({ history, patches }: { history: ActivityHistory; patches: ChartPatch[] }) {
  const days = history.days;
  const period = reviewShare(days, 5);
  if (history.lanes.reviews === "unavailable") return <p className="np-error">Steam review totals could not be read.</p>;
  if (!period || days.length === 0) return <p className="obs-note">Not enough daily Steam review records yet to compare days.</p>;
  const markers = patchMarkers(days, patches);
  const cells = days.map((day, index) => {
    const readable = day.newReviews !== null && day.newPositive !== null && day.newReviews > 0 && day.newPositive >= 0 && day.newPositive <= day.newReviews;
    const share = readable ? (day.newPositive! / day.newReviews!) * 100 : null;
    const deviation = share === null ? null : share - period.share;
    const small = readable && day.newReviews! < DAY_MIN_REVIEWS;
    return { day, index, share, deviation, small, className: deviation === null ? "is-empty" : small ? "is-small" : reviewDayClass(deviation) };
  });
  const items: ScrubItem[] = cells.map(({ day, index, share, deviation, small }) => ({
    x: slotCenter(index, days.length),
    title: dayLabel(day.day),
    detail: share === null || deviation === null
      ? "No readable change in Steam reviews that day"
      : `${day.newReviews!.toLocaleString("en-US")} new reviews, ${share.toFixed(1)}% positive, ${against(deviation, " points")?.concat(" than the average") ?? "level with the average"}${small ? " · a small day, not coloured" : ""}`,
  }));
  const lastReadable = cells.findLastIndex((cell) => cell.share !== null);
  const firstRecord = days.findIndex((day) => day.totalReviews !== null);

  return (
    <figure className="dd-figure" aria-labelledby="daily-reviews-title">
      <figcaption className="dd-figcaption">
        <h3 id="daily-reviews-title">Each day&apos;s Steam reviews</h3>
        <p>
          One square per day: the share of that day&apos;s new Steam reviews that were positive, against the average for these days, {period.share.toFixed(1)}%.
          Blue days were better than usual, red days worse, grey days within 2 points. Days with under {DAY_MIN_REVIEWS} new reviews are outlined, not coloured.
        </p>
      </figcaption>
      <DayScrubber id="daily-reviews" label="Move through the days" items={items} initialIndex={lastReadable < 0 ? days.length - 1 : lastReadable}>
        <PatchLabels markers={markers} />
        <div className="dd-ribbon" aria-hidden="true">
          {cells.map((cell) => <span key={cell.day.day} className={`dd-cell ${cell.className}`} />)}
        </div>
        <MonthAxis days={days} />
      </DayScrubber>
      <ul className="dd-legend" aria-label="Colour key, against the average">
        {STEPS.map((step) => <li key={step.className}><i className={`dd-swatch ${step.className}`} aria-hidden="true" />{step.label}</li>)}
        <li><i className="dd-swatch is-small" aria-hidden="true" />under {DAY_MIN_REVIEWS} new reviews</li>
      </ul>
      <details className="dd-table">
        <summary>Read the daily shares</summary>
        <div className="dd-table-scroll">
          <table>
            <caption>Net new Steam reviews per day, UTC, against the average of {period.share.toFixed(1)}%.</caption>
            <thead><tr><th scope="col">Day</th><th scope="col">New reviews</th><th scope="col">Positive</th><th scope="col">Against the average</th></tr></thead>
            <tbody>
              {[...cells].reverse().map((cell) => (
                <tr key={cell.day.day}>
                  <th scope="row">{dayLabel(cell.day.day)}</th>
                  <td>{cell.day.newReviews === null ? "" : cell.day.newReviews.toLocaleString("en-US")}</td>
                  <td>{cell.share === null ? "" : `${cell.share.toFixed(1)}%`}</td>
                  <td>{cell.deviation === null ? "" : against(cell.deviation, "") ?? "level"}</td>
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
