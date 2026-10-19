-- Publish an approved test draft as a slot's edition. The editor reads a test draft,
-- gives it a thumbs up, then publishes it in place of the slot's skip. The test row
-- itself becomes the edition, so its text, slug, fact pack, check report and notes stay
-- together. Tests stay private until this function runs, and only for one row at a time.
-- Server code cannot delete an edition, so the skip it replaces is kept under the slot
-- key with ":replaced" added, which no schedule ever computes.
create function public.editorial_promote_test(p_id uuid, p_slot_key text)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_slot record;
begin
  if p_slot_key is null or p_slot_key !~ '^([0-9]{4}-W[0-9]{2}:(mon|tue|wed|thu|fri|sat|sun)|burst:[A-Za-z0-9_-]+:[0-9]{4}-[0-9]{2}-[0-9]{2})$' then
    return 'bad_slot';
  end if;

  -- A test draft that passed its fact check and was never scheduled or vetoed.
  perform 1 from public.editorials
    where id = p_id and is_test and status = 'held' and publish_at is null and vetoed_at is null
    for update;
  if not found then return 'not_promotable'; end if;

  -- Only while the editor's newest thumbs is up, as the column reads approvals
  -- everywhere: a later thumbs down withdraws one. Notes without a thumbs don't count.
  if (select rating from public.style_notes
        where editorial_id = p_id and rating is not null
        order by created_at desc limit 1) is distinct from 'up' then
    return 'not_approved';
  end if;

  -- The slot is empty or holds only a skip, which the draft replaces. The unique slot
  -- index stops a run that writes the slot at the same moment.
  select status, skip_reason, updated_at into v_slot from public.editorials
    where slot_key = p_slot_key and not is_test
    for update;
  if found and v_slot.status <> 'skipped' then return 'slot_taken'; end if;
  -- A scheduled run claims its slot as a writer_failed skip and fills that row minutes
  -- later. A claim this fresh may still be writing, so it is never replaced; an older one
  -- is a run that died.
  if found and v_slot.skip_reason = 'writer_failed' and v_slot.updated_at > now() - interval '30 minutes' then
    return 'slot_busy';
  end if;
  update public.editorials
    set slot_key = p_slot_key || ':replaced', updated_at = now()
    where slot_key = p_slot_key and not is_test and status = 'skipped';

  update public.editorials
    set is_test = false, slot_key = p_slot_key, status = 'published',
        publish_at = now(), published_at = now(), updated_at = now()
    where id = p_id;

  -- A draft the editor publishes counts as one approve-first approval, like editorial_approve.
  insert into public.automation_settings as s (key, value, updated_at)
    values ('column', '{"approveFirstRemaining": 2}'::jsonb, now())
    on conflict (key) do update set value = jsonb_set(
      s.value,
      '{approveFirstRemaining}',
      to_jsonb(greatest(
        case when jsonb_typeof(s.value->'approveFirstRemaining') = 'number'
          then floor((s.value->>'approveFirstRemaining')::numeric)::integer else 3 end - 1,
        0
      ))
    ), updated_at = now();
  return 'promoted';
end;
$$;

revoke all on function public.editorial_promote_test(uuid, text) from public, anon, authenticated;
grant execute on function public.editorial_promote_test(uuid, text) to service_role;
