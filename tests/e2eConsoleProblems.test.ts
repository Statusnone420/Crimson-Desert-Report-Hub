import { readFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, test, vi } from "vitest";
import { collectConsoleProblems } from "./e2e/helpers";

// collectConsoleProblems reads the running spec's title from Playwright, which exists only in a Playwright worker.
vi.mock("@playwright/test", () => ({
  expect: vi.fn(),
  test: { info: () => ({ titlePath: ["e2e console problems"] }) },
}));

// Copied from a CI failure on GitHub's Windows runner, where Windows ran out of socket buffer space.
const HMR_SOCKET_URL = "ws://127.0.0.1:3100/_next/hmr?id=jhO9BTFwZPhlu4pDSY9uR";
const HMR_SOCKET_FAILURE = `WebSocket connection to '${HMR_SOCKET_URL}' failed: Error in connection establishment: net::ERR_NO_BUFFER_SPACE`;

function problemsFor(messages: Array<[type: "error" | "warning", text: string]>) {
  let onConsole: (message: unknown) => void = () => {};
  const page = {
    on: (event: string, handler: (message: unknown) => void) => {
      if (event === "console") onConsole = handler;
    },
  } as unknown as Page;
  const problems = collectConsoleProblems(page);
  for (const [type, text] of messages) onConsole({ type: () => type, text: () => text, location: () => ({ url: "" }) });
  return problems;
}

test("console checks skip the dev server's HMR socket failures", () => {
  expect(problemsFor([
    ["error", HMR_SOCKET_FAILURE],
    ["warning", `WebSocket connection to '${HMR_SOCKET_URL}' failed: WebSocket is closed before the connection is established.`],
  ])).toEqual([]);
});

test("console checks still report other socket failures and other messages that name the HMR path", () => {
  const otherSocket = "WebSocket connection to 'ws://127.0.0.1:3100/api/live' failed: Error in connection establishment: net::ERR_NO_BUFFER_SPACE";
  const blockedByPolicy = `Refused to connect to '${HMR_SOCKET_URL}' because it violates the following Content Security Policy directive: "connect-src 'self'".`;
  expect(problemsFor([["error", otherSocket], ["error", blockedByPolicy]])).toEqual([`error: ${otherSocket}`, `error: ${blockedByPolicy}`]);
});

test("the installed Next dev client opens its HMR socket at the path the console checks skip", () => {
  const client = readFileSync(
    path.join(process.cwd(), "node_modules", "next", "dist", "client", "dev", "hot-reloader", "app", "web-socket.js"),
    "utf8",
  );
  expect(
    client.includes(`${new URL(HMR_SOCKET_URL).pathname}?id=`),
    "Next's dev client no longer opens its HMR socket at this path. Update the skip in tests/e2e/helpers.ts and the sample above.",
  ).toBe(true);
});
