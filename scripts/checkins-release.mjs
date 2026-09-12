const MIGRATION = "20260912184424_issue_checkins.sql";
const ARGUMENTS = ["p_cluster_id", "p_patch_version", "p_platform", "p_kind", "p_voter_ip_hash"];
const COLUMNS = ["id", "created_at", "cluster_id", "patch_version", "platform", "kind", "voter_ip_hash"];

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** @param {unknown} schema */
function supportsCheckins(schema) {
  if (!record(schema) || !record(schema.paths) || !record(schema.definitions)) return false;
  const table = schema.paths["/issue_checkins"];
  const definition = schema.definitions.issue_checkins;
  const rpc = schema.paths["/rpc/record_issue_checkin"];
  if (!record(table) || !record(table.get) || !record(table.post) || !record(table.patch)) return false;
  if (!record(definition) || !record(definition.properties)) return false;
  const columns = definition.properties;
  if (!COLUMNS.every((name) => Object.hasOwn(columns, name))) return false;
  if (!record(rpc) || !record(rpc.post) || !Array.isArray(rpc.post.parameters)) return false;
  const body = rpc.post.parameters.find((parameter) => record(parameter) && parameter.in === "body");
  if (!record(body) || !record(body.schema) || !record(body.schema.properties)) return false;
  const parameters = body.schema.properties;
  return Object.keys(parameters).length === ARGUMENTS.length && ARGUMENTS.every((name) => Object.hasOwn(parameters, name));
}

/**
 * A Production build may replace the legacy writer only after the additive
 * migration is visible to PostgREST. This GET reads schema metadata; it never
 * invokes the writer or reads response records. Previews remain read-only.
 * @param {Record<string, string | undefined>} env
 * @param {typeof fetch} fetchSchema
 */
export async function assertProductionCheckinsReady(env = process.env, fetchSchema = fetch) {
  if (env.VERCEL_ENV !== "production") return;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  let schemaUrl;
  try {
    schemaUrl = new URL("rest/v1/", `${env.SUPABASE_URL?.replace(/\/+$/, "")}/`);
    if (!serviceKey || schemaUrl.protocol !== "https:" || schemaUrl.username || schemaUrl.password) throw new Error();
  } catch {
    throw new Error("Production check-in preflight requires valid Supabase service configuration.");
  }

  let response;
  try {
    response = await fetchSchema(schemaUrl, {
      method: "GET",
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Accept: "application/openapi+json" },
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
      cache: "no-store",
    });
  } catch {
    // Fetch exceptions can contain request URLs or headers. Never log them.
    throw new Error("Production check-in preflight could not read the database schema. Keep the current deployment live and retry after database access recovers.");
  }
  if (!response.ok) {
    throw new Error(`Production check-in preflight failed (HTTP ${response.status}). Keep the current deployment live; verify database access before rebuilding.`);
  }
  let schema;
  try {
    schema = await response.json();
  } catch {
    throw new Error("Production check-in preflight received invalid schema metadata. Keep the current deployment live.");
  }
  if (!supportsCheckins(schema)) {
    throw new Error(`Production check-ins require ${MIGRATION} before this application can be released. Keep the legacy deployment live, apply the migration only with approval, then create a fresh Production build.`);
  }
}
