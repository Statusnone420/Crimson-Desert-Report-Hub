import { isColumnProvider, isWriterModel } from "@/lib/editorials/models";
import {
  CADENCE_MODES,
  columnBurstSchema,
  MAX_HOLD_HOURS,
  MAX_MIN_GAP_HOURS,
  RELEVANCE_LEVELS,
  WEEKDAYS,
  type CadenceMode,
  type ColumnBurst,
  type ColumnSettings,
  type RelevanceLevel,
  type Weekday,
} from "@/lib/editorials/settings";

export type FormResult<T> = { ok: true; value: T } | { ok: false; error: "invalid_value" | "days_mismatch" };

const DAYS_PER_MODE: Record<CadenceMode, number> = { weekly: 1, "2x": 2, "3x": 3 };

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function integer(value: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return parsed >= min && parsed <= max ? parsed : null;
}

function oneOf<T extends string>(value: string, allowed: readonly T[]): T | null {
  return (allowed as readonly string[]).includes(value) ? value as T : null;
}

/**
 * The form value for "keep what's stored". The card offers it only for a stored provider
 * or model the allowlist no longer knows, so saving other fields never swaps that value
 * for one that runs: the slot keeps skipping until the editor picks a new one.
 */
export const KEEP_STORED = "keep";

/** The cadence dials. Model fields accept only the writer allowlist, "not set" or "keep". */
export function cadenceFromForm(formData: FormData): FormResult<Partial<ColumnSettings>> {
  const mode = oneOf(text(formData, "mode"), CADENCE_MODES);
  const days = WEEKDAYS.filter((day) => formData.getAll("days").includes(day)) as Weekday[];
  const hourUtc = integer(text(formData, "hourUtc"), 0, 23);
  const holdHours = integer(text(formData, "holdHours"), 0, MAX_HOLD_HOURS);
  const relevance = oneOf<RelevanceLevel>(text(formData, "relevance"), RELEVANCE_LEVELS);
  const minGapHours = integer(text(formData, "minGapHours"), 0, MAX_MIN_GAP_HOURS);
  const defaultWriter = text(formData, "defaultWriterModel");
  const nextEdition = text(formData, "nextEditionModel");
  const cap = text(formData, "monthlyCapUsd");
  const capValue = cap === "" ? null : Number(cap);
  const provider = text(formData, "provider");
  const keep = (value: string) => value === KEEP_STORED;
  const model = (value: string) => !value || keep(value) || isWriterModel(value);
  if (!mode || hourUtc === null || holdHours === null || !relevance || minGapHours === null || !(keep(provider) || isColumnProvider(provider))) return { ok: false, error: "invalid_value" };
  if (!model(defaultWriter) || !model(nextEdition)) return { ok: false, error: "invalid_value" };
  if (capValue !== null && !(Number.isFinite(capValue) && capValue >= 0 && capValue <= 50)) return { ok: false, error: "invalid_value" };
  if (days.length !== DAYS_PER_MODE[mode]) return { ok: false, error: "days_mismatch" };
  return {
    ok: true,
    value: {
      mode, days, hourUtc, holdHours, relevance, minGapHours,
      // A kept field is left out, so the merge leaves the stored value as it is.
      ...(isColumnProvider(provider) ? { provider } : {}),
      ...(keep(defaultWriter) ? {} : { defaultWriterModel: defaultWriter || null }),
      ...(keep(nextEdition) ? {} : { nextEditionModel: nextEdition || null }),
      monthlyCapUsd: capValue,
    },
  };
}

function burstId(label: string): string {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 28) || "burst";
  return `${base}-${crypto.randomUUID().slice(0, 6)}`;
}

/**
 * One burst from its form. A new burst gets an id; an edit keeps its own, and "keep"
 * keeps the edited burst's stored model, even one off the allowlist.
 */
export function burstFromForm(formData: FormData, stored: readonly ColumnBurst[] = []): FormResult<ColumnBurst> {
  const id = text(formData, "id");
  const requested = text(formData, "model");
  const model = requested === KEEP_STORED ? stored.find((burst) => burst.id === id)?.model : requested;
  const relevance = text(formData, "relevance");
  if (!model || (requested !== KEEP_STORED && !isWriterModel(model)) || (relevance && !oneOf(relevance, RELEVANCE_LEVELS))) return { ok: false, error: "invalid_value" };
  const label = text(formData, "label");
  const parsed = columnBurstSchema.safeParse({
    id: id || burstId(label),
    label,
    enabled: formData.get("enabled") === "on",
    startDate: text(formData, "startDate"),
    endDate: text(formData, "endDate"),
    cadence: "daily",
    hourUtc: integer(text(formData, "hourUtc"), 0, 23),
    model,
    holdHours: integer(text(formData, "holdHours"), 0, MAX_HOLD_HOURS),
    ...(relevance ? { relevance } : {}),
  });
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: "invalid_value" };
}
