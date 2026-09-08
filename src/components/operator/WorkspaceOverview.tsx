import type { ReactNode } from "react";
import { workspaceHref } from "@/lib/operatorWorkspace";
import { WorkspaceIcon } from "@/components/operator/WorkspaceIcon";

export type WorkspaceDecisionView =
  "reports" | "claims" | "videos" | "dossiers";

export type WorkspaceDecisionRow = {
  id: string;
  view: WorkspaceDecisionView;
  title: string;
  detail: string;
  item?: string | null;
};

export type WorkspaceAvailability = {
  total: number | null;
  available: boolean;
};

export type WorkspaceActivityRow = {
  id: string;
  title: string;
  detail: string;
  occurredAt: string | null;
  view?: WorkspaceDecisionView;
};

export type WorkspaceOverviewProps = {
  decisions: WorkspaceDecisionRow[];
  availability: Record<WorkspaceDecisionView, WorkspaceAvailability>;
  health: ReactNode;
  recentActivity: WorkspaceActivityRow[];
  recentActivityAvailable: boolean;
};

const viewLabels: Record<WorkspaceDecisionView, string> = {
  reports: "Reports",
  claims: "Claim review",
  videos: "Videos",
  dossiers: "Dossiers",
};

function availabilityLabel(
  view: WorkspaceDecisionView,
  state: WorkspaceAvailability,
): string {
  if (!state.available) return "Unavailable";
  if (view === "dossiers") return "Optional compilation tool available";
  if (state.total === null) return "Pending-work total unknown";
  if (view === "reports")
    return `${state.total} report${state.total === 1 ? "" : "s"} awaiting review`;
  if (view === "claims")
    return `${state.total} claim decision${state.total === 1 ? "" : "s"} awaiting review`;
  return `${state.total} video${state.total === 1 ? "" : "s"} pending or draft ready`;
}

function decisionHref(row: WorkspaceDecisionRow): string {
  return workspaceHref(row.view, row.item ? { item: row.item } : undefined);
}

export function WorkspaceOverview({
  decisions,
  availability,
  health,
  recentActivity,
  recentActivityAvailable,
}: WorkspaceOverviewProps) {
  const decisionStatusUnknown = (
    ["reports", "claims", "videos"] as WorkspaceDecisionView[]
  ).some(
    (view) =>
      !availability[view].available || availability[view].total === null,
  );
  const knownTotal = (["reports", "claims", "videos"] as const).reduce(
    (total, view) => total + (availability[view].total ?? 0),
    0,
  );
  const visibleDecisions = decisions.filter(
    (row, index) =>
      decisions.slice(0, index).filter((previous) => previous.view === row.view)
        .length < 3,
  );
  return (
    <div className="workspace-page workspace-overview">
      <header className="workspace-heading">
        <div>
          <h1>Overview</h1>
          <p>Review what needs your decision, then check the scanner.</p>
        </div>
      </header>

      <div className="workspace-overview-grid">
        <section
          className="workspace-panel"
          aria-labelledby="owner-decisions-title"
        >
          <div className="workspace-panel-header">
            <div>
              <h2 id="owner-decisions-title">Waiting for you</h2>
              <p>
                {decisionStatusUnknown
                  ? "Some queues could not be read. Available decisions are shown below."
                  : `Showing ${visibleDecisions.length} of ${knownTotal} pending decisions. Open a queue for its full list.`}
              </p>
            </div>
          </div>
          <div className="workspace-queue">
            {decisions.length === 0 ? (
              <div className="workspace-empty">
                <h3>
                  {decisionStatusUnknown
                    ? "Owner decision status unavailable"
                    : knownTotal > 0 ? "Decisions are waiting" : "No decisions waiting"}
                </h3>
                <p>
                  {decisionStatusUnknown
                    ? "One or more pending-work reads are unavailable, so this page cannot confirm an empty decision list."
                    : knownTotal > 0 ? "Reload to fetch the current records. The queue counts still show pending work." : "The review queues are clear."}
                </p>
              </div>
            ) : (
              visibleDecisions.map((decision) => (
                <a
                  key={decision.id}
                  className="workspace-task-row"
                  href={decisionHref(decision)}
                >
                  <span className="workspace-task-icon" aria-hidden="true">
                    <WorkspaceIcon name={decision.view}/>
                  </span>
                  <span className="workspace-task-copy">
                    <strong>{decision.title}</strong>
                    <small>{decision.detail}</small>
                  </span>
                  <WorkspaceIcon name="arrow"/>
                </a>
              ))
            )}
          </div>
        </section>

        <div className="workspace-overview-rail">
          <section
            className="workspace-panel"
            aria-labelledby="scanner-health-title"
          >
            <div className="workspace-panel-header">
              <div>
                <h2 id="scanner-health-title">Scanner health</h2>
                <p>Current stored service and run records.</p>
              </div>
              <a className="workspace-button" href={workspaceHref("scanner")}>
                Open scanner
              </a>
            </div>
            <div className="workspace-panel-body">{health}</div>
          </section>

          <section
            className="workspace-panel"
            aria-labelledby="workspace-availability-title"
          >
            <div className="workspace-panel-header">
              <div>
                <h2 id="workspace-availability-title">Your queues</h2>
                <p>Open a queue to continue reviewing.</p>
              </div>
            </div>
            <div className="workspace-queue">
              {(Object.keys(viewLabels) as WorkspaceDecisionView[]).map(
                (view) => {
                  const state = availability[view];
                  return (
                    <a
                      key={view}
                      className="workspace-queue-item"
                      href={workspaceHref(view)}
                    >
                      <strong>{viewLabels[view]}</strong>
                      <small>{availabilityLabel(view, state)}</small>
                    </a>
                  );
                },
              )}
            </div>
          </section>
        </div>
      </div>

      <section
        className="workspace-panel"
        aria-labelledby="recent-activity-title"
      >
        <div className="workspace-panel-header">
          <div>
            <h2 id="recent-activity-title">Recent activity</h2>
            <p>Recorded activity is not an owner decision.</p>
          </div>
        </div>
        <div className="workspace-queue">
          {!recentActivityAvailable ? (
            <div className="workspace-empty">
              <h3>Recent activity unavailable</h3>
              <p>The automation history read failed. Reload to try again.</p>
            </div>
          ) : recentActivity.length === 0 ? (
            <div className="workspace-empty">
              <h3>No recent activity recorded</h3>
              <p>The automation history read succeeded and returned no records.</p>
            </div>
          ) : (
            recentActivity.map((activity) => {
              const content = (
                <>
                  <strong>{activity.title}</strong>
                  <small>
                    {activity.detail}
                    {activity.occurredAt ? ` · ${activity.occurredAt}` : ""}
                  </small>
                </>
              );
              return activity.view ? (
                <a
                  key={activity.id}
                  className="workspace-queue-item"
                  href={workspaceHref(activity.view)}
                >
                  {content}
                </a>
              ) : (
                <article key={activity.id} className="workspace-queue-item">
                  {content}
                </article>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
