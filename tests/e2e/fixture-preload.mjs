// Next's dev-server restart keeps only the last repeated preload option.
// Load the fixture overrides through one entry so the clock stays frozen.
import http from "node:http";
import "./freeze-time.cjs";

// Test clients reuse keep-alive sockets across slow steps. Under Node's 5-second default the dev
// server can close one just as a request reuses it, which reads as ECONNRESET, and `next dev` has
// no keep-alive option. Here only clients close idle sockets, as on the mock server.
const createServer = http.createServer;
http.createServer = function fixtureCreateServer(...args) {
  const server = createServer.apply(this, args);
  server.keepAliveTimeout = 0;
  return server;
};

// Loaded only by the local fixture server. Exercise the real check-in route
// without sending a token or secret to Cloudflare.
const originalFetch = global.fetch;

global.fetch = async function fixtureFetch(input, options) {
  const url = input instanceof Request ? input.url : String(input);
  const hostname = new URL(url).hostname;
  // The harness uses a dummy key to render connected settings. Provider
  // requests must remain local: no budget lookups, prompts, or paid inference.
  if (hostname === "openrouter.ai" || hostname.endsWith(".openrouter.ai")) {
    return Response.json({ error: { code: 401, message: "OpenRouter is disabled in fixture tests" } }, { status: 401 });
  }
  if (url !== "https://challenges.cloudflare.com/turnstile/v0/siteverify") {
    return originalFetch(input, options);
  }

  const body = new URLSearchParams(options?.body);
  if (body.get("secret") === "mock-problem-turnstile-secret") {
    // Real Siteverify accepted one problem-report token repeatedly in local
    // checks, so this stub accepts reuse too. The database must refuse replays.
    const success = options?.method === "POST" && (body.get("response") ?? "").startsWith("stub-problem-");
    return Response.json({ success, hostname: "crimsonreporthub.com", action: "problem_report" });
  }
  const success = options?.method === "POST"
    && body.get("secret") === "mock-turnstile-secret"
    && /^stub-token-/.test(body.get("response") ?? "");
  // Cloudflare names the host that served the widget; the route accepts only the public domain.
  return new Response(JSON.stringify(success ? { success, hostname: "crimsonreporthub.com" } : { success }), {
    headers: { "content-type": "application/json" },
  });
};
