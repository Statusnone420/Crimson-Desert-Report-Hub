#!/usr/bin/env node

const { editorialSourceById } = await import("../src/lib/editorialSources.ts");
const { discoverEditorialYoutube } = await import("../src/lib/editorialYoutube.ts");

try {
  const source = editorialSourceById("khraze-gaming");
  if (!source?.verifiedChannelId) throw new Error("KhrazeGaming source registry entry has no verified channel ID");
  const candidates = await discoverEditorialYoutube({ allowedChannelId: source.verifiedChannelId });
  process.stdout.write(`${JSON.stringify({ channelId: source.verifiedChannelId, candidates }, null, 2)}\n`);
} catch (error) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "error";
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[editorial-preview] ${code}: ${message}\n`);
  process.exitCode = 1;
}
