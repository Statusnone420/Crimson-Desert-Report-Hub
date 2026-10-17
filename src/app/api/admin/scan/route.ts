import { NextResponse, after } from "next/server";
import { isAdmin } from "@/lib/adminGuard";
import { startAutomationScan } from "@/lib/automation/run";
import { getAutomationControlState } from "@/lib/automation/settings";
import { isVercelPreview } from "@/lib/previewGuard";
import { revalidatePublicSurfaces } from "@/lib/revalidate";
import { scannerDiagnostic, type ScannerStage } from "@/lib/automation/diagnostics";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (isVercelPreview()) return NextResponse.json({ error: "preview_writes_disabled" }, { status: 403 });

  let mode = "";
  try {
    mode = String(((await req.json()) as { mode?: unknown }).mode ?? "");
  } catch {
    mode = "";
  }
  if (mode !== "manual" && mode !== "dry_run") {
    return NextResponse.json({ error: "bad_mode" }, { status: 400 });
  }

  const attemptId = crypto.randomUUID();
  let stage: ScannerStage = "policy_read";
  try {
    const scannerPolicy = await getAutomationControlState();
    stage = "scan";
    const started = await startAutomationScan({ mode, scannerPolicy, attemptId });
    if (started.status === "already_running") {
      return NextResponse.json({ error: "scan_already_running" }, { status: 409 });
    }

    after(async () => {
      await started.completion;
      if (mode === "manual") revalidatePublicSurfaces();
    });

    return NextResponse.json({ runId: started.runId });
  } catch (error) {
    const diagnostic = scannerDiagnostic(stage, error);
    console.error(JSON.stringify({ event: "scanner_manual_start_failed", attemptId, diagnostic }));
    return NextResponse.json({ error: "scan_start_failed", attemptId, diagnostic }, { status: 503 });
  }
}
