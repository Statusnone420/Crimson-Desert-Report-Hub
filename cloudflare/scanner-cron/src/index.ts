export interface Env {
  CRON_URL: string;
  CRON_SECRET: string;
}

type CronController = {
  cron: string;
  scheduledTime: number;
  noRetry(): void;
};

type WorkerExecutionContext = {
  waitUntil(promise: Promise<unknown>): void;
};

async function callCron(env: Env): Promise<Response> {
  const url = env.CRON_URL?.trim();
  const secret = env.CRON_SECRET?.trim();
  if (!url || !secret) return new Response("missing cron configuration", { status: 500 });

  const response = await fetch(url, {
    method: "GET",
    headers: {
      authorization: `Bearer ${secret}`,
      "user-agent": "crimson-report-hub-cloudflare-cron",
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return new Response(body || `cron returned ${response.status}`, { status: response.status });
  }

  return new Response("ok", { status: 200 });
}

const worker = {
  async scheduled(_controller: CronController, env: Env, ctx: WorkerExecutionContext): Promise<void> {
    ctx.waitUntil(callCron(env));
  },
};

export default worker;
