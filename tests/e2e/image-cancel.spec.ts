import { connect } from "node:net";
import { expect, test } from "@playwright/test";

const IMAGE_ACCEPT = "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8";

test("an image variant still loads after the browser cancels its first request", async ({ request }, testInfo) => {
  // No page or warm-up asks for this variant, so this is its first request. Each project uses its own
  // width, so both projects send a first request even when they share a server.
  const width = testInfo.project.name === "mobile-chromium" ? 64 : 48;
  const variant = `/_next/image?url=%2Fofficial%2Flocalization.jpg&w=${width}&q=75`;
  const { host, hostname, port } = new URL(testInfo.project.use.baseURL!);
  // Send the request and drop the connection at once, as a browser does when it navigates away.
  await new Promise<void>((resolve, reject) => {
    const socket = connect(Number(port), hostname, () => {
      socket.end(`GET ${variant} HTTP/1.1\r\nHost: ${host}\r\nAccept: ${IMAGE_ACCEPT}\r\n\r\n`, () => {
        socket.destroy();
        resolve();
      });
    });
    socket.on("error", reject);
  });

  const response = await request.get(variant, { headers: { Accept: IMAGE_ACCEPT }, timeout: 10_000 });
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("image/webp");
});
