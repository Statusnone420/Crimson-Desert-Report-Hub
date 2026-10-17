import { z } from "zod";

const milliseconds = z.number().int().min(0).max(60_000);
const dollars = z.number().finite().nonnegative();
export const aiTestAttemptSchema = z.object({
  outcome: z.enum(["passed", "task_checks_failed", "invalid_response", "cost_unverified", "cost_exceeded", "timeout", "validation_timeout", "authentication", "rate_limit", "provider_failure", "no_matching_endpoint", "not_sent"]),
  costState: z.enum(["verified", "unknown", "not_sent"]), costUsd: dollars.nullable(), reservedUsd: dollars,
  timings: z.object({ headersAfterMs: milliseconds.nullable(), bodyAfterMs: milliseconds.nullable(), validationMs: milliseconds.nullable(), totalMs: milliseconds,
    httpStatus: z.number().int().min(100).max(599).nullable() }),
});
export const aiTestTimingsSchema = z.object({
  preflightMs: milliseconds, metadataMs: milliseconds, reservationMs: milliseconds,
  requestsMs: milliseconds, settlementMs: milliseconds, receiptStartedAfterMs: milliseconds,
  settlement: z.enum(["acknowledged", "unconfirmed"]),
});
export type AiTestAttempt = z.infer<typeof aiTestAttemptSchema>;
export type AiTestTimings = z.infer<typeof aiTestTimingsSchema>;

// Strip unknown properties at the private read boundary; old receipts stay old.
export function sanitizedTestDiagnostics(value: unknown) {
  const parsed = aiTestAttemptSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
export function sanitizedTestTimings(value: unknown) {
  const parsed = aiTestTimingsSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
