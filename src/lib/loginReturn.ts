import { OPERATOR_VIEWS, workspaceHref, type OperatorView } from "@/lib/operatorWorkspace";

/**
 * Where a completed sign-in may land. The login page reads ?from= off the URL,
 * so the value is attacker-suppliable; anything outside this exact list falls
 * back to the console home rather than turning sign-in into an open redirect.
 */
const RETURN_TARGETS = ["/admin", "/admin/compile", "/admin/videos", "/operator"] as const;

export function resolveLoginReturn(from: string | null | undefined): string {
  if (from === "/scanner") return workspaceHref("scanner");
  if (from?.startsWith("/operator?")) {
    const query = new URLSearchParams(from.slice("/operator?".length));
    const view = query.get("view");
    if (view && (OPERATOR_VIEWS as readonly string[]).includes(view) && query.getAll("view").length === 1) {
      const extra: Record<string, string> = {};
      for (const key of ["item", "run"]) {
        const value = query.get(key);
        if (value && value.length <= 200 && query.getAll(key).length === 1) extra[key] = value;
      }
      return workspaceHref(view as OperatorView, extra);
    }
  }
  return (RETURN_TARGETS as readonly string[]).includes(from ?? "") ? (from as string) : "/admin";
}
