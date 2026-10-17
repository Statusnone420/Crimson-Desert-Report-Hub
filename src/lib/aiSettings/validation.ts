import { z } from "zod";

const nullablePositive = z.number().finite().positive().nullable();
export const metadataSchema = z.object({
  provider: z.literal("openrouter"), id: z.string().min(1).max(200), name: z.string().min(1).max(200),
  contextWindow: nullablePositive, maxOutputTokens: nullablePositive,
  inputModalities: z.array(z.string().max(40)).max(12), outputModalities: z.array(z.string().max(40)).max(12),
  supportedParameters: z.array(z.string().max(80)).max(100).nullable(),
  reasoning: z.boolean().nullable(), reasoningEfforts: z.array(z.string().max(30)).max(12).nullable(), reasoningRequired: z.boolean().nullable(),
  structuredOutput: z.boolean().nullable(), inputUsdPerMillion: z.number().finite().min(0).max(10000).nullable(),
  outputUsdPerMillion: z.number().finite().min(0).max(10000).nullable(),
  pricingSource: z.enum(["provider", "owner", "unknown"]), pricingSupported: z.boolean(),
  pricingIssue: z.enum(["unknown_pricing", "additional_charges", "tiered_pricing"]).nullable(), fetchedAt: z.iso.datetime(),
  endpoint: z.object({ tag: z.string().min(1).max(200).regex(/^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/),
    name: z.string().min(1).max(200), maxPromptTokens: nullablePositive }).strict().optional(),
}).strict();
export const profileSchema = z.object({
  provider: z.literal("openrouter"), modelId: z.string().min(1).max(200).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/@+~-]*$/),
  reasoning: z.enum(["default", "none", "low", "medium", "high"]), retention: z.enum(["standard", "zdr"]),
  maxOutputTokens: z.number().int().min(256).max(8192), connectionVersion: z.number().int().min(0), metadata: metadataSchema,
}).strict().refine((p) => p.metadata.id === p.modelId && p.metadata.provider === p.provider && p.metadata.pricingSource === "provider", "profile_metadata_mismatch");
export const policySchema = z.object({ monthlyUsd: z.number().finite().min(0).max(1000), requestUsd: z.number().finite().min(0.000001).max(1), recovery: z.enum(["next_scan", "backup"]) }).strict();
export const configurationSchema = z.object({ revision: z.number().int().nonnegative(), active: profileSchema.nullable(), previous: profileSchema.nullable(), backup: profileSchema.nullable(), policy: policySchema }).strict();
