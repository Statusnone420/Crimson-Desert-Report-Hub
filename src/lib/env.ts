type EnvLike = Record<string, string | undefined>;

export type Features = {
  turnstile: boolean;
  reddit: boolean;
  ai: boolean;
  xSearch: boolean;
};

export function computeFeatures(env: EnvLike): Features {
  return {
    turnstile: Boolean(env.TURNSTILE_SECRET_KEY),
    reddit: Boolean(env.REDDIT_CLIENT_ID && env.REDDIT_CLIENT_SECRET && env.REDDIT_USER_AGENT),
    ai: Boolean(env.GROQ_API_KEY || env.OPENROUTER_API_KEY),
    xSearch: Boolean(env.XAI_API_KEY),
  };
}

export function features(): Features {
  return computeFeatures(process.env);
}

export function requiredEnv(
  name: "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY" | "ADMIN_PASSWORD" | "SESSION_SECRET",
): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}
