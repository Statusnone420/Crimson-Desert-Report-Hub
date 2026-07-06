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

export type IntegrationStatus = {
  key: "reddit" | "web_search" | "ai_extraction";
  label: string;
  connected: boolean;
  missingEnv: string[];
  detail: string;
};

export function integrationStatuses(env: EnvLike = process.env): IntegrationStatus[] {
  const redditVars: Array<[string, string | undefined]> = [
    ["REDDIT_CLIENT_ID", env.REDDIT_CLIENT_ID],
    ["REDDIT_CLIENT_SECRET", env.REDDIT_CLIENT_SECRET],
    ["REDDIT_USER_AGENT", env.REDDIT_USER_AGENT],
  ];
  const redditMissing = redditVars.filter(([, value]) => !hasEnvValue(value)).map(([name]) => name);
  const redditConnected = redditMissing.length === 0;

  const webSearchConnected = hasEnvValue(env.TAVILY_API_KEY);

  const aiConnected = hasEnvValue(env.OPENROUTER_API_KEY) || hasEnvValue(env.GROQ_API_KEY);
  const aiMissing = aiConnected ? [] : ["OPENROUTER_API_KEY", "GROQ_API_KEY"];

  return [
    {
      key: "reddit",
      label: "Reddit API",
      connected: redditConnected,
      missingEnv: redditMissing,
      detail: redditConnected
        ? "Reading r/CrimsonDesert posts each run."
        : "Not connected — the scanner reads no Reddit posts and relies on web search only.",
    },
    {
      key: "web_search",
      label: "Web search (Tavily)",
      connected: webSearchConnected,
      missingEnv: webSearchConnected ? [] : ["TAVILY_API_KEY"],
      detail: webSearchConnected
        ? "Discovering public sources via Tavily."
        : "Not connected — the scanner cannot discover new public sources.",
    },
    {
      key: "ai_extraction",
      label: "AI extraction (OpenRouter/Groq)",
      connected: aiConnected,
      missingEnv: aiMissing,
      detail: aiConnected
        ? "Extracting signals with a free model."
        : "Not connected — falling back to deterministic keyword extraction.",
    },
  ];
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
