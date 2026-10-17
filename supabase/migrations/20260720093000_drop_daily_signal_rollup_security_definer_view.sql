-- Supabase security advisor: remove the public owner-evaluated aggregate view.
-- The application now computes the same day-level DTO in its server-only data
-- access layer with the service role, so raw tables remain private without a
-- security-definer view exposed through PostgREST.

drop view if exists public.daily_signal_rollup;
