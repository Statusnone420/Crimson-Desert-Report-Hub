import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/adminGuard";
import { isVercelPreview } from "@/lib/previewGuard";

export async function POST() {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isVercelPreview()) return NextResponse.json({ error: "not_found" }, { status: 404 });
  // Preview cannot save a reservation, so paid diagnostic dispatch is disabled.
  return NextResponse.json({ ok: false, error: "paid_diagnostics_disabled" }, { status: 403 });
}
