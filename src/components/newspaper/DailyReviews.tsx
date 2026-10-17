import { DayScrubber, type ScrubItem } from "./DayScrubber";
import { dayLabel, MonthAxis, PatchLabels, type ChartPatch } from "./chartParts";
import { patchMarkers, slotCenter } from "@/lib/activityCharts";
import { completeDays, partialDay, reviewShare, type ActivityHistory } from "@/lib/activityHistory";

/** Fewer new reviews than this in a day make its share too noisy to color. */
export const DAY_MIN_REVIEWS = 50;

/** Worse days are red and better days blue, matching how people read the two colors. */
const STEPS = [
  { className: "rv-w3", label: "10+ points worse" },
  { className: "rv-w2", label: "5–10 worse" },
  { className: "rv-w1", label: "2–5 worse" },
  { className: "rv-z", label: "within 2 points" },
  { className: "rv-b1", label: "2–5 better" },
  { className: "rv-b2", label: "5–10 better" },
  { className: "rv-b3", label: "10+ points better" },
] as const;

/** Points from the usual share to a color step; edges round toward the neutral middle. */
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

type Cell = { day: string; newReviews: number | null; share: number | null; deviation: number | null; className: string; detail: string };

export function DailyReviews({ history, patches }: { history: ActivityHistory; patches: ChartPatch[] }) {
  const days = history.days;
  const today = partialDay(history);
  // The usual leaves out today's partial day, which is still being recorded.
  const usual = reviewShare(completeDays(history), 5);
  const usualName = `${days.length}-day usual`;
  if (history.lanes.reviews === "unavailable") return <p className="np-error">Steam review totals could not be read.</p>;
  if (!usual || days.length === 0) return <p className="obs-note">Not enough daily Steam review records yet to compare days.</p>;
  const markers = patchMarkers(days, patches);
  const cells: Cell[] = days.map((day) => {
    const { newReviews, newPositive } = day;
    const readable = newReviews !== null && newPositive !== null && newReviews > 0 && newPositive >= 0 && newPositive <= newReviews;
    const share = readable ? (newPositive / newReviews) * 100 : null;
    const deviation = share === null ? null : share - usual.share;
    const counted = newReviews === null ? "" : `${newReviews.toLocaleString("en-US")} new ${newReviews === 1 ? "review" : "reviews"}`;
    if (newReviews === null) return { day: day.day, newReviews, share, deviation, className: "is-empty", detail: "No Steam review record for this day" };
    if (newReviews < 0) {
      return { day: day.day, newReviews, share, deviation, className: "is-loss", detail: `Net ${newReviews.toLocaleString("en-US")} reviews: more were removed than added` };
    }
    if (share === null || deviation === null) {
      return { day: day.day, newReviews, share, deviation, className: "is-empty", detail: newReviews === 0 ? "No net change in Steam reviews" : `${counted}; changed votes make the share unreadable` };
    }
    const reading = `${counted}, ${share.toFixed(1)}% positive`;
    if (day.day === today) return { day: day.day, newReviews, share, deviation, className: "is-partial", detail: `${reading} so far. The day is not colored until it is complete` };
    const small = newReviews < DAY_MIN_REVIEWS;
    return {
      day: day.day, newReviews, share, deviation,
      className: small ? "is-small" : reviewDayClass(deviation),
      detail: `${reading}, ${against(deviation, " points")?.concat(` than the ${usualName}`) ?? `level with the ${usualName}`}${small ? `. Under ${DAY_MIN_REVIEWS} reviews, so not colored` : ""}`,
    };
  });
  const title = (day: string) => (day === today ? `${dayLabel(day)}, today so far` : dayLabel(day));
  const items: ScrubItem[] = cells.map((cell, index) => ({ x: slotCenter(index, days.length), title: title(cell.day), detail: cell.detail }));
  const lastComplete = cells.findLastIndex((cell) => cell.share !== null && cell.day !== today);
  const firstRecord = days.findIndex((day) => day.totalReviews !== null);
  const shown = new Set(cells.map((cell) => cell.className));

  return (
    <figure className="dd-figure" aria-labelledby="daily-reviews-title">
      <figcaption className="dd-figcaption">
        <h3 id="daily-reviews-title">Each day&apos;s Steam reviews</h3>
        <p>
          One square per day: the share of that day&apos;s new Steam reviews that were positive, against the <span className="dd-nowrap">{usualName}</span> of {usual.share.toFixed(1)}%.
          Blue days were better than usual, red days worse, gray days within 2 points.
        </p>
      </figcaption>
      <ul className="dd-legend" aria-label={`Color key, against the ${usualName}`}>
        {STEPS.map((step) => <li key={step.className}><i className={`dd-swatch ${step.className}`} aria-hidden="true" />{step.label}</li>)}
        <li><i className="dd-swatch is-small" aria-hidden="true" />under {DAY_MIN_REVIEWS} new reviews</li>
        {shown.has("is-loss") ? <li><i className="dd-swatch is-loss" aria-hidden="true" />more removed than added</li> : null}
        {shown.has("is-partial") ? <li><i className="dd-swatch is-partial" aria-hidden="true" />today so far</li> : null}
      </ul>
      <DayScrubber id="daily-reviews" label="Choose a day: each day's Steam reviews" items={items} initialIndex={lastComplete < 0 ? days.length - 1 : lastComplete}>
        <PatchLabels markers={markers} />
        <div className="dd-ribbon" aria-hidden="true">
          {cells.map((cell) => <span key={cell.day} className={`dd-cell ${cell.className}`} />)}
        </div>
        <MonthAxis days={days} />
      </DayScrubber>
      <details className="dd-table">
        <summary>Read the daily shares</summary>
        <div className="dd-table-scroll">
          <table>
            <caption>Net new Steam reviews per day, UTC, against the {usualName} of {usual.share.toFixed(1)}%.</caption>
            <thead><tr><th scope="col">Day</th><th scope="col">New reviews</th><th scope="col">Positive</th><th scope="col">Against the {usualName} (points)</th></tr></thead>
            <tbody>
              {[...cells].reverse().map((cell) => (
                <tr key={cell.day}>
                  <th scope="row">{cell.day === today ? `${dayLabel(cell.day)} (today so far)` : dayLabel(cell.day)}</th>
                  <td>{cell.newReviews === null ? "" : cell.newReviews.toLocaleString("en-US")}</td>
                  <td>{cell.share === null ? "" : `${cell.share.toFixed(1)}%`}</td>
                  <td>{cell.deviation === null || cell.day === today ? "" : against(cell.deviation, "") ?? "level"}</td>
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
