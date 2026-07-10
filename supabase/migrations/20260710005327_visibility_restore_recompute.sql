-- 20260710001212 backfilled visibility_restore_is_public from effective
-- is_public, which is the FORCED value while an override is active, so
-- clearing an override to Auto could restore the forced state instead of the
-- engine-owned baseline. Recompute the restore baseline from the evidence the
-- engine itself uses: engine ownership (auto_public, never touched by the
-- forcing guards), an approved direct report (sufficient automatic evidence
-- per sync_approved_report_visibility), or a still-public source signal.
-- This is a no-op wherever no override is active (production had zero
-- overridden rows when the flawed backfill ran).
update public.issue_clusters as c
set
  visibility_restore_is_public = (
    c.auto_public
    or exists (
      select 1
      from public.bug_reports as r
      where r.cluster_id = c.id
        and r.moderation_status = 'approved'
    )
    or exists (
      select 1
      from public.source_signals as s
      where s.cluster_id = c.id
        and s.public_status = 'public'
    )
  ),
  -- Invalidate any in-flight refresh computed from the pre-recompute baseline.
  visibility_revision = c.visibility_revision + 1
where c.admin_visibility_override is not null;
