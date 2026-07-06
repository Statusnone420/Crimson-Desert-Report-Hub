import { revalidatePath, revalidateTag } from "next/cache";
import { NextResponse, after } from "next/server";
import { isAdmin } from "@/lib/adminGuard";
import { startAutomationScan } from "@/lib/automation/run";
import { CURRENT_PATCH_TAG, PUBLIC_DASHBOARD_TAG, PUBLIC_ISSUES_TAG } from "@/lib/cacheTags";
import { isVercelPreview } from "@/lib/previewGuard";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function revalidatePublicSurfaces(): void {
  try {
    revalidateTag(PUBLIC_DASHBOARD_TAG, "max");
    revalidateTag(PUBLIC_ISSUES_TAG, "max");
    revalidateTag(CURRENT_PATCH_TAG, "max");
    revalidatePath("/");
    revalidatePath("/issues");
  } catch {
    // pages self-revalidate within 5 minutes regardless
  }
}

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

  const started = await startAutomationScan({ mode });
  if (started.status === "already_running") {
    return NextResponse.json({ error: "scan_already_running" }, { status: 409 });
  }

  after(async () => {
    await started.completion;
    if (mode === "manual") revalidatePublicSurfaces();
  });

  return NextResponse.json({ runId: started.runId });
}
