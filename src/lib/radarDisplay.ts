const HOUR_MS = 60 * 60 * 1000;

export const RADAR_RECENCY_BANDS = [
  { id: "latest_scan", label: "Latest scan", sentence: "Seen in latest scan" },
  { id: "under_6h", label: "Under 6h", sentence: "Seen under 6h ago" },
  { id: "6_24h", label: "6–24h", sentence: "Seen 6–24h ago" },
  { id: "1_3d", label: "1–3d", sentence: "Seen 1–3d ago" },
  { id: "4_7d", label: "4–7d", sentence: "Seen 4–7d ago" },
  { id: "8d_plus", label: "8+d", sentence: "Seen 8+d ago" },
] as const;

export type RadarRecencyBandId = (typeof RADAR_RECENCY_BANDS)[number]["id"];

const BAND_INDEX = new Map<RadarRecencyBandId, number>(
  RADAR_RECENCY_BANDS.map((band, index) => [band.id, index]),
);

export type RadarDisplayPoint = {
  category: string;
  recencyBand: RadarRecencyBandId;
  hoursSinceSeen: number;
  hoursTracked: number;
  seenCount: number;
  isPublic: boolean;
};

export type RadarLayoutPoint = {
  point: RadarDisplayPoint;
  sourceIndex: number;
  sectorIndex: number;
  bandIndex: number;
  /** Position inside the sector sweep, from zero to one. */
  angleFraction: number;
  /** Position inside the full radar radius, from zero to one. */
  radiusFraction: number;
};

function timestamp(value: string | Date | null): number | null {
  if (value === null) return null;
  const parsed = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

export function classifyRadarRecency({
  lastSeenAt,
  latestScanAt,
  now = new Date(),
}: {
  lastSeenAt: string | Date;
  latestScanAt: string | Date | null;
  now?: Date;
}): RadarRecencyBandId {
  const lastSeenMs = timestamp(lastSeenAt);
  const latestScanMs = timestamp(latestScanAt);
  const nowMs = now.getTime();
  if (lastSeenMs === null || !Number.isFinite(nowMs)) return "8d_plus";
  if (latestScanMs !== null && lastSeenMs >= latestScanMs && lastSeenMs <= nowMs) return "latest_scan";

  const elapsedHours = Math.max(0, (nowMs - lastSeenMs) / HOUR_MS);
  if (elapsedHours < 6) return "under_6h";
  if (elapsedHours < 24) return "6_24h";
  if (elapsedHours < 4 * 24) return "1_3d";
  if (elapsedHours < 8 * 24) return "4_7d";
  return "8d_plus";
}

function formatTrackedDuration(hoursTracked: number): string {
  const safeHours = Math.max(0, Math.floor(hoursTracked));
  if (safeHours < 1) return "under 1 hour";
  if (safeHours < 24) return `${safeHours} ${safeHours === 1 ? "hour" : "hours"}`;
  const days = Math.floor(safeHours / 24);
  return `${days} ${days === 1 ? "day" : "days"}`;
}

export function radarPointDescription(point: RadarDisplayPoint): string {
  const band = RADAR_RECENCY_BANDS[BAND_INDEX.get(point.recencyBand) ?? RADAR_RECENCY_BANDS.length - 1];
  return `${band.sentence} · observed ${Math.max(1, Math.floor(point.seenCount))}× · tracked for ${formatTrackedDuration(point.hoursTracked)}.`;
}

/**
 * Place actual points in sector/band cells. A small deterministic grid inside
 * each cell gives coincident timestamps separate centers without inventing
 * time values or relying on random jitter.
 */
export function layoutRadarPoints(
  points: RadarDisplayPoint[],
  sectorOrder: string[],
): RadarLayoutPoint[] {
  const sectorIndex = new Map(sectorOrder.map((category, index) => [category, index]));
  const groups = new Map<string, { point: RadarDisplayPoint; sourceIndex: number }[]>();

  points.forEach((point, sourceIndex) => {
    const sector = sectorIndex.get(point.category);
    const band = BAND_INDEX.get(point.recencyBand);
    if (sector === undefined || band === undefined) return;
    const key = `${sector}:${band}`;
    const list = groups.get(key) ?? [];
    list.push({ point, sourceIndex });
    groups.set(key, list);
  });

  const laidOut: RadarLayoutPoint[] = [];
  for (const [key, group] of groups) {
    const [sector, band] = key.split(":").map(Number);
    group.sort(
      (a, b) =>
        a.point.hoursSinceSeen - b.point.hoursSinceSeen ||
        b.point.seenCount - a.point.seenCount ||
        b.point.hoursTracked - a.point.hoursTracked ||
        Number(b.point.isPublic) - Number(a.point.isPublic) ||
        a.sourceIndex - b.sourceIndex,
    );

    const columns = Math.ceil(Math.sqrt(group.length));
    const rows = Math.ceil(group.length / columns);
    group.forEach(({ point, sourceIndex }, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const angleFraction = 0.14 + 0.72 * ((column + 0.5) / columns);
      const radiusFraction =
        (band + (row + 0.5) / rows) / RADAR_RECENCY_BANDS.length;
      laidOut.push({
        point,
        sourceIndex,
        sectorIndex: sector,
        bandIndex: band,
        angleFraction,
        radiusFraction,
      });
    });
  }

  return laidOut.sort(
    (a, b) =>
      a.sectorIndex - b.sectorIndex ||
      a.bandIndex - b.bandIndex ||
      a.angleFraction - b.angleFraction ||
      a.radiusFraction - b.radiusFraction,
  );
}

export function radarRecencyCounts(points: RadarDisplayPoint[]): Record<RadarRecencyBandId, number> {
  const counts = Object.fromEntries(RADAR_RECENCY_BANDS.map((band) => [band.id, 0])) as Record<
    RadarRecencyBandId,
    number
  >;
  for (const point of points) counts[point.recencyBand] += 1;
  return counts;
}
