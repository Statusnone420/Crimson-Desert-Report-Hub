export const OPERATOR_VIEWS = ["overview", "reports", "claims", "scanner", "videos", "dossiers", "settings"] as const;
export type OperatorView = (typeof OPERATOR_VIEWS)[number];

export function operatorView(value: string | string[] | undefined): OperatorView {
  return typeof value === "string" && (OPERATOR_VIEWS as readonly string[]).includes(value)
    ? value as OperatorView
    : "overview";
}

export function workspaceHref(view: OperatorView, extra?: Record<string, string>): string {
  const query = new URLSearchParams(view === "overview" ? {} : { view });
  for (const [key, value] of Object.entries(extra ?? {})) query.set(key, value);
  return `/operator${query.size ? `?${query}` : ""}`;
}

export const WORKSPACE_LABELS: Record<OperatorView, string> = {
  overview: "Overview", reports: "Reports", claims: "Claim review", scanner: "Scanner",
  videos: "Videos", dossiers: "Dossiers", settings: "Settings & tools",
};
