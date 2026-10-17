import { z } from "zod";
import { CATEGORIES, FREQUENCIES, PLATFORMS, SEVERITIES } from "@/lib/constants";

/** Empty string becomes null, otherwise trimmed string capped at max. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : null));

// http(s) only: a bare .url() also accepts javascript:/data: schemes, which
// would become clickable links in the admin review queue.
const optionalUrl = z
  .union([
    z
      .string()
      .trim()
      .url()
      .max(500)
      .refine((value) => /^https?:\/\//i.test(value), "Evidence link must start with http:// or https://"),
    z.literal(""),
  ])
  .optional()
  .transform((value) => (value ? value : null));

export const reportSchema = z.object({
  patch_version: z.string().trim().min(1).max(20),
  platform: z.enum(PLATFORMS),
  category: z.enum(CATEGORIES),
  severity: z.enum(SEVERITIES),
  frequency: z.enum(FREQUENCIES),
  issue_title: z.string().trim().min(5).max(120),
  description: z.string().trim().min(20).max(4000),
  repro_steps: optionalText(2000),
  expected_behavior: optionalText(1000),
  actual_behavior: optionalText(1000),
  location_quest: optionalText(200),
  hardware_specs: optionalText(500),
  graphics_mode: optionalText(200),
  driver_os: optionalText(200),
  troubleshooting_tried: optionalText(1000),
  pers_id: optionalText(50),
  official_report_submitted: z.coerce.boolean().default(false),
  evidence_url: optionalUrl,
  turnstile_token: z.string().optional(),
});

export type ReportInput = z.infer<typeof reportSchema>;
