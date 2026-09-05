import "server-only";

import { revalidatePath, revalidateTag } from "next/cache";
import { CURRENT_PATCH_TAG, PUBLIC_DASHBOARD_TAG, PUBLIC_ISSUES_TAG } from "@/lib/cacheTags";

/**
 * Canonical "refresh everything the public sees" list. Every caller gets the
 * same tags and paths on purpose — per-caller copies had already drifted.
 */
export function revalidatePublicSurfaces(): void {
  try {
    revalidateTag(PUBLIC_DASHBOARD_TAG, "max");
    revalidateTag(PUBLIC_ISSUES_TAG, "max");
    revalidateTag(CURRENT_PATCH_TAG, "max");
    revalidatePath("/");
    revalidatePath("/issues");
    revalidatePath("/report");
    revalidatePath("/scanner");
    revalidatePath("/patches");
    revalidatePath("/observatory");
  } catch {
    // pages self-revalidate within 5 minutes regardless
  }
}
