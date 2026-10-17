create or replace function public.set_current_patch_override(
  p_patch_version text,
  p_observed_at timestamptz
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_patch_version is null or p_patch_version !~ '^[0-9]+\.[0-9]{1,2}(\.[0-9]{1,2})?$' then
    raise exception 'invalid patch version';
  end if;
  if p_observed_at is null then
    raise exception 'observed time is required';
  end if;

  -- Serialize the singleton current row. If any later statement fails, the
  -- function call rolls this update back instead of leaving no current patch.
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
    'manual-' || p_patch_version,
    'Manual override: Patch ' || p_patch_version,
    p_patch_version,
    'https://crimsondesert.pearlabyss.com/en-US/News/Notice',
    null,
    null,
    p_observed_at,
    true
  )
  on conflict (board_no)
  do update set
    title = excluded.title,
    patch_version = excluded.patch_version,
    official_url = excluded.official_url,
    published_at = null,
    summary = null,
    observed_at = excluded.observed_at,
    is_current = true;
end;
$$;

revoke all on function public.set_current_patch_override(text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.set_current_patch_override(text, timestamptz)
  to service_role;
