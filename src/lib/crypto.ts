import { createHash } from "node:crypto";

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function reportFingerprint(category: string, platform: string, title: string): string {
  return createHash("sha256").update(`${category}|${platform}|${normalizeTitle(title)}`).digest("hex");
}

/** Salted one-way hash. We never store raw IPs. */
export function hashIp(ip: string, secret: string): string {
  return createHash("sha256").update(`${secret}:${ip}`).digest("hex");
}

export function externalIdHash(source: string, externalId: string): string {
  return createHash("sha256").update(`${source}:${externalId}`).digest("hex");
}
