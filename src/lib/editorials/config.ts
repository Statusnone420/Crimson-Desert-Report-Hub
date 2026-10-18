import {
  DEFAULT_CHECKER_MODEL,
  DEFAULT_WRITER_MODEL,
  isCheckerModel,
  isColumnProvider,
  isWriterEffort,
  isWriterModel,
  type CheckerModel,
  type ColumnProvider,
  type WriterEffort,
  type WriterModel,
} from "@/lib/editorials/models";

function envValue(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed !== "\"\"" && trimmed !== "''" ? trimmed : null;
}

/** COLUMN_WRITER_EFFORT: low, medium or high. Anything else is the default, high. */
export function writerEffort(env: NodeJS.ProcessEnv = process.env): WriterEffort {
  const value = envValue(env.COLUMN_WRITER_EFFORT);
  return isWriterEffort(value) ? value : "high";
}

export const CHECKER_EFFORT: WriterEffort = "high";
export const WRITER_MAX_TOKENS = 8000;
export const CHECKER_MAX_TOKENS = 4000;

export type ModelChoice<T extends string> = { ok: true; model: T } | { ok: false; requested: string };

/**
 * Writer precedence: the one-shot override, then the active burst's model, then the
 * default writer, then COLUMN_WRITER_MODEL, then Opus 5.5. The first value found must be
 * on the allowlist. A value off the list never falls through to the next one.
 */
export function resolveWriterModel(input: {
  nextEditionModel: string | null;
  burstModel: string | null;
  defaultWriterModel: string | null;
  env?: NodeJS.ProcessEnv;
}): ModelChoice<WriterModel> {
  const requested = input.nextEditionModel ?? input.burstModel ?? input.defaultWriterModel
    ?? envValue((input.env ?? process.env).COLUMN_WRITER_MODEL) ?? DEFAULT_WRITER_MODEL;
  return isWriterModel(requested) ? { ok: true, model: requested } : { ok: false, requested };
}

/** COLUMN_CHECKER_MODEL, else Haiku 5.5, the only checker on the allowlist. */
export function resolveCheckerModel(env: NodeJS.ProcessEnv = process.env): ModelChoice<CheckerModel> {
  const requested = envValue(env.COLUMN_CHECKER_MODEL) ?? DEFAULT_CHECKER_MODEL;
  return isCheckerModel(requested) ? { ok: true, model: requested } : { ok: false, requested };
}

/** The selected provider's key. The column never reads the scanner's OPENROUTER_API_KEY. */
export function providerKey(provider: ColumnProvider, env: NodeJS.ProcessEnv = process.env): string | null {
  return envValue(provider === "anthropic" ? env.ANTHROPIC_API_KEY : env.COLUMN_OPENROUTER_API_KEY);
}

export function resolveProvider(value: string): ColumnProvider | null {
  return isColumnProvider(value) ? value : null;
}
