/**
 * Local-only SQL concurrency proof. Requires the running CD_Report_Hub Docker
 * stack, current migrations, and an empty login ledger after `db:reset --local`.
 * Run: node scripts/test-admin-login-concurrency.mjs
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { setTimeout } from "node:timers/promises";

const container = "supabase_db_CD_Report_Hub";
const runId = randomBytes(6).toString("hex");
const prefix = `admin-login-concurrency-${runId}`;
const identity = (label) => createHash("sha256").update(`${runId}:${label}`).digest("hex");

function connection(sql, keepOpen = false) {
  const child = spawn("docker", ["exec", "-i", container, "psql", "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], {
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let output = "";
  let errors = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { errors += chunk; });
  const done = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve(output.trim());
      else reject(new Error(`Local psql exited ${code}: ${errors.trim()}`));
    });
  });
  // Observe failures while waiting for the synchronization barrier.
  done.catch(() => {});
  child.stdin.write(`${sql}\n`);
  if (!keepOpen) child.stdin.end();
  return { child, done, output: () => output };
}

const query = (sql) => connection(sql).done;

async function waitFor(check) {
  const deadline = Date.now() + 15_000;
  while (!(await check())) {
    assert.ok(Date.now() < deadline, "Independent SQL sessions did not reach the local barrier");
    await setTimeout(50);
  }
}

async function burst(name, addresses) {
  // A separate shared lock releases every session together, before the RPC's
  // own two-second lock timeout starts. Each Docker psql has its own DB backend.
  const barrier = connection("begin; select pg_advisory_xact_lock(20261002, 2); select 'barrier-ready';", true);
  const requests = [];
  try {
    await waitFor(() => barrier.output().includes("barrier-ready"));
    for (const [index, address] of addresses.entries()) {
      requests.push(connection(`
        begin;
        set local application_name = '${prefix}-${name}-${index}';
        set local statement_timeout = '20s';
        set local role service_role;
        select pg_advisory_xact_lock_shared(20261002, 2);
        select json_build_object('pid', pg_backend_pid(), 'reservation', public.reserve_admin_login_attempt('${address}'));
        commit;
      `));
    }
    await waitFor(async () => Number(await query(`
      select count(*) from pg_stat_activity
      where application_name like '${prefix}-${name}-%' and wait_event = 'advisory';
    `)) === requests.length);
    barrier.child.stdin.end("commit;\n");
    await barrier.done;
    const results = (await Promise.all(requests.map(({ done }) => done))).map((output) => JSON.parse(output));
    assert.equal(new Set(results.map(({ pid }) => pid)).size, addresses.length, "Every request must use an independent DB connection");
    for (const { reservation } of results) {
      assert.equal(typeof reservation.allowed, "boolean");
      assert.ok(Number.isInteger(reservation.retry_after));
      if (reservation.allowed) assert.equal(reservation.retry_after, 0);
      else assert.ok(reservation.retry_after >= 1 && reservation.retry_after <= 900);
    }
    return results.filter(({ reservation }) => reservation.allowed).length;
  } finally {
    if (!barrier.child.stdin.writableEnded) barrier.child.stdin.end("rollback;\n");
    await Promise.allSettled([barrier.done, ...requests.map(({ done }) => done)]);
  }
}

async function scenario(name, seeds, addresses, expectedTotal) {
  const hashes = [...new Set([...seeds, ...addresses])];
  const quotedHashes = hashes.map((hash) => `'${hash}'`).join(",");
  try {
    if (seeds.length) {
      const accepted = await query(`
        begin;
        set local role service_role;
        select public.reserve_admin_login_attempt(address_hash) ->> 'allowed'
        from (values ${seeds.map((hash) => `('${hash}')`).join(",")}) seed(address_hash);
        commit;
      `);
      assert.deepEqual(accepted.split(/\r?\n/), seeds.map(() => "true"), "Every baseline reservation must succeed");
    }
    const admitted = await burst(name, addresses);
    assert.equal(admitted, expectedTotal - seeds.length, "Concurrent requests must fill only remaining capacity");
    assert.equal(Number(await query("select count(*) from public.admin_login_attempts;")), expectedTotal, "Denied requests must not grow the ledger");
    assert.ok(Number(await query("select coalesce(max(attempts), 0) from (select count(*) attempts from public.admin_login_attempts group by address_hash) counts;")) <= 5, "No address can exceed five reservations");
    console.log(`${name}: ${addresses.length} synchronized independent SQL sessions; ${admitted} accepted, ${addresses.length - admitted} denied; ${expectedTotal} ledger rows`);
  } finally {
    // Delete only the invented identities belonging to this scenario.
    await query(`delete from public.admin_login_attempts where address_hash in (${quotedHashes});`);
  }
  assert.equal(Number(await query("select count(*) from public.admin_login_attempts;")), 0, "Fixture cleanup must leave the local ledger empty");
}

async function main() {
  assert.equal(process.argv.length, 2, "This proof accepts no database URLs or credentials");
  assert.equal(Number(await query("select count(*) from public.admin_login_attempts;")), 0, "Run db:reset --local first; existing attempts will not be deleted");
  await scenario("same-address", [], Array(16).fill(identity("shared-address")), 5);
  await scenario("rotated-addresses", Array.from({ length: 25 }, (_, i) => identity(`seed-${i}`)), Array.from({ length: 16 }, (_, i) => identity(`rotated-${i}`)), 30);
  console.log("PASS: concurrent address and global limits; denied ledger growth; service-role RPC; fixture cleanup");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
