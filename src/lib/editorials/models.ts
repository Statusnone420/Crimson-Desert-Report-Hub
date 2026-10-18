/** The only models the column may call. Any other value skips with model_not_allowed; nothing falls back. */
export const WRITER_MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5-1"] as const;
export const CHECKER_MODELS = ["claude-haiku-5-5"] as const;
export const DEFAULT_WRITER_MODEL = "claude-opus-5-5";
export const DEFAULT_CHECKER_MODEL = "claude-haiku-5-5";

export type WriterModel = (typeof WRITER_MODELS)[number];
export type CheckerModel = (typeof CHECKER_MODELS)[number];
export type ColumnModel = WriterModel | CheckerModel;

export const WRITER_EFFORTS = ["low", "medium", "high"] as const;
export type WriterEffort = (typeof WRITER_EFFORTS)[number];

/** "anthropic" spends the owner's API credit; "openrouter" uses the column's own OpenRouter key. */
export const COLUMN_PROVIDERS = ["anthropic", "openrouter"] as const;
export type ColumnProvider = (typeof COLUMN_PROVIDERS)[number];

export const WRITER_MODEL_LABELS: Record<WriterModel, string> = {
  "claude-opus-5-5": "Opus 5.5",
  "claude-sonnet-5-5": "Sonnet 5.5",
  "claude-fable-5-1": "Fable 5.1",
};

export function isWriterModel(value: unknown): value is WriterModel {
  return typeof value === "string" && (WRITER_MODELS as readonly string[]).includes(value);
}

export function isCheckerModel(value: unknown): value is CheckerModel {
  return typeof value === "string" && (CHECKER_MODELS as readonly string[]).includes(value);
}

export function isWriterEffort(value: unknown): value is WriterEffort {
  return typeof value === "string" && (WRITER_EFFORTS as readonly string[]).includes(value);
}

export function isColumnProvider(value: unknown): value is ColumnProvider {
  return typeof value === "string" && (COLUMN_PROVIDERS as readonly string[]).includes(value);
}
