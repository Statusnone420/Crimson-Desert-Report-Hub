import type { Category } from "@/lib/constants";

const RULES: { category: Category; confidence: "medium" | "low"; patterns: RegExp[] }[] = [
  {
    category: "performance",
    confidence: "medium",
    patterns: [/\bfps\b/i, /stutter/i, /frame ?(rate|pacing|drops?|gen)/i, /performance/i, /\blag(gy|ging)?\b/i],
  },
  {
    category: "crash_startup",
    confidence: "medium",
    patterns: [/crash/i, /\bctd\b/i, /freez(e|ing)/i, /won'?t (start|launch|load)/i, /hang(s|ing)? (at|on)/i],
  },
  {
    category: "controls_gameplay",
    confidence: "medium",
    patterns: [/\bhorse\b/i, /\bmount\b/i, /controls?\b/i, /input/i, /lock(s|ed)? ?up/i, /unresponsive/i],
  },
  {
    category: "graphics_visual",
    confidence: "medium",
    patterns: [/artifact/i, /flicker/i, /texture/i, /\bfsr\b/i, /\bdlss\b/i, /ghosting/i],
  },
];

export function classifySignal(text: string): { category: Category; confidence: "low" | "medium" } {
  for (const rule of RULES) {
    if (rule.patterns.some((pattern) => pattern.test(text))) {
      return { category: rule.category, confidence: rule.confidence };
    }
  }
  return { category: "other", confidence: "low" };
}

export function summarize(title: string, body: string): string {
  const flat = `${title} - ${body}`.replace(/\s+/g, " ").trim();
  return flat.length <= 280 ? flat : `${flat.slice(0, 277)}...`;
}

export type RedditPost = {
  id: string;
  title: string;
  selftext: string | null;
  permalink: string;
  created_utc: number;
};

export async function getRedditToken(): Promise<string> {
  const id = process.env.REDDIT_CLIENT_ID;
  const secret = process.env.REDDIT_CLIENT_SECRET;
  const userAgent = process.env.REDDIT_USER_AGENT;
  if (!id || !secret || !userAgent) throw new Error("reddit credentials missing");

  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": userAgent,
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }),
  });
  if (!res.ok) throw new Error(`reddit token failed: ${res.status}`);
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("reddit token missing in response");
  return data.access_token;
}

export async function fetchNewPosts(subreddit: string, token: string, limit = 25): Promise<RedditPost[]> {
  const userAgent = process.env.REDDIT_USER_AGENT;
  if (!userAgent) throw new Error("reddit user agent missing");

  const res = await fetch(`https://oauth.reddit.com/r/${encodeURIComponent(subreddit)}/new?limit=${limit}`, {
    headers: { authorization: `Bearer ${token}`, "user-agent": userAgent },
  });
  if (!res.ok) throw new Error(`reddit fetch failed for r/${subreddit}: ${res.status}`);
  const data = (await res.json()) as { data?: { children?: { data: RedditPost }[] } };
  return (data.data?.children ?? []).map((child) => child.data);
}
