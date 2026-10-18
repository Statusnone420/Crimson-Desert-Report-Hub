import "server-only";

import { after } from "next/server";
import { hasCronAuthorization } from "@/lib/cronAuth";
import { columnFailureCode, runColumn, type ColumnRunOutcome } from "@/lib/editorials/run.server";
import { isVercelPreview } from "@/lib/previewGuard";

/** The keepalive route's maxDuration. The column must finish inside it. */
export const KEEPALIVE_MAX_MS = 300_000;
/** Time kept back for the platform to close the function cleanly. */
export const KEEPALIVE_SAFETY_MS = 20_000;

/** Only a real, authorized production wake runs the column. */
function wakeAllowed(req: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  return Boolean(secret) && hasCronAuthorization(req, secret!) && !isVercelPreview();
}

/** Resolves with null at the deadline, so a slow call can never hold the function open. */
function withDeadline<T>(work: Promise<T>, deadlineMs: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), Math.max(0, deadlineMs - Date.now())); });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

export async function runColumnWithinDeadline(startedAtMs: number): Promise<void> {
  const deadlineMs = startedAtMs + KEEPALIVE_MAX_MS - KEEPALIVE_SAFETY_MS;
  try {
    const outcome: ColumnRunOutcome | null = await withDeadline(runColumn({ now: new Date(), deadlineMs }), deadlineMs);
    console.info(JSON.stringify({ event: "column_run", ...(outcome ?? { status: "deadline" }) }));
  } catch (error) {
    console.warn(JSON.stringify({ event: "column_run_failed", code: columnFailureCode(error) }));
  }
}

/**
 * Called once by the keepalive route after the scan has answered. The column runs after
 * the response is sent, outside the scanner's execution context, so it can't change the
 * scan's response, alerts or counters, and any failure stays inside the column.
 */
export function scheduleColumnAfterKeepalive(req: Request, startedAtMs: number): void {
  try {
    if (!wakeAllowed(req)) return;
    after(() => runColumnWithinDeadline(startedAtMs));
  } catch {
    console.warn(JSON.stringify({ event: "column_hook_unavailable" }));
  }
}
