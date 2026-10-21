import { createHash, createHmac } from "node:crypto";
import { isIP } from "node:net";

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

/** Lowercase hex groups with the longest zero run compressed, as URLs write them. */
function canonicalIpv6(address: string): string {
  return new URL(`http://[${address}]/`).hostname.slice(1, -1);
}

/**
 * The network a client address counts as in per-network keys, or null when the
 * value is not one IP address. IPv4 stays as sent, also when written as an
 * IPv4-mapped IPv6 address. One IPv6 connection usually holds a whole /64, so
 * every address in it maps to that prefix.
 */
export function ipNetwork(address: string): string | null {
  const family = isIP(address);
  if (family === 4) return address;
  if (family !== 6) return null;
  let canonical: string;
  try {
    // A zone ID (fe80::1%eth0) names the sender's interface, not a network.
    canonical = canonicalIpv6(address.split("%", 1)[0]);
  } catch {
    return null;
  }
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(canonical);
  if (mapped) {
    const [high, low] = [parseInt(mapped[1], 16), parseInt(mapped[2], 16)];
    return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
  }
  const [head, tail] = canonical.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = [...left, ...Array<string>(8 - left.length - right.length).fill("0"), ...right];
  return `${canonicalIpv6(`${groups.slice(0, 4).join(":")}::`)}/64`;
}

export function externalIdHash(source: string, externalId: string): string {
  return createHash("sha256").update(`${source}:${externalId}`).digest("hex");
}

/**
 * A keyed one-way hash of a forum author's display name, so separate threads
 * from one player can be told apart without storing who wrote them. Case and
 * spacing are ignored. Null for an empty name or a missing secret.
 */
export function forumAuthorKey(displayName: string, secret: string | undefined): string | null {
  const name = displayName.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
  const key = secret?.trim();
  if (!name || !key) return null;
  return createHmac("sha256", key).update(`forum-author:${name}`).digest("hex");
}
