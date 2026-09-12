import { afterEach, describe, expect, it, vi } from "vitest";
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER } from "next/constants";
import config from "../next.config";
import { assertProductionCheckinsReady } from "../scripts/checkins-release.mjs";

const migration = "20260912184424_issue_checkins.sql";
const env = {
  VERCEL_ENV: "production",
  SUPABASE_URL: "https://database.example.test",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-key-never-log",
};

function readySchema() {
  return {
    swagger: "2.0",
    paths: {
      "/issue_checkins": { get: {}, post: {}, patch: {} },
      "/rpc/record_issue_checkin": {
        post: { parameters: [{ in: "body", schema: { properties: {
          p_cluster_id: { type: "string" }, p_patch_version: { type: "string" },
          p_platform: { type: "string" }, p_kind: { type: "string" }, p_voter_ip_hash: { type: "string" },
        } } }] },
      },
    },
    definitions: { issue_checkins: { properties: {
      id: {}, created_at: {}, cluster_id: {}, patch_version: {}, platform: {}, kind: {}, voter_ip_hash: {},
    } } },
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Production check-in release gate", () => {
  it("blocks the new production build while only the legacy schema exists", async () => {
    const fetchSchema = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      swagger: "2.0", paths: { "/rpc/record_issue_confirmation": { post: {} } }, definitions: {},
    }));
    await expect(assertProductionCheckinsReady(env, fetchSchema)).rejects.toThrow(migration);
    expect(fetchSchema).toHaveBeenCalledOnce();
  });

  it("accepts the migrated API contract using only a bounded, uncached schema GET", async () => {
    const fetchSchema = vi.fn<typeof fetch>().mockResolvedValue(Response.json(readySchema()));
    await expect(assertProductionCheckinsReady(env, fetchSchema)).resolves.toBeUndefined();
    expect(fetchSchema).toHaveBeenCalledExactlyOnceWith(new URL("https://database.example.test/rest/v1/"), {
      method: "GET", headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        Accept: "application/openapi+json",
      }, signal: expect.any(AbortSignal), redirect: "error", cache: "no-store",
    });
  });

  it.each([undefined, "preview", "development"])("does not contact a database for %s builds", async (environment) => {
    const fetchSchema = vi.fn<typeof fetch>();
    await assertProductionCheckinsReady({ VERCEL_ENV: environment }, fetchSchema);
    expect(fetchSchema).not.toHaveBeenCalled();
  });

  it.each([
    { SUPABASE_URL: undefined }, { SUPABASE_SERVICE_ROLE_KEY: undefined },
    { SUPABASE_SERVICE_ROLE_KEY: "  " }, { SUPABASE_URL: "http://database.example.test" },
    { SUPABASE_URL: "https://user:password@database.example.test" },
  ])("rejects missing or unsafe production configuration before sending credentials: %j", async (override) => {
    const fetchSchema = vi.fn<typeof fetch>();
    await expect(assertProductionCheckinsReady({ ...env, ...override }, fetchSchema)).rejects.toThrow("service configuration");
    expect(fetchSchema).not.toHaveBeenCalled();
  });

  it.each([401, 403, 503, 504])("blocks the build on HTTP %s without exposing the response body", async (status) => {
    const fetchSchema = vi.fn<typeof fetch>().mockResolvedValue(new Response("private response", { status }));
    await expect(assertProductionCheckinsReady(env, fetchSchema)).rejects.toThrow(`HTTP ${status}`);
  });

  it("redacts a network/timeout error rather than logging its request details", async () => {
    const fetchSchema = vi.fn<typeof fetch>().mockRejectedValue(new Error(env.SUPABASE_SERVICE_ROLE_KEY));
    await expect(assertProductionCheckinsReady(env, fetchSchema)).rejects.toThrow("could not read the database schema");
  });

  it("rejects malformed JSON metadata", async () => {
    const fetchSchema = vi.fn<typeof fetch>().mockResolvedValue(new Response("not json"));
    await expect(assertProductionCheckinsReady(env, fetchSchema)).rejects.toThrow("invalid schema metadata");
  });

  it.each(["table permission", "column", "RPC permission", "RPC signature"])("rejects an incomplete contract: %s", async (missing) => {
    const schema = readySchema();
    if (missing === "table permission") Reflect.deleteProperty(schema.paths["/issue_checkins"], "patch");
    if (missing === "column") Reflect.deleteProperty(schema.definitions.issue_checkins.properties, "patch_version");
    if (missing === "RPC permission") Reflect.deleteProperty(schema.paths["/rpc/record_issue_checkin"], "post");
    if (missing === "RPC signature") Reflect.deleteProperty(schema.paths["/rpc/record_issue_checkin"].post.parameters[0].schema.properties, "p_patch_version");
    const fetchSchema = vi.fn<typeof fetch>().mockResolvedValue(Response.json(schema));
    await expect(assertProductionCheckinsReady(env, fetchSchema)).rejects.toThrow(migration);
  });

  it("runs from Next's production build phase and never from server startup", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("SUPABASE_URL", env.SUPABASE_URL);
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", env.SUPABASE_SERVICE_ROLE_KEY);
    const fetchSchema = vi.fn<typeof fetch>().mockResolvedValue(Response.json({}));
    vi.stubGlobal("fetch", fetchSchema);
    await config(PHASE_PRODUCTION_SERVER);
    await config(PHASE_DEVELOPMENT_SERVER);
    expect(fetchSchema).not.toHaveBeenCalled();
    await expect(config(PHASE_PRODUCTION_BUILD)).rejects.toThrow(migration);
  });
});
