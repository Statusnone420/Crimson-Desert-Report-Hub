import type { OperatorRunSummary } from "@/components/newspaper/OperatorOverview";
import { summarizeRunMessages } from "@/lib/automation/runDisplay";

export function safeRunSummary(run: {
  started_at: string;
  finished_at: string | null;
  status: string;
  skips: string[];
}): OperatorRunSummary {
  const status =
    run.status === "success" ||
    run.status === "partial" ||
    run.status === "failed" ||
    run.status === "skipped" ||
    run.status === "running"
      ? run.status
      : "other";
  return {
    startedAt: run.started_at,
    finishedAt: run.finished_at,
    status,
    // Do not send the raw error array to the client. Skip codes are reduced to
    // the existing operator-safe plain-language summary on the server.
    skipSummary: summarizeRunMessages(run.skips, []).operatorSummary,
  };
}
