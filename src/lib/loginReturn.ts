/**
 * Where a completed sign-in may land. The login page reads ?from= off the URL,
 * so the value is attacker-suppliable; anything outside this exact list falls
 * back to the console home rather than turning sign-in into an open redirect.
 */
const RETURN_TARGETS = ["/admin", "/admin/compile", "/admin/videos", "/scanner", "/operator"] as const;

export function resolveLoginReturn(from: string | null | undefined): string {
  return (RETURN_TARGETS as readonly string[]).includes(from ?? "") ? (from as string) : "/admin";
}
