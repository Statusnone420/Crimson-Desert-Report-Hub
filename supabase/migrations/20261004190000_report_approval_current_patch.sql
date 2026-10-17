-- An approved report publishes its cluster only when it was filed on the current
-- patch family (same major.minor as the current official patch note), matching
-- the scanner's refresh rule. An approval from an earlier patch, or one made while
-- no current patch is recorded, only invalidates in-flight refreshes; the next
-- refresh decides visibility from the remaining evidence. Correcting the patch on
-- an approved report is judged the same way as a new approval.

create or replace function public.patch_family_key(p_version text)
returns text
language sql
immutable
set search_path to ''
as $$
  select (parts[1]::bigint)::text || '.' || (parts[2]::bigint)::text
  from (
    select pg_catalog.regexp_match(coalesce(p_version, ''), '(?:^|[^0-9.])([0-9]+)\.([0-9]{1,2})(?![0-9])') as parts
  ) as matched
  where parts is not null
$$;

create or replace function public.sync_approved_report_visibility()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare
  old_approved_cluster uuid;
  new_approved_cluster uuid;
  current_family text;
begin
  if tg_op in ('UPDATE', 'DELETE')
     and old.moderation_status = 'approved'
     and old.cluster_id is not null then
    old_approved_cluster := old.cluster_id;
  end if;

  if tg_op in ('INSERT', 'UPDATE')
     and new.moderation_status = 'approved'
     and new.cluster_id is not null then
    new_approved_cluster := new.cluster_id;
  end if;

  -- Moving or removing an approval invalidates any in-flight computation. It
  -- cannot blindly demote the old cluster because other evidence may qualify it.
  if old_approved_cluster is not null
     and old_approved_cluster is distinct from new_approved_cluster then
    update public.issue_clusters
    set visibility_revision = visibility_revision + 1
    where id = old_approved_cluster;
  end if;

  if new_approved_cluster is not null
     and (
       new_approved_cluster is distinct from old_approved_cluster
       or (tg_op = 'UPDATE' and new.patch_version is distinct from old.patch_version)
     ) then
    select public.patch_family_key(patch.patch_version)
    into current_family
    from public.official_patch_notes as patch
    where patch.is_current
    limit 1;

    if current_family is not null
       and public.patch_family_key(new.patch_version) = current_family then
      -- One approved current-patch report is sufficient automatic evidence. Under
      -- a forced override, advance the hidden automatic baseline without exposing it.
      update public.issue_clusters
      set
        auto_public = true,
        is_public = case
          when admin_visibility_override = 'force_hidden' then false
          else true
        end,
        visibility_restore_auto_public = case
          when admin_visibility_override is null then null
          else true
        end,
        visibility_restore_is_public = case
          when admin_visibility_override is null then null
          else true
        end,
        visibility_revision = visibility_revision + 1
      where id = new_approved_cluster;
    else
      update public.issue_clusters
      set visibility_revision = visibility_revision + 1
      where id = new_approved_cluster;
    end if;
  end if;

  return null;
end;
$function$;

-- Patch corrections take the same statement lock and row trigger as approvals.
drop trigger if exists trg_lock_report_visibility_update on public.bug_reports;
create trigger trg_lock_report_visibility_update
before update of moderation_status, cluster_id, patch_version on public.bug_reports
for each statement execute function public.lock_visibility_write_statement();

drop trigger if exists trg_sync_approved_report_visibility on public.bug_reports;
create trigger trg_sync_approved_report_visibility
after insert or update of moderation_status, cluster_id, patch_version or delete on public.bug_reports
for each row execute function public.sync_approved_report_visibility();
