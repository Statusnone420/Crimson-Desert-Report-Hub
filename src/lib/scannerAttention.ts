import type { ScannerAiHealth } from "@/lib/automation/health";
import type { CollectionHealth, CollectionHealthLane } from "@/lib/collectionHealth";
import type { ScannerReadRegister } from "@/lib/scannerRegisters";

export type ScannerAttentionItem = {
  id: string;
  label: string;
  detail: string;
};

export type ScannerAttention = {
  /** Null means a required health read is unavailable, never an empty queue. */
  count: number | null;
  items: ScannerAttentionItem[];
};

export type ScannerAttentionInput = {
  /** Omitted when the AI health/history read did not complete. */
  aiHealth?: ScannerAiHealth;
  /** The OpenRouter cost-safety circuit. Null means its state could not be read. */
  llmPaused: boolean | null;
  /** The seven-day failed-run aggregate. Null means the radar health read failed. */
  failedRuns: number | null;
  radarAvailable: boolean;
  /** Public scanner registers whose values are placeholders because their reads failed. */
  scannerReadFailures?: readonly ScannerReadRegister[];
  collection: CollectionHealth;
};

function collectionItem(lane: CollectionHealthLane): ScannerAttentionItem {
  return {
    id: `collection-${lane.key}`,
    label: `${lane.label}: ${lane.labelText}`,
    detail: lane.nextAction ?? lane.detail,
  };
}

const COST_CIRCUIT_HEALTH_CODES = new Set([
  "openrouter_circuit_open",
  "openrouter_cost_unverified",
  "openrouter_unexpected_charge",
  "openrouter_budget_exceeded",
]);

const UNREAD_REGISTER_ITEMS: Record<ScannerReadRegister, ScannerAttentionItem> = {
  week: {
    id: "scanner-week-unavailable",
    label: "Scanner weekly totals unavailable",
    detail: "The seven-day screening, filtered, and retained totals could not be read.",
  },
  heartbeat: {
    id: "scanner-heartbeat-unavailable",
    label: "Scanner heartbeat unavailable",
    detail: "The latest completed scanner run could not be read.",
  },
  awaiting: {
    id: "scanner-awaiting-unavailable",
    label: "Awaiting issue-group total unavailable",
    detail: "The current-patch private-lead total could not be read.",
  },
  published: {
    id: "scanner-published-unavailable",
    label: "Published issue total unavailable",
    detail: "The published issue-card total could not be read.",
  },
};

function sameKnownCostGuard(aiHealth: ScannerAiHealth | undefined): boolean {
  return aiHealth?.code !== null && aiHealth?.code !== undefined && COST_CIRCUIT_HEALTH_CODES.has(aiHealth.code);
}

/**
 * Turns the health reads into named operator checks. It deliberately counts
 * checks, not the number of failed runs or retained records. A blocked AI route
 * and the corresponding known-open safety circuit describe the same AI issue.
 */
export function getScannerAttention(input: ScannerAttentionInput): ScannerAttention {
  const items: ScannerAttentionItem[] = [];
  const unreadRegisters = new Set(input.scannerReadFailures ?? []);
  let unknown = !input.radarAvailable || input.failedRuns === null || input.llmPaused === null || input.aiHealth === undefined || input.collection.status === "unknown" || unreadRegisters.size > 0;

  if (!input.radarAvailable || input.failedRuns === null) {
    items.push({
      id: "scanner-health-unavailable",
      label: "Scanner health unavailable",
      detail: "The run-health read did not complete, so failed-run status is unknown.",
    });
  } else if (input.failedRuns > 0) {
    items.push({
      id: "failed-runs",
      label: `${input.failedRuns} failed run${input.failedRuns === 1 ? "" : "s"} in 7 days`,
      detail: "Open scan history to inspect the recorded failure details.",
    });
  }

  for (const register of unreadRegisters) {
    items.push(UNREAD_REGISTER_ITEMS[register]);
  }

  if (!input.aiHealth) {
    items.push({
      id: "ai-processing",
      label: "AI processing health unavailable",
      detail: "The AI health record could not be read, so this page cannot verify the latest AI outcome.",
    });
  } else if (input.aiHealth.state === "unavailable" || input.aiHealth.state === "limited") {
    items.push({
      id: "ai-processing",
      label: input.aiHealth.state === "unavailable" ? "AI processing unavailable" : "AI processing limited",
      detail: input.aiHealth.message,
    });
  }

  if (input.llmPaused === null) {
    items.push({
      id: "ai-cost-safety-unavailable",
      label: "AI cost-safety state unavailable",
      detail: "The cost-safety circuit could not be read, so AI processing remains unavailable until it can be verified.",
    });
  } else if (input.llmPaused && !sameKnownCostGuard(input.aiHealth)) {
    items.push({
      id: "ai-cost-safety-paused",
      label: "AI cost safety paused",
      detail: "The known OpenRouter cost-safety circuit is open.",
    });
  }

  for (const lane of input.collection.lanes) {
    if (lane.needsAttention || lane.state === "unknown") {
      items.push(collectionItem(lane));
      if (lane.state === "unknown") unknown = true;
    }
  }

  return { count: unknown ? null : items.length, items };
}
