import {
  formatHistoryChange,
  formatSignedReviewDelta,
  platformUnavailableMessage,
  reviewDeltaTone,
  summarizeSteamHistory,
  summarizeTwitchHistory,
  twitchCoverageLabel,
  type SteamHistoryPoint,
  type TwitchHistoryPoint,
} from "@/lib/platformPulseDisplay";

type SteamPulsePoint = SteamHistoryPoint & {
  collectedAt: string;
  reviewCountDelta: number | null;
  reviewsScanned: number;
  issueLanguageCount: number;
  leadsRetained: number;
};

type PlatformContext = {
  capturedAt: string;
  igdbStatus: string;
  releaseAt: string | null;
  platforms: string[];
  igdbUrl: string | null;
  twitchStatus: string;
  liveStreams: number | null;
  liveViewers: number | null;
  twitchComplete: boolean | null;
  twitchHistory: TwitchHistoryPoint[];
};

function compactNumber(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function timeAgo(iso: string): string {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function displayDate(iso: string | null): string {
  if (!iso) return "Not listed";
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "Not listed";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function displayShortDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime())) return iso;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function BarAxis({ dates }: { dates: string[] }) {
  const axisDates =
    dates.length <= 2
      ? dates
      : [dates[0], dates[Math.floor((dates.length - 1) / 2)], dates[dates.length - 1]];
  return (
    <div className="pulse-bar-axis" aria-hidden="true">
      {axisDates.map((date, index) => (
        <span key={`${date}-${index}`}>{displayShortDate(date)}</span>
      ))}
    </div>
  );
}

function ReviewMovementBars({
  points,
  start,
  end,
  change,
}: {
  points: SteamHistoryPoint[];
  start: string;
  end: string;
  change: string;
}) {
  const deltas = points.map((point) => point.reviewCountDelta ?? null);
  const maxMagnitude = deltas.reduce<number>(
    (largest, delta) => (delta === null ? largest : Math.max(largest, Math.abs(delta))),
    1,
  );
  const dates = points.map((point) => point.snapshotDay);

  return (
    <div className="pulse-history-row">
      <div className="pulse-history-row__label">
        <span>Review movement</span>
        <b>{start} → {end}</b>
        <em>{change} in window</em>
        <div className="pulse-history-row__key" aria-label="Review movement chart key">
          <span><i className="pulse-history-row__key-mark pulse-history-row__key-mark--positive" aria-hidden="true" />added</span>
          <span><i className="pulse-history-row__key-mark pulse-history-row__key-mark--negative" aria-hidden="true" />removed</span>
        </div>
      </div>
      <figure className="pulse-bar-figure">
        <div
          className="pulse-bar-plot pulse-bar-plot--movement"
          role="img"
          aria-label={`Review volume across ${points.length} recorded snapshots, from ${start} to ${end}, change ${change}. Bars show recorded review-count movement for each snapshot; missing baselines are left blank.`}
        >
          <span className="pulse-bar-plot__zero" aria-hidden="true" />
          {points.map((point, index) => {
            const delta = deltas[index];
            const title =
              delta === null
                ? `${displayDate(point.snapshotDay)}: no prior baseline`
                : `${displayDate(point.snapshotDay)}: ${formatSignedReviewDelta(delta)} reviews since the previous recorded day`;
            const height = delta === null ? "0%" : `${(Math.abs(delta) / maxMagnitude) * 100}%`;
            return (
              <span
                key={`${point.snapshotDay}-${index}`}
                className="pulse-bar-cell"
                data-review-delta={delta === null ? "missing" : delta}
                title={title}
                aria-hidden="true"
              >
                {delta === null ? (
                  <i className="pulse-bar-cell__mark pulse-bar-cell__mark--missing" />
                ) : delta > 0 ? (
                  <i className="pulse-bar-cell__bar pulse-bar-cell__bar--positive" style={{ height }} />
                ) : delta < 0 ? (
                  <i className="pulse-bar-cell__bar pulse-bar-cell__bar--negative" style={{ height }} />
                ) : (
                  <i className="pulse-bar-cell__mark pulse-bar-cell__mark--flat" />
                )}
              </span>
            );
          })}
        </div>
        <BarAxis dates={dates} />
        <ul className="sr-only">
          {points.map((point, index) => {
            const delta = deltas[index];
            return (
              <li key={`${point.snapshotDay}-review-value`}>
                {displayDate(point.snapshotDay)}:{" "}
                {delta === null
                  ? "no prior baseline"
                  : `${formatSignedReviewDelta(delta)} reviews since the previous recorded day`}
              </li>
            );
          })}
        </ul>
      </figure>
    </div>
  );
}

function PositivityShareBars({
  points,
  start,
  end,
  change,
}: {
  points: SteamHistoryPoint[];
  start: string;
  end: string;
  change: string;
}) {
  const dates = points.map((point) => point.snapshotDay);

  return (
    <div className="pulse-history-row">
      <div className="pulse-history-row__label">
        <span>Positive share</span>
        <b>{start} → {end}</b>
        <em>{change}</em>
        <div className="pulse-history-row__key" aria-label="Positive-share chart key">
          <span><i className="pulse-history-row__key-mark pulse-history-row__key-mark--positive" aria-hidden="true" />positive</span>
          <span><i className="pulse-history-row__key-mark pulse-history-row__key-mark--negative" aria-hidden="true" />negative</span>
        </div>
      </div>
      <figure className="pulse-bar-figure">
        <div
          className="pulse-bar-plot pulse-bar-plot--share"
          role="img"
          aria-label={`Positive share across ${points.length} recorded snapshots, from ${start} to ${end}, change ${change}. Each full-height bar splits the exact positive share in green from negative share in magenta.`}
        >
          {points.map((point, index) => {
            const positive = Math.min(100, Math.max(0, point.positivePercentage));
            const negative = 100 - positive;
            const title = `${displayDate(point.snapshotDay)}: ${positive.toFixed(1)}% positive, ${negative.toFixed(1)}% negative`;
            return (
              <span
                key={`${point.snapshotDay}-${index}`}
                className="pulse-share-cell"
                data-positive-share={positive.toFixed(1)}
                title={title}
                aria-hidden="true"
              >
                <i className="pulse-share-cell__bar">
                  <i
                    className="pulse-share-cell__segment pulse-share-cell__segment--negative"
                    style={{ height: `${negative}%` }}
                  />
                  <i
                    className="pulse-share-cell__segment pulse-share-cell__segment--positive"
                    style={{ height: `${positive}%` }}
                  />
                </i>
              </span>
            );
          })}
        </div>
        <BarAxis dates={dates} />
        <ul className="sr-only">
          {points.map((point) => {
            const positive = Math.min(100, Math.max(0, point.positivePercentage));
            return (
              <li key={`${point.snapshotDay}-positive-value`}>
                {displayDate(point.snapshotDay)}: {positive.toFixed(1)}% positive, {(100 - positive).toFixed(1)}% negative
              </li>
            );
          })}
        </ul>
      </figure>
    </div>
  );
}

function CollectingHistory({
  lane,
  snapshotCount,
}: {
  lane: "review" | "Twitch";
  snapshotCount: number;
}) {
  return (
    <div className="context-card__collecting" role="status">
      <strong>Collecting {lane} history</strong>
      <span>
        {snapshotCount === 0
          ? "No comparable snapshots recorded yet."
          : `${snapshotCount} snapshot recorded. Trend begins after the next capture.`}
      </span>
    </div>
  );
}

export function PlatformPulseCards({
  steamPulse,
  platformContext,
  pulseReadFailures,
  brief = false,
}: {
  steamPulse: SteamPulsePoint[];
  platformContext: PlatformContext | null;
  pulseReadFailures: ("steam" | "platform")[];
  brief?: boolean;
}) {
  const latestSteam = steamPulse[steamPulse.length - 1] ?? null;
  const steamHistory = summarizeSteamHistory(steamPulse);
  const twitchHistory = summarizeTwitchHistory(platformContext?.twitchHistory ?? []);
  const providerMessages = platformContext
    ? [
        platformUnavailableMessage("IGDB", platformContext.igdbStatus),
        platformUnavailableMessage("Twitch", platformContext.twitchStatus),
      ].filter(Boolean)
    : [];
  const readFailureMessages = pulseReadFailures.map((lane) =>
    lane === "steam"
      ? "Steam Pulse is temporarily unavailable."
      : "IGDB and Twitch context is temporarily unavailable.",
  );
  const reviewValues = steamHistory.points.map((point) => point.totalReviews);
  const positivityValues = steamHistory.points.map((point) => point.positivePercentage);

  return (
    <>
      <div className={`context-pulse__grid${brief ? " context-pulse__grid--brief" : ""}`}>
        {latestSteam ? (
          <article className="context-card context-card--steam">
            <div className="context-card__heading">
              <div>
                <p className="mono-label">Steam Pulse</p>
                <h3>
                  {latestSteam.reviewCountDelta === null
                    ? "Review baseline recorded"
                    : latestSteam.reviewCountDelta > 0
                      ? "Review count is rising"
                      : latestSteam.reviewCountDelta < 0
                        ? "Review count changed"
                        : "Review count is steady"}
                </h3>
              </div>
              <span>Updated {timeAgo(latestSteam.collectedAt)}</span>
            </div>
            <div className="context-card__stats">
              <div><b>{compactNumber(latestSteam.totalReviews)}</b><span>total reviews</span></div>
              <div><b>{latestSteam.positivePercentage.toFixed(0)}%</b><span>positive</span></div>
              <div>
                <b className={`steam-pulse-chart__delta steam-pulse-chart__delta--${reviewDeltaTone(latestSteam.reviewCountDelta)}`}>
                  {formatSignedReviewDelta(latestSteam.reviewCountDelta)}
                </b>
                <span>{latestSteam.reviewCountDelta === null ? "baseline not established" : "since previous recorded day"}</span>
              </div>
            </div>
            {steamHistory.status === "ready" ? (
              <div className="context-card__history">
                <div className="context-card__history-heading">
                  <span>{steamHistory.windowDays}-day window</span>
                  <b>{steamHistory.snapshotCount} recorded snapshots</b>
                </div>
                <ReviewMovementBars
                  points={steamHistory.points}
                  start={compactNumber(reviewValues[0])}
                  end={compactNumber(reviewValues[reviewValues.length - 1])}
                  change={formatHistoryChange(steamHistory.reviewChange, "reviews")}
                />
                <PositivityShareBars
                  points={steamHistory.points}
                  start={`${positivityValues[0].toFixed(1)}%`}
                  end={`${positivityValues[positivityValues.length - 1].toFixed(1)}%`}
                  change={formatHistoryChange(steamHistory.positivityChange, "points")}
                />
              </div>
            ) : (
              <CollectingHistory lane="review" snapshotCount={steamHistory.snapshotCount} />
            )}
            <p className="context-card__note">
              Latest sample screened {latestSteam.reviewsScanned} changed {latestSteam.reviewsScanned === 1 ? "review" : "reviews"}, found {latestSteam.issueLanguageCount} with issue language,
              and kept {latestSteam.leadsRetained} private radar {latestSteam.leadsRetained === 1 ? "lead" : "leads"}. Review text is not counted as a player report.
            </p>
          </article>
        ) : null}
        {platformContext ? (
          <article className="context-card context-card--platform">
            <div className="context-card__heading">
              <div><p className="mono-label">IGDB + Twitch</p><h3>Release and Twitch interest</h3></div>
              <span>Captured {timeAgo(platformContext.capturedAt)}</span>
            </div>
            <div className="context-card__stats context-card__stats--twitch">
              <div><b>{compactNumber(platformContext.liveViewers)}</b><span>viewers now</span></div>
              <div><b>{compactNumber(twitchHistory.peakViewers)}</b><span>24h peak</span></div>
              <div><b>{compactNumber(twitchHistory.lowViewers)}</b><span>24h low</span></div>
              <div>
                <b className={`steam-pulse-chart__delta steam-pulse-chart__delta--${reviewDeltaTone(twitchHistory.viewerChange)}`}>
                  {formatHistoryChange(twitchHistory.viewerChange, "viewers")}
                </b>
                <span>change in 24h window</span>
              </div>
            </div>
            {twitchHistory.status === "collecting" ? (
              <CollectingHistory lane="Twitch" snapshotCount={twitchHistory.snapshotCount} />
            ) : (
              <p className="context-card__history-window">
                24-hour Twitch window · {twitchHistory.snapshotCount} actual snapshots
              </p>
            )}
            {providerMessages.length > 0 ? (
              <div className="context-card__status-list">
                {providerMessages.map((message) => (
                  <p key={message} className="context-card__status-item">{message}</p>
                ))}
              </div>
            ) : null}
            <dl className="context-card__facts">
              <div><dt>Release</dt><dd>{displayDate(platformContext.releaseAt)}</dd></div>
              <div><dt>Platforms</dt><dd>{platformContext.platforms.join(" · ") || "Not listed"}</dd></div>
              <div><dt>Live streams</dt><dd>{compactNumber(platformContext.liveStreams)} at latest capture</dd></div>
              <div><dt>Coverage</dt><dd>{twitchCoverageLabel(platformContext.twitchComplete)}</dd></div>
            </dl>
            {platformContext.igdbUrl ? (
              <a className="dispatch-link context-card__attribution" href={platformContext.igdbUrl} target="_blank" rel="noreferrer">
                View on IGDB ↗
              </a>
            ) : null}
            <p className="context-card__note">
              Counts are snapshots, not watch time. No channel identities, stream titles, URLs, or thumbnails are stored.
            </p>
          </article>
        ) : null}
      </div>
      {readFailureMessages.length > 0 ? (
        <div className="context-card__status-list" role="status">
          {readFailureMessages.map((message) => (
            <p key={message} className="context-card__status-item">{message}</p>
          ))}
        </div>
      ) : null}
    </>
  );
}
