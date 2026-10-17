"use client";

import { ScannerScheduleSettings } from "./ScannerScheduleSettings";

import { useCallback, useMemo, useRef, useState } from "react";
import type { AiDashboard, AiPolicy } from "@/lib/aiSettings/types";
import { AiSettings, type AiSettingsTransport, type SetupInput } from "./AiSettings";
import { createPreviewDashboard, makePreviewProfile, makePreviewTest, PREVIEW_MODELS } from "./previewData";

type Command = { action?: string; [key: string]: unknown };

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function AiSettingsPreview() {
  const [dashboard, setDashboard] = useState<AiDashboard>(createPreviewDashboard);
  const dashboardRef = useRef(dashboard);
  const commit = useCallback((next: AiDashboard) => {
    dashboardRef.current = next;
    setDashboard(next);
    return next;
  }, []);
  const addActivity = useCallback((current: AiDashboard, action: string, detail: string): AiDashboard => ({
    ...current,
    activity: [{ id: `sample-${current.activity.length + 1}`, createdAt: "2026-01-01T00:00:00.000Z", action, detail }, ...current.activity],
  }), []);
  const command = useCallback(async <T,>(value: unknown): Promise<T> => {
    const request = asRecord(value) as Command;
    const current = dashboardRef.current;
    if (request.action === "catalog") return { models: PREVIEW_MODELS } as T;

    if (request.action === "inspect") {
      const input = asRecord(request.input) as unknown as SetupInput;
      const metadata = PREVIEW_MODELS.find((model) => model.id === input.modelId.trim());
      if (!metadata) throw new Error("That model ID is not in the sample catalogue. Choose a sample model to continue.");
      const compatible = input.endpointTag === metadata.endpoint?.tag;
      return { metadata: compatible ? metadata : { ...metadata, endpoint: undefined }, endpoints: metadata.endpoint ? [metadata.endpoint] : [], compatible, testCeilingUsd: compatible ? 0.01 : null, quote: compatible ? "sample-quote" : null } as T;
    }

    if (request.action === "test") {
      const input = asRecord(request.input) as unknown as SetupInput;
      const metadata = PREVIEW_MODELS.find((model) => model.id === input.modelId.trim());
      if (!metadata || input.endpointTag !== metadata.endpoint?.tag) throw new Error("Select and inspect a sample provider before testing it.");
      const model = { ...makePreviewProfile(metadata, input.reasoning), retention: input.retention, maxOutputTokens: input.maxOutputTokens };
      const rawOutcome = request.previewOutcome;
      const outcome = rawOutcome === "timeout" || rawOutcome === "invalid" ? rawOutcome : "success";
      await new Promise((resolve) => setTimeout(resolve, 300));
      const test = makePreviewTest(typeof request.id === "string" ? request.id : `sample-test-${current.tests.length + 1}`, model, outcome);
      const withTest = { ...current, tests: [test, ...current.tests] };
      commit(addActivity(withTest, "sample_test", `${metadata.name} · ${outcome === "success" ? "6 of 6 sample cases passed" : outcome === "timeout" ? "sample timeout; charge unknown" : "sample response invalid"}. No provider was called.`));
      return { test } as T;
    }

    if (request.action === "connection") throw new Error("Key entry and connection changes are disabled in the design preview.");

    if (request.action === "policy") {
      const policy = asRecord(request.policy) as unknown as AiPolicy;
      if (!Number.isFinite(policy.monthlyUsd) || policy.monthlyUsd < 0 || policy.monthlyUsd > 1_000 || !Number.isFinite(policy.requestUsd) || policy.requestUsd < 0.000001 || policy.requestUsd > 1 || (policy.recovery !== "backup" && policy.recovery !== "next_scan")) {
        throw new Error("Enter valid sample spending and recovery settings.");
      }
      if (policy.recovery === "backup" && !current.configuration.backup) throw new Error("Choose and test a sample backup before enabling backup recovery.");
      const next = { ...current, configuration: { ...current.configuration, revision: current.configuration.revision + 1, policy: { ...policy } } };
      return commit(addActivity(next, "sample_policy", `$${policy.monthlyUsd.toFixed(2)} sample monthly allowance · ${policy.recovery === "backup" ? "sample backup recovery" : "wait for next scan"}.`)) as T;
    }

    if (request.action === "activate") {
      const test = current.tests.find((item) => item.id === request.testId);
      if (!test?.passed || test.costState !== "verified") throw new Error("A passed sample test is required before activation.");
      if (request.role !== "primary" && request.role !== "backup") throw new Error("Choose primary or backup for this sample model.");
      const config = current.configuration;
      const nextConfig = request.role === "primary"
        ? { ...config, revision: config.revision + 1, previous: config.active, active: test.profile }
        : { ...config, revision: config.revision + 1, backup: test.profile };
      const next = { ...current, configuration: nextConfig };
      const label = request.role === "primary" ? "sample_primary_activated" : "sample_backup_activated";
      return commit(addActivity(next, label, `${test.profile.metadata.name} · ${test.profile.reasoning} reasoning. Preview only.`)) as T;
    }

    if (request.action === "rollback") {
      const previous = current.configuration.previous;
      if (!previous) throw new Error("There is no sample model to restore yet.");
      const next = { ...current, configuration: { ...current.configuration, revision: current.configuration.revision + 1, active: previous, previous: null } };
      return commit(addActivity(next, "sample_rollback", `${previous.metadata.name} restored in this preview.`)) as T;
    }

    throw new Error("This action is not available in the design preview.");
  }, [addActivity, commit]);
  const transport = useMemo<AiSettingsTransport>(() => ({
    read: async () => dashboardRef.current,
    command,
  }), [command]);

  return <AiSettings initial={dashboard} transport={transport} preview scannerSettings={
    <ScannerScheduleSettings preview control={{ paused: false, minIntervalMinutes: 120, scheduledSearchCreditsPerRun: 3,
      monthlyTavilyCreditCap: 1000, monthlyLlmUsdCap: 1, modelPreset: "gpt_5_6_luna", updatedAt: null }}
      tavilyUsage={{ state: "available", used: 62, pace: 531 }} />
  } />;
}
