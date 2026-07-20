-- Advisor P3 (2026-07-20): covering indexes for the two run_id foreign keys
-- flagged by the Supabase performance linter. Applied to production via MCP
-- the same day; this file exists for migration-history parity.
create index if not exists idx_automation_rejected_candidates_run_id
  on public.automation_rejected_candidates (run_id);

create index if not exists idx_signal_observation_events_run_id
  on public.signal_observation_events (run_id);
