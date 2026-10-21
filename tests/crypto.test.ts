import { describe, expect, it } from "vitest";
import { forumAuthorKey, hashIp, ipNetwork, normalizeTitle, reportFingerprint } from "@/lib/crypto";

describe("normalizeTitle", () => {
  it("lowercases, strips punctuation, collapses whitespace", () => {
    expect(normalizeTitle("  FPS   DROPS!!! since 1.13  ")).toBe("fps drops since 113");
  });
});

describe("reportFingerprint", () => {
  it("is stable for equivalent titles", () => {
    const a = reportFingerprint("performance", "ps5", "FPS drops since 1.13");
    const b = reportFingerprint("performance", "ps5", "fps DROPS since 1.13!!");
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it("differs across category or platform", () => {
    const a = reportFingerprint("performance", "ps5", "fps drops");
    expect(reportFingerprint("crash_startup", "ps5", "fps drops")).not.toBe(a);
    expect(reportFingerprint("performance", "pc_steam", "fps drops")).not.toBe(a);
  });
});

describe("hashIp", () => {
  it("is deterministic per secret and never contains the raw ip", () => {
    const h = hashIp("203.0.113.7", "secret1");
    expect(h).toBe(hashIp("203.0.113.7", "secret1"));
    expect(h).not.toBe(hashIp("203.0.113.7", "secret2"));
    expect(h).not.toContain("203");
    expect(h).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("ipNetwork", () => {
  it("keeps an IPv4 address as sent", () => {
    expect(ipNetwork("203.0.113.7")).toBe("203.0.113.7");
  });

  it.each(["::ffff:203.0.113.7", "::FFFF:cb00:7107", "0:0:0:0:0:ffff:203.0.113.7"])(
    "reads the IPv4-mapped address %s as its IPv4 address",
    (address) => expect(ipNetwork(address)).toBe("203.0.113.7"),
  );

  it.each([
    "2001:db8:1:2::7",
    "2001:0db8:0001:0002:0000:0000:0000:0007",
    "2001:DB8:1:2:AbCd:Ef01:2345:6789",
    "2001:db8:1:2::7%eth0",
  ])("reduces the IPv6 spelling %s to its canonical /64", (address) => {
    expect(ipNetwork(address)).toBe("2001:db8:1:2::/64");
  });

  it("compresses zero groups inside the prefix", () => {
    expect(ipNetwork("2001:db8:0:0:1:2:3:4")).toBe("2001:db8::/64");
    expect(ipNetwork("0:0:0:1::1")).toBe("0:0:0:1::/64");
    expect(ipNetwork("fe80::1%eth0")).toBe("fe80::/64");
    expect(ipNetwork("::1")).toBe("::/64");
  });

  it("gives two addresses in one /64 the same network hash, and another /64 a different one", () => {
    const key = (address: string) => hashIp(ipNetwork(address) as string, "secret1");
    expect(key("2001:db8:1:2::1")).toBe(key("2001:db8:1:2:ffff:ffff:ffff:ffff"));
    expect(key("2001:db8:1:3::1")).not.toBe(key("2001:db8:1:2::1"));
  });

  it.each([
    "", "unknown", "203.0.113.7, 198.51.100.1", " 203.0.113.7", "203.0.113.7:443", "203.0.113.07",
    "203.0.113.7%eth0", "[2001:db8::1]", "2001:db8::1::2", "2001:db8::1/64", "fe80::1%", "2001:db8::g",
  ])("rejects %j", (value) => {
    expect(ipNetwork(value)).toBeNull();
  });
});

describe("forumAuthorKey", () => {
  it("is a keyed hash that ignores case and spacing", () => {
    const key = forumAuthorKey("Desert Rider", "secret-one");
    expect(key).toMatch(/^[a-f0-9]{64}$/);
    expect(forumAuthorKey("  desert   RIDER ", "secret-one")).toBe(key);
    expect(forumAuthorKey("Desert Rider", "secret-two")).not.toBe(key);
    expect(forumAuthorKey("Desert Rider 2", "secret-one")).not.toBe(key);
    expect(key).not.toContain("desert");
  });

  it("returns null without a name or a secret", () => {
    expect(forumAuthorKey("   ", "secret-one")).toBeNull();
    expect(forumAuthorKey("Desert Rider", undefined)).toBeNull();
    expect(forumAuthorKey("Desert Rider", "  ")).toBeNull();
  });
});
