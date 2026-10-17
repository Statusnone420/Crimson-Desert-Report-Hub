import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { verifyProblemReportTurnstile } from "@/lib/turnstile";

beforeEach(() => { vi.stubEnv("PROBLEM_REPORT_TURNSTILE_SECRET_KEY", "fixture-secret"); vi.stubEnv("NODE_ENV", "production"); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const answer = (data: unknown, status = 200) => vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(data, { status })));

it("checks action and hostname, uses a deadline, and never sends the IP", async () => {
  answer({ success: true, action: "problem_report", hostname: "crimsonreporthub.com" });
  expect(await verifyProblemReportTurnstile("fresh-token", "https://crimsonreporthub.com/api/problem-reports")).toBe(true);
  const options = vi.mocked(fetch).mock.calls[0][1]!;
  expect(options.signal).toBeInstanceOf(AbortSignal);
  expect((options.body as URLSearchParams).has("remoteip")).toBe(false);
});
it.each([
  { success: true, action: "checkin", hostname: "crimsonreporthub.com" },
  { success: true, hostname: "crimsonreporthub.com" },
  { success: true, action: "problem_report", hostname: "localhost" },
  { success: true, action: "problem_report", hostname: "other.test" },
  { success: false, "error-codes": ["timeout-or-duplicate"] },
])("refuses wrong action/host or expired and replayed tokens", async (data) => {
  answer(data); expect(await verifyProblemReportTurnstile("token", "https://crimsonreporthub.com/api/problem-reports")).toBe(false);
});
it("fails closed on missing config, upstream HTTP errors, and network failures", async () => {
  answer({ success: true, action: "problem_report", hostname: "crimsonreporthub.com" }, 500);
  expect(await verifyProblemReportTurnstile("token", "https://crimsonreporthub.com/api/problem-reports")).toBe(false);
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
  expect(await verifyProblemReportTurnstile("token", "https://crimsonreporthub.com/api/problem-reports")).toBe(false);
  vi.stubEnv("PROBLEM_REPORT_TURNSTILE_SECRET_KEY", "");
  vi.mocked(fetch).mockClear(); expect(await verifyProblemReportTurnstile("token", "https://crimsonreporthub.com/api/problem-reports")).toBe(false); expect(fetch).not.toHaveBeenCalled();
});
it("accepts the browser loopback alias only in local development", async () => {
  vi.stubEnv("NODE_ENV", "development");
  answer({ success: true, action: "problem_report", hostname: "127.0.0.1" });
  expect(await verifyProblemReportTurnstile("token", "http://localhost:3000/api/problem-reports")).toBe(true);
  vi.stubEnv("NODE_ENV", "production");
  expect(await verifyProblemReportTurnstile("token", "http://localhost:3000/api/problem-reports")).toBe(false);
});
