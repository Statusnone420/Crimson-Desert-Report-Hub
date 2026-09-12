import { once } from "node:events";
import { createServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import worker, { CRON_TIMEOUT_MS, runCron, type Env } from "../cloudflare/scanner-cron/src/index";
import { SCANNER_ATTEMPT_HEADER, SCANNER_ATTEMPT_START_KEY, SCANNER_EXECUTION_STATE_KEY } from "@/lib/automation/diagnostics";

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
  const stored = new Map<string, string>();
  const email = { send: vi.fn(async (message: Email) => ({ messageId: message.subject })) };
  const state = {
    get: vi.fn(async (key: string) => stored.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => { stored.set(key, value); }),
  };
  const env: Env = {
    CRON_URL: "https://example.test/api/cron/keepalive",
    CRON_SECRET: "test-secret",
    ALERT_EMAIL: email,
    ALERT_STATE: state,
    ALERT_SENDER: "scanner-alerts@example.test",
    ALERT_RECIPIENT: "operator@example.test",
  };
  return { env, email, state, read: (key = "scanner-ai-health-alert-v1") => stored.get(key) ?? null };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("scanner cron alert lifecycle", () => {
  it.each([301, 302, 303, 307, 308])("records HTTP %s without following the redirect or forwarding credentials", async (status) => {
    const { env, email, read } = configuredEnv();
    const requests: string[] = [];
    const server = createServer((request, reply) => {
      requests.push(request.url ?? "");
      if (request.url === "/keepalive") {
        reply.writeHead(status, { location: "/destination?private=redirect-target" }).end();
      } else {
        reply.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({
          ok: true, automation: { status: "success" }, aiHealth: healthy,
        }));
      }
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Test server has no TCP port");
      env.CRON_URL = `http://127.0.0.1:${address.port}/keepalive`;

      await expect(runCron(env)).rejects.toThrow(`cron_http_${status}`);
      expect(requests).toEqual(["/keepalive"]);
      expect(JSON.parse(read(SCANNER_EXECUTION_STATE_KEY)!).latestAttempt).toMatchObject({
        outcome: "failed", httpStatus: status, diagnostics: [{ stage: "request", code: "http_error" }],
      });
      expect(email.send).toHaveBeenCalledTimes(1);
      expect(email.send.mock.calls[0][0].text).toContain(`HTTP status: ${status}`);
      expect(email.send.mock.calls[0][0].text).not.toMatch(/test-secret|redirect-target/);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

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

  it.each([
    { automation: { status: ["failed"] }, aiHealth: healthy },
    { automation: { status: "success" }, aiHealth: { ...healthy, state: ["healthy"] } },
  ])("rejects array-valued response states without reporting recovery", async (payload) => {
    const { env, email, read } = configuredEnv();
    await expect(runCron(env, async () => response(limited))).rejects.toThrow("workers_ai_daily_limit");
    email.send.mockClear();

    await expect(runCron(env, async () => Response.json({ ok: true, ...payload }))).rejects.toThrow("cron_response_invalid");
    expect(email.send).toHaveBeenCalledTimes(1);
    expect(email.send.mock.calls[0][0].subject).toBe("[CD Report Hub] Scanner AI alert: cron_response_invalid");
    expect(read()).toBe(JSON.stringify({ incidentCode: "cron_response_invalid" }));
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
    expect(state.put.mock.calls.filter(([key]) => key === "scanner-ai-health-alert-v1")).toHaveLength(0);
  });

  it.each(["", "null", "[]", "{}", '{"incidentCode":42}', '{"incidentCode":""}', '{"incidentCode":"unsafe code"}'])(
    "rejects corrupt alert state %j without sending or overwriting it",
    async (raw) => {
      const { env, email, state } = configuredEnv();
      state.get.mockImplementation(async (key) => key === "scanner-ai-health-alert-v1" ? raw : null);
      await expect(runCron(env, async () => response(healthy))).rejects.toThrow("alert_state_unavailable");
      await expect(runCron(env, async () => response(limited))).rejects.toThrow("alert_state_unavailable");
      expect(email.send).not.toHaveBeenCalled();
      expect(state.put.mock.calls.filter(([key]) => key === "scanner-ai-health-alert-v1")).toHaveLength(0);
    },
  );

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

describe("scanner attempt diagnostics", () => {
  it("names missing endpoint authorization without attempting a request", async () => {
    const { env, read } = configuredEnv();
    env.CRON_SECRET = "";
    const fetcher = vi.fn();
    await expect(runCron(env, fetcher)).rejects.toThrow("cron_configuration_missing");
    expect(fetcher).not.toHaveBeenCalled();
    expect(JSON.parse(read(SCANNER_EXECUTION_STATE_KEY)!).latestAttempt.diagnostics).toEqual([{ stage: "request", code: "configuration_missing" }]);
  });

  it("alerts when an older app reports a spending-read error as skipped", async () => {
    const { env, email, read } = configuredEnv();
    await expect(runCron(env, async () => Response.json({ ok: true, aiHealth: healthy,
      automation: { status: "skipped", errors: ["private database failure"], skips: ["budget_read_failed"] },
    }))).rejects.toThrow("scanner_run_failed");
    const snapshot = JSON.parse(read(SCANNER_EXECUTION_STATE_KEY)!);
    expect(snapshot.latestAttempt).toMatchObject({ outcome: "failed", errorCount: 1,
      diagnostics: [{ stage: "budget_read", code: "database_unavailable" }] });
    expect(email.send.mock.calls[0][0].text).toContain("Reading recorded spending");
    expect(JSON.stringify(snapshot)).not.toContain("private database failure");
  });

  it("retains a pre-ledger failure and earlier success outside the database", async () => {
    const { env, email, read } = configuredEnv();
    await runCron(env, async () => response());
    const previous = JSON.parse(read(SCANNER_EXECUTION_STATE_KEY)!);
    await expect(runCron(env, async (_url, init) => {
      const id = new Headers(init?.headers).get(SCANNER_ATTEMPT_HEADER);
      const now = new Date().toISOString();
      return Response.json({ ok: false, aiHealth: null, automation: { status: "failed" },
        attempt: { id, startedAt: now, finishedAt: now, outcome: "failed", errorCount: 1,
          diagnostics: [{ stage: "run_create", code: "database_timeout" }], skipReason: null,
          nextEligibleAt: now, httpStatus: 503 },
      }, { status: 503 });
    })).rejects.toThrow("scanner_run_failed");
    const snapshot = JSON.parse(read(SCANNER_EXECUTION_STATE_KEY)!);
    expect(snapshot.lastFailedAttempt).toMatchObject({ outcome: "failed", httpStatus: 503,
      diagnostics: [{ stage: "run_create", code: "database_timeout" }] });
    expect(snapshot.lastSuccessfulScanAt).toBe(previous.lastSuccessfulScanAt);
    expect(snapshot.lastSuccessfulAiAt).toBe(healthy.lastSuccessAt);
    expect(JSON.parse(read(SCANNER_ATTEMPT_START_KEY)!).id).toBe(snapshot.latestAttempt.id);
    expect(email.send.mock.calls.at(-1)?.[0].text).toContain("Creating the run record");
    expect(email.send.mock.calls.at(-1)?.[0].text).toContain(`Last successful AI processing: ${healthy.lastSuccessAt}`);
    expect(email.send.mock.calls.at(-1)?.[0].text).not.toContain("No successful AI run recorded");
  });

  it("keeps the last failed attempt after recovery", async () => {
    const { env, read } = configuredEnv();
    await expect(runCron(env, async () => new Response("private body", { status: 500 }))).rejects.toThrow("cron_http_500");
    const failure = JSON.parse(read(SCANNER_EXECUTION_STATE_KEY)!).lastFailedAttempt;
    await runCron(env, async () => response());
    const snapshot = JSON.parse(read(SCANNER_EXECUTION_STATE_KEY)!);
    expect(snapshot.lastFailedAttempt).toEqual(failure);
    expect(snapshot.latestAttempt.outcome).toBe("success");
    expect(read()).toBe(JSON.stringify({ incidentCode: null }));
  });

  it("reports missing health details without claiming there was never a successful run", async () => {
    const { env, email } = configuredEnv();
    await expect(runCron(env, async () => new Response("private body", { status: 500 }))).rejects.toThrow("cron_http_500");
    expect(email.send.mock.calls[0][0].text).toContain("Last successful scan: Not available in the saved trigger record");
    expect(email.send.mock.calls[0][0].text).not.toContain("No successful AI run recorded");
  });

  it("reports completion-record failure even after a successful scan", async () => {
    const { env, state, email, read } = configuredEnv();
    const write = state.put.getMockImplementation()!;
    state.put.mockImplementation(async (key, value) => {
      if (key === SCANNER_EXECUTION_STATE_KEY) throw new Error("private KV failure");
      await write(key, value);
    });
    await expect(runCron(env, async () => response())).rejects.toThrow("scanner_status_write_failed");
    expect(read(SCANNER_ATTEMPT_START_KEY)).not.toBeNull();
    expect(email.send.mock.calls[0][0].subject).toContain("scanner_status_write_failed");
    expect(email.send.mock.calls[0][0].text).toContain("Saving the trigger record");
  });

  it("keeps database UTC timestamps, including microseconds, as valid prior AI evidence", async () => {
    const { env, read } = configuredEnv();
    await runCron(env, async () => response({ ...healthy, lastSuccessAt: "2026-09-06T16:00:00.123456+00:00" }));
    await expect(runCron(env, async () => new Response(null, { status: 500 }))).rejects.toThrow("cron_http_500");
    expect(JSON.parse(read(SCANNER_EXECUTION_STATE_KEY)!).lastSuccessfulAiAt).toBe("2026-09-06T16:00:00.123Z");
  });

  it("rejects contradictory success evidence and never sends recovery", async () => {
    const { env, email, read } = configuredEnv();
    await expect(runCron(env, async () => new Response(null, { status: 500 }))).rejects.toThrow("cron_http_500");
    await expect(runCron(env, async (_url, init) => {
      const now = new Date().toISOString();
      return Response.json({ ok: true, aiHealth: healthy, automation: { status: "success", errors: ["private error"] }, attempt: {
        id: new Headers(init?.headers).get(SCANNER_ATTEMPT_HEADER), startedAt: now, finishedAt: now,
        outcome: "success", diagnostics: [], errorCount: 0, skipReason: null, nextEligibleAt: null, httpStatus: 200,
      } });
    })).rejects.toThrow("cron_response_invalid");
    expect(email.send.mock.calls.every(([message]) => !message.subject.includes("recovered"))).toBe(true);
    expect(JSON.parse(read(SCANNER_EXECUTION_STATE_KEY)!).latestAttempt.outcome).toBe("failed");
  });

  it("records unreadable prior status without replacing its history", async () => {
    const { env, state, read } = configuredEnv();
    await state.put(SCANNER_EXECUTION_STATE_KEY, "corrupt");
    await expect(runCron(env, async () => response())).rejects.toThrow("scanner_status_read_failed");
    expect(read(SCANNER_EXECUTION_STATE_KEY)).toBe("corrupt");
    expect(read(SCANNER_ATTEMPT_START_KEY)).not.toBeNull();
  });

  it("preserves both diagnoses when the status read and start-marker write fail", async () => {
    const { env, state, email } = configuredEnv();
    const get = state.get.getMockImplementation()!;
    const put = state.put.getMockImplementation()!;
    state.get.mockImplementation(async (key) => {
      if (key === SCANNER_EXECUTION_STATE_KEY) throw new Error("private read failure");
      return get(key);
    });
    state.put.mockImplementation(async (key, value) => {
      if (key === SCANNER_ATTEMPT_START_KEY) throw new Error("private write failure");
      await put(key, value);
    });
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      await expect(runCron(env, async () => response())).rejects.toThrow("scanner_status_read_failed");
      const completion = log.mock.calls.map(([message]) => JSON.parse(message))
        .find((event) => event.event === "scanner_attempt_completed");
      expect(completion.latestAttempt).toMatchObject({ outcome: "partial", errorCount: 2, diagnostics: [
        { stage: "status_read", code: "operation_failed" },
        { stage: "status_write", code: "operation_failed" },
      ] });
      expect(state.put.mock.calls.some(([key]) => key === SCANNER_EXECUTION_STATE_KEY)).toBe(false);
      expect(email.send.mock.calls[0][0].text).toContain("Reading the previous trigger record");
      expect(email.send.mock.calls[0][0].text).toContain("Saving the trigger record");
      expect(JSON.stringify(completion)).not.toContain("private");
    } finally {
      log.mockRestore();
    }
  });
});
