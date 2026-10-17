import type { AiTestAttempt, AiTestTimings } from "./testDiagnostics";
/** Public admin shapes. Credentials and provider response bodies never belong here. */
export type AiProvider = "openrouter";
export type AiReasoning = "default" | "none" | "low" | "medium" | "high";
export type AiRetention = "standard" | "zdr";
export type AiMetadata = {
  provider: AiProvider;
  id: string;
  name: string;
  contextWindow: number | null;
  maxOutputTokens: number | null;
  inputModalities: string[];
  outputModalities: string[];
  supportedParameters: string[] | null;
  reasoning: boolean | null;
  reasoningEfforts: string[] | null;
  reasoningRequired: boolean | null;
  structuredOutput: boolean | null;
  inputUsdPerMillion: number | null;
  outputUsdPerMillion: number | null;
  pricingSource: "provider" | "owner" | "unknown";
  pricingSupported: boolean;
  pricingIssue: "unknown_pricing" | "additional_charges" | "tiered_pricing" | null;
  /** Absent on catalog summaries and profiles saved before endpoint selection. */
  endpoint?: { tag: string; name: string; maxPromptTokens: number | null };
  fetchedAt: string;
};
export type AiProfile = {
  provider: AiProvider;
  modelId: string;
  reasoning: AiReasoning;
  retention: AiRetention;
  maxOutputTokens: number;
  connectionVersion: number;
  metadata: AiMetadata;
};
export type AiPolicy = { monthlyUsd: number; requestUsd: number; recovery: "next_scan" | "backup" };
export type AiConfiguration = {
  revision: number;
  active: AiProfile | null;
  previous: AiProfile | null;
  backup: AiProfile | null;
  policy: AiPolicy;
};
export type AiTestCase = { name: string; passed: boolean; expected: string; detail: string; attempt?: AiTestAttempt };
export type AiTestResult = {
  id: string;
  profile: AiProfile;
  passed: boolean;
  cases: AiTestCase[];
  outcome: string;
  costUsd: number | null;
  reservedUsd: number;
  costState: "verified" | "estimated" | "unknown" | "not_sent";
  latencyMs: number;
  createdAt: string;
  timings?: AiTestTimings;
};
export type AiConnectionSummary = { provider: AiProvider; configured: boolean; source: "saved" | "environment" | "none"; version: number };
export type AiActivity = { id: string; createdAt: string; action: string; detail: string };
export type AiDashboard = {
  available: boolean;
  encryptionReady: boolean;
  configuration: AiConfiguration;
  connections: AiConnectionSummary[];
  spend: { committedUsd: number; uncertainUsd: number; estimatedUsd: number; blocked: boolean };
  tests: AiTestResult[];
  activity: AiActivity[];
};
export const DEFAULT_AI_POLICY: AiPolicy = { monthlyUsd: 1, requestUsd: 0.01, recovery: "next_scan" };
/** Scans accept a pinned provider price up to this multiple of the saved quote. */
export const AI_PRICE_HEADROOM = 4;
