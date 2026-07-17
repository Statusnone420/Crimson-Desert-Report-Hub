-- Keep official patch metadata and its claimed-fix replacement in the same
-- transaction. A patch switch must never become visible without its matching
-- claimed-fix rows.
create or replace function public.sync_official_patch_note_with_claimed_fixes(
  p_board_no text,
  p_title text,
  p_patch_version text,
  p_official_url text,
  p_published_at timestamptz,
  p_summary text,
  p_observed_at timestamptz,
  p_claimed_fixes jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  fix jsonb;
  fix_position integer;
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
  if p_claimed_fixes is null or pg_catalog.jsonb_typeof(p_claimed_fixes) <> 'array' then
    raise exception 'claimed fixes must be a JSON array' using errcode = '22023';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_claimed_fixes) as items(value)
    where pg_catalog.jsonb_typeof(items.value) <> 'object'
  ) then
    raise exception 'claimed fixes must contain JSON objects' using errcode = '22023';
  end if;

  -- Validate every fix before changing either table. The transaction also
  -- protects this invariant if a later insert encounters a database error.
  for fix in
    select items.value
    from pg_catalog.jsonb_array_elements(p_claimed_fixes) as items(value)
  loop
    if fix->>'fix_text' is null or pg_catalog.btrim(fix->>'fix_text') = '' then
      raise exception 'claimed fix text is required' using errcode = '22023';
    end if;
  end loop;

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

  delete from public.official_patch_claimed_fixes
  where board_no = p_board_no;

  for fix, fix_position in
    select items.value, (items.ordinal - 1)::integer
    from pg_catalog.jsonb_array_elements(p_claimed_fixes)
      with ordinality as items(value, ordinal)
    order by items.ordinal
  loop
    insert into public.official_patch_claimed_fixes (
      board_no,
      position,
      fix_text,
      category
    ) values (
      p_board_no,
      fix_position,
      fix->>'fix_text',
      nullif(fix->>'category', '')
    );
  end loop;
end;
$$;

revoke all on function public.sync_official_patch_note_with_claimed_fixes(
  text, text, text, text, timestamptz, text, timestamptz, jsonb
)
  from public, anon, authenticated;
grant execute on function public.sync_official_patch_note_with_claimed_fixes(
  text, text, text, text, timestamptz, text, timestamptz, jsonb
)
  to service_role;
