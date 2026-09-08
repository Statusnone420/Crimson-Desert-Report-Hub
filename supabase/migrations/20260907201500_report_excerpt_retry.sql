-- Idempotent excerpt-only retry after a report approval has already committed.
create or replace function public.save_approved_report_excerpt(p_report_id uuid, p_excerpt text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  report_status text;
  clean_excerpt text := btrim(p_excerpt);
begin
  if clean_excerpt is null or char_length(clean_excerpt) not between 1 and 500 then
    raise exception 'excerpt must contain 1 to 500 characters' using errcode = '22023';
  end if;
  select moderation_status into report_status from public.bug_reports
    where id = p_report_id for update;
  if not found or report_status <> 'approved' then
    raise exception 'report is missing or no longer approved' using errcode = '22023';
  end if;
  if not exists (select 1 from public.approved_excerpts where report_id = p_report_id) then
    insert into public.approved_excerpts (report_id, excerpt_text) values (p_report_id, clean_excerpt);
  end if;
end;
$$;
revoke all on function public.save_approved_report_excerpt(uuid, text) from public, anon, authenticated;
grant execute on function public.save_approved_report_excerpt(uuid, text) to service_role;
