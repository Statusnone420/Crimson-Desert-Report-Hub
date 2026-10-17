// Local-only companion to ai_settings_test.sql. Each connection rolls back.
// Run: node supabase/tests/ai_settings_concurrency.mjs
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";

function session() {
  const child = spawn("docker", ["exec", "-i", "supabase_db_CD_Report_Hub", "psql",
    "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose", "-U", "postgres", "-d", "postgres"],
  { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  return child;
}

const holder = session();
let holderOutput = "";
let holderError = "";
const holderDone = once(holder, "close");
holder.stderr.on("data", (data) => { holderError += data; });
const ready = new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("Local accounting lock was not acquired.")), 10_000);
  holder.stdout.on("data", (data) => {
    holderOutput += data;
    if (holderOutput.includes("ai-accounting-lock-held")) { clearTimeout(timeout); resolve(); }
  });
  holder.once("error", (error) => { clearTimeout(timeout); reject(error); });
  holder.once("close", () => { clearTimeout(timeout); reject(new Error(holderError || "Lock holder exited.")); });
});

try {
  holder.stdin.write("begin; select pg_advisory_xact_lock(661309132); select 'ai-accounting-lock-held';\n");
  await ready;
  const blocked = session();
  let blockedError = "";
  blocked.stderr.on("data", (data) => { blockedError += data; });
  const blockedDone = once(blocked, "close");
  blocked.stdin.end("begin; set local role service_role; select public.ai_test_reserve('90000000-0000-0000-0000-000000000001',0.01); rollback;\n");
  const [code] = await blockedDone;
  assert.notEqual(code, 0, "A second connection must not reserve while the accounting lock is owned.");
  assert.match(blockedError, /55P03.*canceling statement due to lock timeout/,
    "Reservation must stop on the shared accounting lock, before any paid-operation insert.");
} finally {
  holder.stdin.end("rollback;\n");
  await holderDone;
}
assert.equal(holderError, "", "The lock-holder transaction must roll back cleanly.");
console.log("PASS: a concurrent AI test reservation waits for the scanner accounting lock; all transactions rolled back.");
