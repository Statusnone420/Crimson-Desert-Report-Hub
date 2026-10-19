import "server-only";

import { revalidatePath, revalidateTag } from "next/cache";
import { CURRENT_PATCH_TAG, EDITORIALS_TAG, PUBLIC_DASHBOARD_TAG, PUBLIC_ISSUES_TAG } from "@/lib/cacheTags";

/**
 * Canonical "refresh everything the public sees" list. Every caller gets the
 * same tags and paths on purpose — per-caller copies had already drifted.
 */
export function revalidatePublicSurfaces(): void {
  try {
    revalidateTag(PUBLIC_DASHBOARD_TAG, "max");
    revalidateTag(PUBLIC_ISSUES_TAG, "max");
    revalidateTag(CURRENT_PATCH_TAG, { expire: 0 });
    revalidatePath("/");
    revalidatePath("/issues");
    revalidatePath("/report");
    revalidatePath("/scanner");
    revalidatePath("/patches");
    revalidatePath("/patches/[version]", "page");
    revalidatePath("/articles/[slug]", "page");
    revalidatePath("/catch-up");
    revalidatePath("/news");
    revalidatePath("/rss.xml");
    revalidatePath("/feed.xml");
    revalidatePath("/sitemap.xml");
    revalidatePath("/observatory");
  } catch {
    // pages self-revalidate within 5 minutes regardless
  }
}

/** After an edition is approved or vetoed: everything public, plus the column's own pages and cache. */
export function revalidateEditorials(): void {
  revalidatePublicSurfaces();
  try {
    revalidateTag(EDITORIALS_TAG, { expire: 0 });
    revalidatePath("/editorials/[slug]", "page");
  } catch {
    // pages self-revalidate within 5 minutes regardless
  }
}
