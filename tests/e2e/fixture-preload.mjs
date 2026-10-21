// Next's dev-server restart keeps only the last repeated preload option.
// Load the fixture overrides through one entry so the clock stays frozen.
import http from "node:http";
import "./freeze-time.cjs";

// Test clients reuse keep-alive sockets across slow steps. Under Node's 5-second default the dev
// server can close one just as a request reuses it, which reads as ECONNRESET, and `next dev` has
// no keep-alive option. Here only clients close idle sockets, as on the mock server.
const createServer = http.createServer;
http.createServer = function fixtureCreateServer(...args) {
  const index = args.findLastIndex((arg) => typeof arg === "function");
  if (index !== -1) args[index] = relayImages(args[index]);
  const server = createServer.apply(this, args);
  server.keepAliveTimeout = 0;
  return server;
};

// Before 16.4.0, Next reads a new image variant's source over the requesting browser's socket. If the
// browser cancels that first request, the variant never finishes and every later request for it hangs
// (https://github.com/vercel/next.js/pull/98168). So images are fetched by this process, which never
// cancels, and relayed. Remove this once next is 16.4.0 or later.
const RELAYED = "x-fixture-image-relay";
const HOP_BY_HOP = new Set(["connection", "keep-alive", "transfer-encoding"]);

function relayImages(listener) {
  return function relayImage(req, res) {
    if (req.headers[RELAYED] || !["GET", "HEAD"].includes(req.method) || !req.url?.startsWith("/_next/image?")) {
      return listener.call(this, req, res);
    }
    const fail = (error) => {
      console.error(`Image relay failed for ${req.url}:`, error);
      if (res.headersSent || res.destroyed) res.destroy();
      else res.writeHead(502).end();
    };
    const { address, port } = this.address();
    const relay = http.request({ host: address, port, method: req.method, path: req.url, headers: { ...req.headers, connection: "close", [RELAYED]: "1" } }, (response) => {
      const body = [];
      response.on("data", (chunk) => body.push(chunk));
      response.on("error", fail);
      response.on("end", () => {
        if (res.destroyed) return;
        const headers = Object.fromEntries(Object.entries(response.headers).filter(([name]) => !HOP_BY_HOP.has(name)));
        res.writeHead(response.statusCode, headers).end(Buffer.concat(body));
      });
    });
    relay.on("error", fail);
    relay.end();
  };
}

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
