type EnvLike = Record<string, string | undefined>;

export type Features = {
  turnstile: boolean;
  reddit: boolean;
  ai: boolean;
  xSearch: boolean;
};

function hasEnvValue(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

export function computeFeatures(env: EnvLike): Features {
  return {
    turnstile: hasEnvValue(env.NEXT_PUBLIC_TURNSTILE_SITE_KEY) && hasEnvValue(env.TURNSTILE_SECRET_KEY),
    reddit:
      hasEnvValue(env.REDDIT_CLIENT_ID) &&
      hasEnvValue(env.REDDIT_CLIENT_SECRET) &&
      hasEnvValue(env.REDDIT_USER_AGENT),
    ai: hasEnvValue(env.GROQ_API_KEY) || hasEnvValue(env.OPENROUTER_API_KEY),
    xSearch: hasEnvValue(env.XAI_API_KEY),
  };
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
