import "server-only";

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
