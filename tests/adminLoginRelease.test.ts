import { afterEach, describe, expect, it, vi } from "vitest";
import { PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER } from "next/constants";
import config from "../next.config";
import { assertProductionLoginReady } from "../scripts/admin-login-release.mjs";

const env = { VERCEL_ENV: "production", SUPABASE_URL: "https://database.example.test", SUPABASE_SERVICE_ROLE_KEY: "test-service-key" };
function ready() {
  return { paths: {
    "/admin_login_attempts": { get: {}, post: {}, delete: {} },
    "/rpc/reserve_admin_login_attempt": { post: { parameters: [{ in: "body", schema: { properties: { p_address_hash: {} } } }] } },
  }, definitions: { admin_login_attempts: { properties: { id: {}, created_at: {}, address_hash: {} } } } };
}
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("login migration release gate", () => {
  it("reads schema only and permits a complete service-role contract", async () => {
    const fetchSchema = vi.fn<typeof fetch>().mockResolvedValue(Response.json(ready()));
    await expect(assertProductionLoginReady(env, fetchSchema)).resolves.toBeUndefined();
    expect(fetchSchema).toHaveBeenCalledExactlyOnceWith(new URL(`${env.SUPABASE_URL}/rest/v1/`), {
      method: "GET", headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, Accept: "application/openapi+json" },
      signal: expect.any(AbortSignal), redirect: "error", cache: "no-store",
    });
  });
  it.each([null, {}, { paths: {}, definitions: {} }, { ...ready(), paths: {} }])("blocks missing migration %j", async (schema) => {
    await expect(assertProductionLoginReady(env, vi.fn<typeof fetch>().mockResolvedValue(Response.json(schema))))
      .rejects.toThrow("20261002191659_admin_login_attempts.sql");
  });
  it.each(["table permission", "column", "RPC signature"])("blocks an incomplete contract: %s", async (missing) => {
    const schema = ready();
    if (missing === "table permission") Reflect.deleteProperty(schema.paths["/admin_login_attempts"], "delete");
    if (missing === "column") Reflect.deleteProperty(schema.definitions.admin_login_attempts.properties, "address_hash");
    if (missing === "RPC signature") Reflect.deleteProperty(schema.paths["/rpc/reserve_admin_login_attempt"].post.parameters[0].schema.properties, "p_address_hash");
    await expect(assertProductionLoginReady(env, vi.fn<typeof fetch>().mockResolvedValue(Response.json(schema)))).rejects.toThrow("20261002191659");
  });
  it.each([undefined, "preview", "development"])("never contacts the database in %s builds", async (VERCEL_ENV) => {
    const fetchSchema = vi.fn<typeof fetch>();
    await assertProductionLoginReady({ ...env, VERCEL_ENV }, fetchSchema);
    expect(fetchSchema).not.toHaveBeenCalled();
  });
  it.each([401, 403, 503])("rejects HTTP %s without leaking the body", async (status) => {
    await expect(assertProductionLoginReady(env, vi.fn<typeof fetch>().mockResolvedValue(new Response("private", { status })))).rejects.toThrow(`HTTP ${status}`);
  });
  it("sanitizes transport and parse failures", async () => {
    await expect(assertProductionLoginReady(env, vi.fn<typeof fetch>().mockRejectedValue(new Error("private")))).rejects.toThrow("could not read");
    await expect(assertProductionLoginReady(env, vi.fn<typeof fetch>().mockResolvedValue(new Response("private")))).rejects.toThrow("invalid schema");
  });
  it.each([{ SUPABASE_URL: "http://example.test" }, { SUPABASE_URL: "https://u:p@example.test" }, { SUPABASE_URL: undefined }, { SUPABASE_SERVICE_ROLE_KEY: "" }])("rejects unsafe configuration %j", async (override) => {
    const fetchSchema = vi.fn<typeof fetch>();
    await expect(assertProductionLoginReady({ ...env, ...override }, fetchSchema)).rejects.toThrow("service configuration");
    expect(fetchSchema).not.toHaveBeenCalled();
  });
  it("is wired after the existing check-in build gate, never at server startup", async () => {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    const checkins = { paths: {
      "/issue_checkins": { get: {}, post: {}, patch: {} },
      "/rpc/record_issue_checkin": { post: { parameters: [{ in: "body", schema: { properties: { p_cluster_id: {}, p_patch_version: {}, p_platform: {}, p_kind: {}, p_voter_ip_hash: {}, p_token_hash: {} } } }] } },
    }, definitions: { issue_checkins: { properties: { id: {}, created_at: {}, cluster_id: {}, patch_version: {}, platform: {}, kind: {}, voter_ip_hash: {} } } } };
    const fetchSchema = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(checkins)).mockResolvedValueOnce(Response.json({}));
    vi.stubGlobal("fetch", fetchSchema);
    await config(PHASE_PRODUCTION_SERVER);
    expect(fetchSchema).not.toHaveBeenCalled();
    await expect(config(PHASE_PRODUCTION_BUILD)).rejects.toThrow("20261002191659_admin_login_attempts.sql");
    expect(fetchSchema).toHaveBeenCalledTimes(2);
  });
});
