import type { OperatorView } from "@/lib/operatorWorkspace";

const paths: Record<OperatorView | "arrow" | "export" | "logout", React.ReactNode> = {
  overview: <><path d="m3 10 9-7 9 7v10H3z"/><path d="M9 20v-7h6v7"/></>,
  reports: <><path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 12h7M9 16h5"/></>,
  claims: <><path d="M9 3h6v4H9zM7 5H5v16h14V5h-2M8 13l3 3 5-6"/></>,
  scanner: <><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="m12 12 7-7M12 3v2M3 12h2M12 19v2M19 12h2"/></>,
  videos: <><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m10 9 5 3-5 3z"/></>,
  dossiers: <path d="M3 6h7l2 2h9v12H3zM3 8V4h7l2 2h9v2"/>,
  settings: <><path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="8" cy="18" r="2"/></>,
  arrow: <path d="m9 5 7 7-7 7"/>,
  export: <path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/>,
  logout: <path d="M9 4H4v16h5m6-12 4 4-4 4M8 12h11"/>,
};

export function WorkspaceIcon({ name }: { name: keyof typeof paths }) {
  return <svg className="workspace-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}
