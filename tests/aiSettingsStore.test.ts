import { afterEach, describe, expect, it, vi } from "vitest";
import { aiRpc, emptyConfiguration, readAiConfiguration, readAiConnection, readAiDashboard, type AiClient } from "@/lib/aiSettings/store.server";
import { sealAiKey } from "@/lib/aiSettings/credentials.server";

type ErrorRow = { code: string; message: string };
function clientFor(options: { rows?: Record<string, unknown>[]; error?: ErrorRow; summary?: unknown } = {}) {
  const selections: string[] = [];
  const query = { select: (columns: string) => { selections.push(columns); return query; }, eq: () => query,
    order: () => query, limit: async () => ({ data: options.rows ?? [], error: options.error ?? null }) };
  const from = vi.fn(() => query);
  const rpc = vi.fn(async () => ({ data: options.summary ?? {}, error: options.error ?? null }));
  return { client: { from, rpc } as unknown as AiClient, from, rpc, selections };
}
afterEach(() => { vi.unstubAllEnvs(); });

describe("AI settings storage boundaries", () => {
  it.each([
    { code: "42P01", message: 'relation "public.ai_settings_state" does not exist' },
    { code: "PGRST205", message: "Could not find the table 'public.ai_settings_state' in the schema cache" },
  ])("permits legacy operation only for the missing new relation ($code)", async (error) => {
    const { client } = clientFor({ error });
    await expect(readAiConfiguration(client)).resolves.toBeNull();
  });

  it.each([
    { code: "42501", message: "permission denied for ai_settings_state PRIVATE_DETAIL" },
    { code: "42P01", message: 'relation "public.other_table" does not exist' },
    { code: "PGRST205", message: "Could not find the table 'public.other_table' in the schema cache" },
    { code: "42P01", message: 'relation "public.ai_settings_state_shadow" does not exist' },
    { code: "PGRST205", message: "Could not find the table 'private.ai_settings_state' in the schema cache" },
    { code: "08006", message: "PRIVATE_CONNECTION_DETAILS ai_settings_state" },
  ])("does not turn unrelated database failure into legacy success ($code)", async (error) => {
    await expect(readAiConfiguration(clientFor({ error }).client)).rejects.toThrow(/^ai_settings_unavailable$/);
  });

  it("rejects a missing singleton and malformed stored configuration", async () => {
    await expect(readAiConfiguration(clientFor().client)).rejects.toThrow(/^ai_settings_unavailable$/);
    await expect(readAiConfiguration(clientFor({ rows: [{ revision: 2, configuration: { active: "bad" } }] }).client)).rejects.toThrow();
  });

  it("uses the revision column and supports legacy-null active and previous profiles", async () => {
    const configuration = emptyConfiguration();
    const { client } = clientFor({ rows: [{ revision: 7, configuration }] });
    await expect(readAiConfiguration(client)).resolves.toEqual({ ...configuration, revision: 7 });
  });

  it("returns safe connection metadata without selecting ciphertext or returning the environment credential", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "PRIVATE_ENV_CREDENTIAL");
    const fixture = clientFor();
    await expect(readAiConnection(fixture.client)).resolves.toEqual({ provider: "openrouter", configured: true, source: "environment", version: 0 });
    expect(fixture.selections).toEqual(["version"]);
  });

  it("prefers the saved credential and decrypts it only for explicit server use", async () => {
    vi.stubEnv("AI_SETTINGS_ENCRYPTION_KEY", Buffer.alloc(32, 4).toString("base64"));
    vi.stubEnv("OPENROUTER_API_KEY", "PRIVATE_ENV_CREDENTIAL");
    const key = "fixture-saved-provider-credential";
    const fixture = clientFor({ rows: [{ version: 2, ciphertext: sealAiKey(key) }] });
    await expect(readAiConnection(fixture.client)).resolves.toEqual({ provider: "openrouter", configured: true, source: "saved", version: 2 });
    await expect(readAiConnection(fixture.client, true)).resolves.toMatchObject({ key, version: 2 });
    expect(fixture.selections).toEqual(["version", "version,ciphertext"]);
  });

  it.each([
    ["ai_settings_revision_conflict", "ai_revision_conflict"],
    ["ai_connection_version_conflict", "ai_connection_conflict"],
    ["ai_test_required", "ai_test_not_valid"],
    ["ai_spending_blocked", "ai_spending_blocked"],
    ["PRIVATE_SQL_AND_CREDENTIAL", "ai_settings_unavailable"],
  ])("maps database errors into stable safe errors (%s)", async (message, expected) => {
    const { client } = clientFor({ error: { code: "55000", message } });
    await expect(aiRpc(client, "ai_test_reserve", {})).rejects.toThrow(new RegExp(`^${expected}$`));
  });

  it("does not query receipts, connections, or spend while the migration is absent", async () => {
    const fixture = clientFor({ error: { code: "42P01", message: 'relation "public.ai_settings_state" does not exist' } });
    const dashboard = await readAiDashboard(fixture.client);
    expect(dashboard).toMatchObject({ available: false, spend: { blocked: true }, tests: [], activity: [] });
    expect(fixture.from).toHaveBeenCalledTimes(1);
    expect(fixture.from).toHaveBeenCalledWith("ai_settings_state");
    expect(fixture.rpc).not.toHaveBeenCalled();
  });
});
