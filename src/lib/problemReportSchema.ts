import { z } from "zod";
import { PROBLEM_REPORT_TYPES, PROBLEM_REPORT_STATUSES, PROBLEM_REPORT_MAX_LENGTH } from "@/lib/problemReports";

/** Allow a useful source link; refuse link-only messages and link dumps. */
export function isProblemLinkSpam(message: string): boolean {
  const links = /(?:https?:\/\/|www\.)[^\s<>]+|\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<>]*)?/gi;
  const matches = message.match(links) ?? [];
  const prose = message.replace(links, "").replace(/[^\p{L}\p{N}]/gu, "");
  return matches.length > 2 || (matches.length > 0 && prose.length < 3);
}

export const problemReportSchema = z.object({
  type: z.enum(PROBLEM_REPORT_TYPES),
  description: z.string().trim().min(1).max(PROBLEM_REPORT_MAX_LENGTH)
    .refine((value) => /[\p{L}\p{N}]/u.test(value) && !isProblemLinkSpam(value)),
  page_url: z.url().max(2048),
  email: z.union([z.email().max(254), z.literal("")]).optional().transform((value) => value || null),
  turnstile_token: z.string().min(1).max(2048),
}).strict().refine((value) => value.type !== "remove_content" || Boolean(value.email), { path: ["email"] });

export const problemReportUpdateSchema = z.object({
  revision: z.number().int().nonnegative(),
  status: z.enum(PROBLEM_REPORT_STATUSES).optional(),
  note: z.string().trim().min(1).max(PROBLEM_REPORT_MAX_LENGTH).optional(),
}).strict().refine((value) => value.status !== undefined || value.note !== undefined);
