const MIGRATION = "20261002191659_admin_login_attempts.sql";

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** @param {unknown} schema */
function supportsLoginLimits(schema) {
  if (!record(schema) || !record(schema.paths) || !record(schema.definitions)) return false;
  const table = schema.paths["/admin_login_attempts"];
  const definition = schema.definitions.admin_login_attempts;
  const rpc = schema.paths["/rpc/reserve_admin_login_attempt"];
  if (!record(table) || !record(table.get) || !record(table.post) || !record(table.delete)) return false;
  if (!record(definition) || !record(definition.properties)) return false;
  if (!["id", "created_at", "address_hash"].every((name) => Object.hasOwn(definition.properties, name))) return false;
  if (!record(rpc) || !record(rpc.post) || !Array.isArray(rpc.post.parameters)) return false;
  const body = rpc.post.parameters.find((parameter) => record(parameter) && parameter.in === "body");
  return record(body) && record(body.schema) && record(body.schema.properties)
    && Object.keys(body.schema.properties).length === 1 && Object.hasOwn(body.schema.properties, "p_address_hash");
}

/**
 * Keep the previous production deployment serving until the additive login
 * migration exists. This reads schema metadata only; it never reserves attempts.
 * @param {Record<string, string | undefined>} env
 * @param {typeof fetch} fetchSchema
 */
export async function assertProductionLoginReady(env = process.env, fetchSchema = fetch) {
  if (env.VERCEL_ENV !== "production") return;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  let url;
  try {
    url = new URL("rest/v1/", `${env.SUPABASE_URL?.replace(/\/+$/, "")}/`);
    if (!serviceKey || url.protocol !== "https:" || url.username || url.password) throw new Error();
  } catch {
    throw new Error("Production login preflight requires valid Supabase service configuration.");
  }
  let response;
  try {
    response = await fetchSchema(url, {
      method: "GET", headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Accept: "application/openapi+json" },
      signal: AbortSignal.timeout(10_000), redirect: "error", cache: "no-store",
    });
  } catch {
    throw new Error("Production login preflight could not read the database schema. Keep the current deployment live.");
  }
  if (!response.ok) throw new Error(`Production login preflight failed (HTTP ${response.status}). Keep the current deployment live.`);
  let schema;
  try { schema = await response.json(); } catch {
    throw new Error("Production login preflight received invalid schema metadata. Keep the current deployment live.");
  }
  if (!supportsLoginLimits(schema)) {
    throw new Error(`Production login requires ${MIGRATION}. Keep the current deployment live, apply the migration only with approval, then create a fresh Production build.`);
  }
}
