import { z } from "zod";
import { DEFAULT_WRITER_MODEL } from "@/lib/editorials/models";

export const COLUMN_SETTINGS_KEY = "column";
export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export const CADENCE_MODES = ["weekly", "2x", "3x"] as const;
export const RELEVANCE_LEVELS = ["always", "normal", "strict"] as const;
export const MAX_HOLD_HOURS = 168;
export const MAX_MIN_GAP_HOURS = 168;
export const MAX_BURSTS = 10;
export const APPROVE_FIRST_EDITIONS = 3;

export type Weekday = (typeof WEEKDAYS)[number];
export type CadenceMode = (typeof CADENCE_MODES)[number];
export type RelevanceLevel = (typeof RELEVANCE_LEVELS)[number];

export type ColumnBurst = {
  id: string;
  label: string;
  enabled: boolean;
  startDate: string;
  endDate: string;
  cadence: "daily";
  hourUtc: number;
  /** Kept as stored; an unknown model skips with model_not_allowed instead of silently changing. */
  model: string;
  holdHours: number;
  relevance?: RelevanceLevel;
};

export type ColumnSettings = {
  paused: boolean;
  mode: CadenceMode;
  days: Weekday[];
  hourUtc: number;
  holdHours: number;
  relevance: RelevanceLevel;
  minGapHours: number;
  defaultWriterModel: string;
  nextEditionModel: string | null;
  monthlyCapUsd: number | null;
  provider: string;
  approveFirstRemaining: number;
  bursts: ColumnBurst[];
};

export const DEFAULT_DAYS: Record<CadenceMode, Weekday[]> = {
  weekly: ["mon"],
  "2x": ["mon", "thu"],
  "3x": ["mon", "wed", "fri"],
};

const DAYS_PER_MODE: Record<CadenceMode, number> = { weekly: 1, "2x": 2, "3x": 3 };

export const EXPANSION_LAUNCH_BURST: ColumnBurst = {
  id: "expansion-launch",
  label: "Expansion launch",
  enabled: false,
  startDate: "2026-10-29",
  endDate: "2026-11-04",
  cadence: "daily",
  hourUtc: 14,
  model: "claude-opus-5-5",
  holdHours: 8,
  relevance: "always",
};

export const DEFAULT_COLUMN_SETTINGS: ColumnSettings = {
  paused: false,
  mode: "weekly",
  days: DEFAULT_DAYS.weekly,
  hourUtc: 14,
  holdHours: 24,
  relevance: "normal",
  minGapHours: 20,
  defaultWriterModel: DEFAULT_WRITER_MODEL,
  nextEditionModel: null,
  monthlyCapUsd: null,
  provider: "anthropic",
  approveFirstRemaining: APPROVE_FIRST_EDITIONS,
  bursts: [EXPANSION_LAUNCH_BURST],
};

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
});
const hourUtc = z.number().int().min(0).max(23);
const holdHours = z.number().int().min(0).max(MAX_HOLD_HOURS);
const modelName = z.string().trim().min(1).max(80);

export const columnBurstSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/),
  label: z.string().trim().min(1).max(60),
  enabled: z.boolean(),
  startDate: isoDate,
  endDate: isoDate,
  cadence: z.literal("daily"),
  hourUtc,
  model: modelName,
  holdHours,
  relevance: z.enum(RELEVANCE_LEVELS).optional(),
}).refine((burst) => burst.startDate <= burst.endDate, { message: "A burst ends on or after its start date." });

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function field<T>(schema: z.ZodType<T>, value: unknown, fallback: T): T {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : fallback;
}

/** Missing means unpaused; any value that is neither true nor false fails safe as paused. */
function pausedValue(value: unknown): boolean {
  if (value === undefined || value === false || value === "false") return false;
  return true;
}

function daysFor(mode: CadenceMode, value: unknown): Weekday[] {
  const parsed = z.array(z.enum(WEEKDAYS)).safeParse(value);
  if (!parsed.success) return DEFAULT_DAYS[mode];
  const unique = WEEKDAYS.filter((day) => parsed.data.includes(day));
  return unique.length === DAYS_PER_MODE[mode] ? unique : DEFAULT_DAYS[mode];
}

function bursts(value: unknown): ColumnBurst[] {
  if (value === undefined) return DEFAULT_COLUMN_SETTINGS.bursts;
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const valid: ColumnBurst[] = [];
  for (const item of value.slice(0, MAX_BURSTS)) {
    const parsed = columnBurstSchema.safeParse(item);
    if (!parsed.success || seen.has(parsed.data.id)) continue;
    seen.add(parsed.data.id);
    valid.push(parsed.data);
  }
  return valid;
}

/**
 * The stored 'column' value with safe defaults for anything missing or invalid. Each
 * field is checked alone, so one bad value never resets the rest. Model names stay as
 * stored: the model precedence check skips an unknown one rather than swapping it.
 */
export function normalizeColumnSettings(value: unknown): ColumnSettings {
  const settings = record(value);
  const mode = field(z.enum(CADENCE_MODES), settings.mode, DEFAULT_COLUMN_SETTINGS.mode);
  return {
    paused: pausedValue(settings.paused),
    mode,
    days: daysFor(mode, settings.days),
    hourUtc: field(hourUtc, settings.hourUtc, DEFAULT_COLUMN_SETTINGS.hourUtc),
    holdHours: field(holdHours, settings.holdHours, DEFAULT_COLUMN_SETTINGS.holdHours),
    relevance: field(z.enum(RELEVANCE_LEVELS), settings.relevance, DEFAULT_COLUMN_SETTINGS.relevance),
    minGapHours: field(z.number().int().min(0).max(MAX_MIN_GAP_HOURS), settings.minGapHours, DEFAULT_COLUMN_SETTINGS.minGapHours),
    defaultWriterModel: field(modelName, settings.defaultWriterModel, DEFAULT_COLUMN_SETTINGS.defaultWriterModel),
    nextEditionModel: field(modelName.nullable(), settings.nextEditionModel, null),
    monthlyCapUsd: field(z.number().min(0).max(50).nullable(), settings.monthlyCapUsd, null),
    provider: field(z.string().trim().min(1).max(40), settings.provider, DEFAULT_COLUMN_SETTINGS.provider),
    approveFirstRemaining: field(z.number().int().min(0).max(APPROVE_FIRST_EDITIONS), settings.approveFirstRemaining, APPROVE_FIRST_EDITIONS),
    bursts: bursts(settings.bursts),
  };
}
