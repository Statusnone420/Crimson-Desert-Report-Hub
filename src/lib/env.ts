type EnvLike = Record<string, string | undefined>;

export type Features = {
  turnstile: boolean;
  reddit: boolean;
  ai: boolean;
  xSearch: boolean;
  webSearch: boolean;
  automation: boolean;
};

function hasEnvValue(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

export function computeFeatures(env: EnvLike): Features {
  const reddit =
    hasEnvValue(env.REDDIT_CLIENT_ID) &&
    hasEnvValue(env.REDDIT_CLIENT_SECRET) &&
    hasEnvValue(env.REDDIT_USER_AGENT);
  const webSearch = hasEnvValue(env.TAVILY_API_KEY);

  return {
    turnstile: hasEnvValue(env.NEXT_PUBLIC_TURNSTILE_SITE_KEY) && hasEnvValue(env.TURNSTILE_SECRET_KEY),
    reddit,
    ai: hasEnvValue(env.GROQ_API_KEY) || hasEnvValue(env.OPENROUTER_API_KEY),
    xSearch: hasEnvValue(env.XAI_API_KEY),
    webSearch,
    automation: reddit || webSearch,
  };
}

export function automationBudgetUsd(env: EnvLike = process.env): number {
  const raw = env.AUTOMATION_BUDGET_USD_MONTHLY?.trim() ?? "5";
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return 5;
  return Math.min(parsed, 50);
}

export function automationSubreddits(env: EnvLike = process.env): string[] {
  return (env.AUTOMATION_SUBREDDITS ?? "CrimsonDesert")
    .split(",")
    .map((subreddit) => subreddit.trim().replace(/^r\//i, ""))
    .filter(Boolean)
    .slice(0, 5);
}

export function features(): Features {
  return computeFeatures(process.env);
}

export function requiredEnv(
  name: "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY" | "ADMIN_PASSWORD" | "SESSION_SECRET",
): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}
