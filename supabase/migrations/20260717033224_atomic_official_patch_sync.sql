-- Keep the current official patch transition atomic. The partial unique index
-- on official_patch_notes(is_current) means the old row must be cleared before
-- the replacement can become current, so both statements belong in one RPC.
create or replace function public.sync_official_patch_note(
  p_board_no text,
  p_title text,
  p_patch_version text,
  p_official_url text,
  p_published_at timestamptz,
  p_summary text,
  p_observed_at timestamptz
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_board_no is null or pg_catalog.btrim(p_board_no) = '' then
    raise exception 'board number is required' using errcode = '22023';
  end if;
  if p_title is null or pg_catalog.btrim(p_title) = '' then
    raise exception 'patch title is required' using errcode = '22023';
  end if;
  if p_official_url is null or pg_catalog.btrim(p_official_url) = '' then
    raise exception 'official URL is required' using errcode = '22023';
  end if;
  if p_patch_version is null or p_patch_version !~ '^[0-9]+\.[0-9]{1,2}(\.[0-9]{1,2})?$' then
    raise exception 'invalid patch version' using errcode = '22023';
  end if;
  if p_observed_at is null then
    raise exception 'observed time is required' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('official_patch_notes_current', 0)
  );

  update public.official_patch_notes
  set is_current = false
  where is_current = true;

  insert into public.official_patch_notes (
    board_no,
    title,
    patch_version,
    official_url,
    published_at,
    summary,
    observed_at,
    is_current
  ) values (
    p_board_no,
    p_title,
    p_patch_version,
    p_official_url,
    p_published_at,
    p_summary,
    p_observed_at,
    true
  )
  on conflict (board_no)
  do update set
    title = excluded.title,
    patch_version = excluded.patch_version,
    official_url = excluded.official_url,
    published_at = excluded.published_at,
    summary = excluded.summary,
    observed_at = excluded.observed_at,
    is_current = true;
end;
$$;

revoke all on function public.sync_official_patch_note(text, text, text, text, timestamptz, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.sync_official_patch_note(text, text, text, text, timestamptz, text, timestamptz)
  to service_role;
