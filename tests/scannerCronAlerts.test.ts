import { afterEach, describe, expect, it, vi } from "vitest";
import worker, { CRON_TIMEOUT_MS, runCron, type Env } from "../cloudflare/scanner-cron/src/index";

type Health = {
  state: "healthy" | "unavailable" | "limited" | "idle";
  code: string | null;
  message: string;
  lastSuccessAt: string | null;
};
type Email = { to: string; from: string; subject: string; text: string };

const healthy: Health = { state: "healthy", code: null, message: "AI completed.", lastSuccessAt: "2026-09-06T16:00:00.000Z" };
const limited: Health = { state: "limited", code: "workers_ai_daily_limit", message: "Private diagnostic", lastSuccessAt: "2026-09-06T15:00:00.000Z" };

function response(aiHealth: Health = healthy, ok = true, automationStatus = "success") {
  return Response.json({ ok, automation: { status: automationStatus }, aiHealth });
}

function configuredEnv() {
  let stored: string | null = null;
  const email = { send: vi.fn(async (message: Email) => ({ messageId: message.subject })) };
  const state = {
    get: vi.fn(async () => stored),
    put: vi.fn(async (_key: string, value: string) => { stored = value; }),
  };
  const env: Env = {
    CRON_URL: "https://example.test/api/cron/keepalive",
    CRON_SECRET: "test-secret",
    ALERT_EMAIL: email,
    ALERT_STATE: state,
    ALERT_SENDER: "scanner-alerts@example.test",
    ALERT_RECIPIENT: "operator@example.test",
  };
  return { env, email, state, read: () => stored };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("scanner cron alert lifecycle", () => {
  it("sends one alert per incident code, preserves it through idle, and sends one recovery", async () => {
    const { env, email, read } = configuredEnv();
    await expect(runCron(env, async () => response(limited))).rejects.toThrow("workers_ai_daily_limit");
    expect(email.send).toHaveBeenCalledTimes(1);
    expect(read()).toBe(JSON.stringify({ incidentCode: "workers_ai_daily_limit" }));

    await expect(runCron(env, async () => response(limited))).rejects.toThrow("workers_ai_daily_limit");
    expect(email.send).toHaveBeenCalledTimes(1);

    await expect(runCron(env, async () => response({ ...healthy, state: "idle" }))).resolves.toBeUndefined();
    expect(email.send).toHaveBeenCalledTimes(1);
    expect(read()).toBe(JSON.stringify({ incidentCode: "workers_ai_daily_limit" }));

    await expect(runCron(env, async () => response(healthy))).resolves.toBeUndefined();
    expect(email.send).toHaveBeenCalledTimes(2);
    expect(email.send.mock.calls.at(1)?.[0].subject).toContain("recovered: workers_ai_daily_limit");
    expect(read()).toBe(JSON.stringify({ incidentCode: null }));

    await expect(runCron(env, async () => response(healthy))).resolves.toBeUndefined();
    expect(email.send).toHaveBeenCalledTimes(2);
  });

  it.each(["failed", "partial"])("alerts and rejects when an HTTP 200 payload reports a %s scan", async (status) => {
    const { env, email } = configuredEnv();
    await expect(runCron(env, async () => response(healthy, true, status))).rejects.toThrow(`scanner_run_${status}`);
    expect(email.send).toHaveBeenCalledTimes(1);
    expect(email.send.mock.calls[0][0].subject).toContain(`scanner_run_${status}`);
  });

  it("does not recover on a skipped wake, then recovers after an actual successful scan", async () => {
    const { env, email, read } = configuredEnv();
    await expect(runCron(env, async () => response(limited))).rejects.toThrow("workers_ai_daily_limit");

    await expect(runCron(env, async () => response(healthy, true, "skipped"))).resolves.toBeUndefined();
    expect(email.send).toHaveBeenCalledTimes(1);
    expect(read()).toBe(JSON.stringify({ incidentCode: "workers_ai_daily_limit" }));

    await expect(runCron(env, async () => response(healthy, true, "running"))).resolves.toBeUndefined();
    expect(email.send).toHaveBeenCalledTimes(1);
    expect(read()).toBe(JSON.stringify({ incidentCode: "workers_ai_daily_limit" }));

    await expect(runCron(env, async () => response(healthy, true, "success"))).resolves.toBeUndefined();
    expect(email.send).toHaveBeenCalledTimes(2);
    expect(email.send.mock.calls[1][0].subject).toContain("recovered: workers_ai_daily_limit");
    expect(read()).toBe(JSON.stringify({ incidentCode: null }));
  });

  it.each([
    ["transport", async () => { throw new Error("private transport details"); }, "cron_transport_error"],
    ["HTTP", async () => new Response("private upstream body", { status: 503 }), "cron_http_503"],
    ["malformed JSON", async () => new Response("not json"), "cron_response_invalid"],
    ["oversized response", async () => new Response(JSON.stringify({ ok: true, padding: "x".repeat(33 * 1024) })), "cron_response_invalid"],
    ["payload failure", async () => response(limited, false), "cron_payload_failed"],
  ] as const)("alerts with a safe code and rejects on %s failure", async (_label, fetcher, code) => {
    const { env, email } = configuredEnv();
    await expect(runCron(env, fetcher)).rejects.toThrow(code);
    expect(email.send).toHaveBeenCalledTimes(1);
    const sent = email.send.mock.calls.at(0)?.[0];
    expect(sent).toMatchObject({
      to: "operator@example.test",
      from: "scanner-alerts@example.test",
      subject: `[CD Report Hub] Scanner AI alert: ${code}`,
    });
    expect(JSON.stringify(sent)).not.toMatch(/private transport details|test-secret|upstream body/i);
  });

  it("normalizes unsafe backend content out of the email", async () => {
    const { env, email } = configuredEnv();
    const privateHealth = {
      state: "limited" as const,
      code: "https://private.example/report?token=secret",
      message: "Raw report and private URL https://private.example/report",
      lastSuccessAt: "not a private timestamp payload",
    };
    await expect(runCron(env, async () => response(privateHealth))).rejects.toThrow("ai_limited");
    const message = JSON.stringify(email.send.mock.calls.at(0)?.[0]);
    expect(message).toContain("ai_limited");
    expect(message).not.toMatch(/private\.example|Raw report|token=secret|private timestamp/i);
  });

  it("allows a healthy keepalive response after 15 seconds", async () => {
    vi.useFakeTimers();
    const { env, email } = configuredEnv();
    const fetcher = vi.fn(() => new Promise<Response>((resolve) => {
      setTimeout(() => resolve(response(healthy)), 16_000);
    }));
    const pending = runCron(env, fetcher);
    await vi.advanceTimersByTimeAsync(16_000);
    await expect(pending).resolves.toBeUndefined();
    expect(email.send).not.toHaveBeenCalled();
  });

  it("times out at the full keepalive deadline, alerts once, and rejects", async () => {
    vi.useFakeTimers();
    const { env, email } = configuredEnv();
    let signal: AbortSignal | null | undefined;
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      signal = init?.signal;
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }));
    const pending = runCron(env, fetcher);
    const rejection = expect(pending).rejects.toThrow("cron_timeout");
    await vi.advanceTimersByTimeAsync(CRON_TIMEOUT_MS - 1);
    expect(signal?.aborted).toBe(false);
    expect(email.send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await rejection;
    expect(email.send).toHaveBeenCalledTimes(1);
  });

  it("keeps the deadline active while a response body is stalled", async () => {
    vi.useFakeTimers();
    const { env, email } = configuredEnv();
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"ok":true,'));
          init?.signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
        },
      });
      return Promise.resolve(new Response(body, { headers: { "content-type": "application/json" } }));
    });
    const pending = runCron(env, fetcher);
    const rejection = expect(pending).rejects.toThrow("cron_timeout");
    await vi.advanceTimersByTimeAsync(CRON_TIMEOUT_MS);
    await rejection;
    expect(email.send).toHaveBeenCalledTimes(1);
  });

  it("does not mark an incident delivered when email delivery fails", async () => {
    const { env, email, state } = configuredEnv();
    email.send.mockRejectedValueOnce(new Error("provider detail"));
    await expect(runCron(env, async () => response(limited))).rejects.toThrow("alert_delivery_failed");
    expect(state.put).not.toHaveBeenCalled();
  });

  it("keeps alerts disabled when every optional alert binding is absent", async () => {
    const env: Env = { CRON_URL: "https://example.test/api/cron/keepalive", CRON_SECRET: "test-secret" };
    await expect(runCron(env, async () => response(healthy))).resolves.toBeUndefined();
    await expect(runCron(env, async () => new Response("failed", { status: 500 }))).rejects.toThrow("cron_http_500");
  });

  it("rejects partial alert configuration instead of silently dropping alerts", async () => {
    const env: Env = {
      CRON_URL: "https://example.test/api/cron/keepalive",
      CRON_SECRET: "test-secret",
      ALERT_SENDER: "scanner-alerts@example.test",
    };
    await expect(runCron(env, async () => response(healthy))).rejects.toThrow("alert_configuration_invalid");
  });

  it("passes a rejecting promise to waitUntil so Cron Trigger records the failure", async () => {
    const env: Env = { CRON_URL: "https://example.test/api/cron/keepalive", CRON_SECRET: "test-secret" };
    vi.stubGlobal("fetch", vi.fn(async () => new Response("failed", { status: 500 })));
    let pending: Promise<unknown> | undefined;
    await worker.scheduled(
      { cron: "0 * * * *", scheduledTime: Date.now(), noRetry() {} },
      env,
      { waitUntil(promise) { pending = promise; } },
    );
    expect(pending).toBeDefined();
    await expect(pending).rejects.toThrow("cron_http_500");
  });
});
