export type BudgetInput = {
  monthlyBudgetUsd: number;
  spentMonthToDateUsd: number;
  now: Date;
};

export type AutomationBudget = {
  monthlyBudgetUsd: number;
  remainingMonthUsd: number;
  remainingRuns: number;
  estimatedRunAllowanceUsd: number;
  allowPaidSearch: boolean;
  maxSearchQueries: number;
  maxSearchResults: number;
  maxLlmCalls: number;
  skipReasons: string[];
};

const RUN_INTERVAL_HOURS = 6;
const SEARCH_QUERY_COST_USD = 0.008;

export function countRemainingRunsThisMonth(now: Date): number {
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0);
  const remainingMs = Math.max(0, end - now.getTime());
  return Math.max(1, Math.ceil(remainingMs / (RUN_INTERVAL_HOURS * 60 * 60 * 1000)));
}

export function rejectPaidOpenRouterModel(model: string): string {
  if (!model.endsWith(":free")) throw new Error("OpenRouter automation model must end with :free");
  return model;
}

export function computeAutomationBudget(input: BudgetInput): AutomationBudget {
  const monthlyBudgetUsd = Math.max(0, input.monthlyBudgetUsd);
  const remainingMonthUsd = Math.max(0, monthlyBudgetUsd - Math.max(0, input.spentMonthToDateUsd));
  const remainingRuns = countRemainingRunsThisMonth(input.now);
  const estimatedRunAllowanceUsd = remainingMonthUsd / remainingRuns;
  const skipReasons: string[] = [];

  if (monthlyBudgetUsd === 0) skipReasons.push("budget_zero");
  if (monthlyBudgetUsd > 0 && remainingMonthUsd <= 0) skipReasons.push("budget_capped");

  const allowPaidSearch = estimatedRunAllowanceUsd >= SEARCH_QUERY_COST_USD && skipReasons.length === 0;
  const queryBudget = allowPaidSearch ? Math.floor(estimatedRunAllowanceUsd / SEARCH_QUERY_COST_USD) : 0;
  const maxSearchQueries = Math.max(0, Math.min(5, queryBudget));

  return {
    monthlyBudgetUsd,
    remainingMonthUsd,
    remainingRuns,
    estimatedRunAllowanceUsd,
    allowPaidSearch,
    maxSearchQueries,
    maxSearchResults: maxSearchQueries * 5,
    maxLlmCalls: allowPaidSearch ? Math.min(20, maxSearchQueries * 4) : 0,
    skipReasons,
  };
}
