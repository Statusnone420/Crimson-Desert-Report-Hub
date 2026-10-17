import { describe, expect, it } from "vitest";
import { encrypt, decrypt } from "../scripts/backup/archive.mjs";
import { readTables, rowDigest, requirePublicTables, requireIsolatedContainer } from "../scripts/backup/proof.mjs";

describe("database backup recovery", () => {
  it("recovers binary payloads and rejects wrong passwords, tampering and truncation", () => {
    const password = "fixture-passphrase-not-a-real-secret";
    const payload = Buffer.from([0, 255, 10, 13, 128, 1]);
    const archive = encrypt(payload, password);
    expect(decrypt(archive, password)).toEqual(payload);
    expect(() => decrypt(archive, "wrong-password-for-this-fixture")).toThrow();
    const corrupted = Buffer.from(archive);
    corrupted[corrupted.length - 17] ^= 1;
    expect(() => decrypt(corrupted, password)).toThrow();
    expect(() => decrypt(archive.subarray(0, 20), password)).toThrow();
  });

  it("counts COPY rows including duplicates and escaped newlines without depending on order", () => {
    const tables = readTables('COPY "public"."articles" ("id", "body") FROM stdin;\n2\tb\n1\ta\\nnext\n2\tb\n\\.\nCOPY "auth"."users" ("id") FROM stdin;\n\\.\n');
    expect(tables).toHaveLength(2);
    expect(tables[0].rows).toBe(3);
    expect(tables[0].sha256).toBe(rowDigest(["2\tb", "2\tb", "1\ta\\nnext"]));
    expect(tables[1].rows).toBe(0);
    expect(rowDigest(["a", "a"])).not.toBe(rowDigest(["a"]));
    expect(() => readTables('COPY "public"."articles" ("id") FROM stdin;\n1\n')).toThrow();
    expect(() => readTables('COPY "public"."unexpected-name" ("id") FROM stdin;\n\\.\n')).toThrow();
  });

  it("fails closed for missing application tables, including future additions", () => {
    const tables = readTables('COPY "public"."articles" ("id") FROM stdin;\n\\.\n');
    expect(() => requirePublicTables(tables, { tables: [{ schema: "public", name: "articles" }] })).not.toThrow();
    expect(() => requirePublicTables(tables, { tables: [{ schema: "public", name: "articles" }, { schema: "public", name: "new_table" }] })).toThrow();
    expect(() => requirePublicTables([], { tables: [] })).toThrow();
  });

  it("rejects another container or network/host access before restoring or stopping it", () => {
    const valid = { Config: { Labels: { "crh.backup.run": "fixture" } }, HostConfig: { NetworkMode: "none", AutoRemove: true, PortBindings: {} }, Mounts: [] };
    expect(() => requireIsolatedContainer(valid, "fixture")).not.toThrow();
    expect(() => requireIsolatedContainer(valid, "different-run")).toThrow();
    expect(() => requireIsolatedContainer({ ...valid, HostConfig: { ...valid.HostConfig, NetworkMode: "default" } }, "fixture")).toThrow();
    expect(() => requireIsolatedContainer({ ...valid, Mounts: [{ Type: "bind" }] }, "fixture")).toThrow();
  });
});
