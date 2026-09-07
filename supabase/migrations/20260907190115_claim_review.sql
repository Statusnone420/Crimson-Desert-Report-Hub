-- Durable private review for exact official claimed-fix pairings. The scanner
-- can propose mappings, but only this schema owns pairing state and its audit.

alter table public.issue_clusters
  add column if not exists lifecycle_revision bigint not null default 0,
  add constraint issue_clusters_lifecycle_revision_nonnegative check (lifecycle_revision >= 0);

create or replace function public.bump_issue_cluster_lifecycle_revision()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.fix_status is distinct from old.fix_status
     or new.fix_claimed_at is distinct from old.fix_claimed_at
     or new.fix_claimed_patch_version is distinct from old.fix_claimed_patch_version
     or new.admin_override is distinct from old.admin_override
     or new.lifecycle_reason is distinct from old.lifecycle_reason
     or new.is_public is distinct from old.is_public
     or new.slug is distinct from old.slug
     or new.title is distinct from old.title
     or new.category is distinct from old.category
     or new.description is distinct from old.description then
    new.lifecycle_revision := old.lifecycle_revision + 1;
  end if;
  return new;
end;
$$;

revoke all on function public.bump_issue_cluster_lifecycle_revision() from public, anon, authenticated;
grant execute on function public.bump_issue_cluster_lifecycle_revision() to service_role;

drop trigger if exists trg_issue_cluster_lifecycle_revision on public.issue_clusters;
create trigger trg_issue_cluster_lifecycle_revision
before update on public.issue_clusters
for each row execute function public.bump_issue_cluster_lifecycle_revision();

create table public.claim_review_pairings (
  id uuid primary key default gen_random_uuid(),
  pairing_key text not null unique check (char_length(pairing_key) = 101 and substring(pairing_key from 65 for 1) = chr(10)),
  claim_key text not null check (claim_key ~ '^[0-9a-f]{64}$'),
  board_no text not null,
  patch_version text not null,
  official_url text not null check (char_length(official_url) <= 2000),
  exact_official_text text not null check (char_length(btrim(exact_official_text)) between 1 and 4000),
  official_section text check (official_section is null or char_length(official_section) <= 240),
  cluster_id uuid not null references public.issue_clusters(id),
  cluster_slug text not null check (char_length(cluster_slug) between 1 and 160),
  cluster_title text not null check (char_length(cluster_title) between 1 and 240),
  cluster_category text not null check (char_length(cluster_category) between 1 and 80),
  cluster_lifecycle_revision bigint not null check (cluster_lifecycle_revision >= 0),
  proposal_kind text not null check (proposal_kind in ('llm_sure', 'llm_unsure', 'keyword_proposal')),
  proposal_reason text not null check (char_length(btrim(proposal_reason)) between 1 and 500),
  state text not null default 'pending' check (state in ('pending', 'later', 'confirmed', 'rejected', 'retired')),
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  seen_count integer not null default 1 check (seen_count >= 1),
  seen_by_operator_at timestamptz,
  rejected_reason text check (rejected_reason is null or char_length(btrim(rejected_reason)) between 3 and 500),
  confirmed_at timestamptz,
  claim_clock_owned boolean not null default false,
  retired_at timestamptz,
  retired_reason text,
  retired_rejection_reason text check (retired_rejection_reason is null or char_length(btrim(retired_rejection_reason)) between 3 and 500),
  revision integer not null default 1 check (revision >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((state = 'rejected') = (rejected_reason is not null)),
  check ((state = 'retired') = (retired_at is not null))
);

create index claim_review_pairings_active_idx
  on public.claim_review_pairings (state, first_seen_at, id)
  where state in ('pending', 'later');
create index claim_review_pairings_cluster_patch_idx
  on public.claim_review_pairings (cluster_id, patch_version, state);

create table public.claim_review_audit_events (
  id uuid primary key default gen_random_uuid(),
  pairing_id uuid not null references public.claim_review_pairings(id),
  pairing_key text not null,
  action text not null check (action in ('proposed', 'engine_confirmed', 'confirmed', 'rejected', 'later', 'undo_rejected', 'undo_later', 'undo_confirmed', 'retired')),
  actor text not null check (char_length(btrim(actor)) between 1 and 120),
  occurred_at timestamptz not null default now(),
  prior_state text check (prior_state is null or prior_state in ('pending', 'later', 'confirmed', 'rejected', 'retired')),
  state text not null check (state in ('pending', 'later', 'confirmed', 'rejected', 'retired')),
  claim_key text not null,
  patch_version text not null,
  exact_official_text text not null,
  cluster_id uuid not null,
  reason text check (reason is null or char_length(reason) <= 500)
);

create index claim_review_audit_events_pairing_idx on public.claim_review_audit_events (pairing_id, occurred_at desc, id);

create or replace function public.touch_claim_review_pairing()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' then new.revision := old.revision + 1; end if;
  return new;
end;
$$;

revoke all on function public.touch_claim_review_pairing() from public, anon, authenticated;
grant execute on function public.touch_claim_review_pairing() to service_role;

create trigger trg_touch_claim_review_pairing
before update on public.claim_review_pairings
for each row execute function public.touch_claim_review_pairing();

alter table public.claim_review_pairings enable row level security;
alter table public.claim_review_audit_events enable row level security;
revoke all on public.claim_review_pairings, public.claim_review_audit_events from public, anon, authenticated, service_role;
grant select, insert, update on public.claim_review_pairings to service_role;
grant select, insert on public.claim_review_audit_events to service_role;
create policy deny_all_public_access on public.claim_review_pairings for all to anon, authenticated using (false) with check (false);
create policy deny_all_public_access on public.claim_review_audit_events for all to anon, authenticated using (false) with check (false);

create or replace function public.claim_review_normalize(p_text text)
returns text
language sql
immutable
strict
security invoker
set search_path = ''
as $$
  select pg_catalog.regexp_replace(
    pg_catalog.btrim(
      pg_catalog.translate(
        pg_catalog.normalize(p_text, 'NFC'),
        chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) || chr(133) || chr(160) || chr(5760) ||
          chr(8192) || chr(8193) || chr(8194) || chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) ||
          chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) || chr(8239) || chr(8287) || chr(12288) || chr(65279),
        pg_catalog.repeat(' ', 26)
      )
    ),
    ' +', ' ', 'g'
  )
$$;

create or replace function public.claim_review_claim_key(p_patch_version text, p_exact_text text)
returns text
language sql
immutable
strict
security invoker
set search_path = ''
as $$
  select pg_catalog.encode(extensions.digest(p_patch_version || chr(10) || public.claim_review_normalize(p_exact_text), 'sha256'), 'hex')
$$;

revoke all on function public.claim_review_normalize(text), public.claim_review_claim_key(text, text) from public, anon, authenticated;
grant execute on function public.claim_review_normalize(text), public.claim_review_claim_key(text, text) to service_role;

-- This is the single scanner capability. It retires obsolete exact claims,
-- records every proposed mapping, honors durable rejections, and returns the
-- full current decision set so claims skipped by rotation still apply.
create or replace function public.sync_claim_review_proposals(p_proposals jsonb, p_seen_at timestamptz)
returns table(cluster_id uuid, state text, proposal_kind text, proposal_reason text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_patch record;
  proposal jsonb;
  official_fix record;
  cluster record;
  existing public.claim_review_pairings%rowtype;
  pairing public.claim_review_pairings%rowtype;
  normalized_claim text;
  next_state text;
  made_clock boolean;
  next_lifecycle_revision bigint;
begin
  if p_seen_at is null then raise exception 'claim_review_seen_at_required' using errcode = '22023'; end if;
  if p_proposals is null or pg_catalog.jsonb_typeof(p_proposals) <> 'array' then
    raise exception 'claim_review_proposals_invalid' using errcode = '22023';
  end if;
  -- Match existing visibility writers: take this global lock before any row lock.
  perform pg_catalog.pg_advisory_xact_lock(20260709, 1);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('official_patch_notes_current', 0));

  select board_no, patch_version, official_url
    into current_patch
  from public.official_patch_notes
  where is_current = true
  order by published_at desc nulls last
  limit 1
  for update;

  if not found then return; end if;

  with retirement_candidates as (
    select pairing_row.id, pairing_row.state as prior_state, pairing_row.rejected_reason as prior_rejected_reason
    from public.claim_review_pairings as pairing_row
    where pairing_row.state <> 'retired'
      and (
        pairing_row.patch_version <> current_patch.patch_version
        or not exists (
          select 1 from public.issue_clusters as current_cluster
          where current_cluster.id = pairing_row.cluster_id
            and current_cluster.is_public = true
            and current_cluster.admin_override = false
        )
        or not exists (
          select 1 from public.official_patch_claimed_fixes as fix
          where fix.board_no = current_patch.board_no
            and public.claim_review_claim_key(current_patch.patch_version, fix.fix_text) = pairing_row.claim_key
        )
      )
  ), retired as (
    update public.claim_review_pairings as pairing_row
    set state = 'retired', retired_at = p_seen_at, retired_reason = 'claim_or_cluster_no_longer_reviewable',
      retired_rejection_reason = candidates.prior_rejected_reason, rejected_reason = null
    from retirement_candidates as candidates
    where pairing_row.id = candidates.id
    returning pairing_row.*
  )
  insert into public.claim_review_audit_events (
    pairing_id, pairing_key, action, actor, occurred_at, prior_state, state, claim_key, patch_version, exact_official_text, cluster_id, reason
  )
  select retired.id, retired.pairing_key, 'retired', 'scanner', p_seen_at, candidates.prior_state, 'retired', retired.claim_key,
    retired.patch_version, retired.exact_official_text, retired.cluster_id, coalesce(candidates.prior_rejected_reason, retired.retired_reason)
  from retired
  join retirement_candidates as candidates on candidates.id = retired.id;

  for proposal in select value from pg_catalog.jsonb_array_elements(p_proposals) loop
    if pg_catalog.jsonb_typeof(proposal) <> 'object'
       or not (proposal ?& array['claim_text', 'cluster_id', 'proposal_kind', 'proposal_reason']) then
      raise exception 'claim_review_proposal_invalid' using errcode = '22023';
    end if;
    if proposal->>'proposal_kind' not in ('llm_sure', 'llm_unsure', 'keyword_proposal')
       or char_length(pg_catalog.btrim(coalesce(proposal->>'proposal_reason', ''))) not between 1 and 500
       or char_length(pg_catalog.btrim(coalesce(proposal->>'claim_text', ''))) not between 1 and 4000 then
      raise exception 'claim_review_proposal_invalid' using errcode = '22023';
    end if;
    normalized_claim := public.claim_review_normalize(proposal->>'claim_text');
    select fix.fix_text, fix.section, public.claim_review_claim_key(current_patch.patch_version, fix.fix_text) as claim_key
      into official_fix
    from public.official_patch_claimed_fixes as fix
    where fix.board_no = current_patch.board_no
      and public.claim_review_normalize(fix.fix_text) = normalized_claim
    limit 1;
    if not found then continue; end if;
    select id, slug, title, category, lifecycle_revision, admin_override, fix_claimed_at, fix_claimed_patch_version
      into cluster
    from public.issue_clusters
    where id = (proposal->>'cluster_id')::uuid and is_public = true and admin_override = false
    for update;
    if not found then continue; end if;

    select * into existing from public.claim_review_pairings
    where pairing_key = official_fix.claim_key || chr(10) || cluster.id::text
    for update;
    if not found then
      next_state := case when proposal->>'proposal_kind' = 'llm_sure' then 'confirmed' else 'pending' end;
      insert into public.claim_review_pairings (
        pairing_key, claim_key, board_no, patch_version, official_url, exact_official_text, official_section,
        cluster_id, cluster_slug, cluster_title, cluster_category, cluster_lifecycle_revision, proposal_kind, proposal_reason,
        state, first_seen_at, last_seen_at, seen_count, confirmed_at, claim_clock_owned
      ) values (
        official_fix.claim_key || chr(10) || cluster.id::text, official_fix.claim_key, current_patch.board_no,
        current_patch.patch_version, current_patch.official_url, official_fix.fix_text, official_fix.section,
        cluster.id, cluster.slug, cluster.title, cluster.category, cluster.lifecycle_revision, proposal->>'proposal_kind', proposal->>'proposal_reason',
        next_state, p_seen_at, p_seen_at, 1, case when next_state = 'confirmed' then p_seen_at else null end, false
      ) returning * into pairing;
      insert into public.claim_review_audit_events (
        pairing_id, pairing_key, action, actor, occurred_at, prior_state, state, claim_key, patch_version, exact_official_text, cluster_id, reason
      ) values (
        pairing.id, pairing.pairing_key, case when next_state = 'confirmed' then 'engine_confirmed' else 'proposed' end,
        'scanner', p_seen_at, null, pairing.state, pairing.claim_key, pairing.patch_version, pairing.exact_official_text, pairing.cluster_id, pairing.proposal_reason
      );
    else
      next_state := case
        when existing.state = 'rejected' then 'rejected'
        when existing.state = 'confirmed' then 'confirmed'
        when existing.state = 'retired' and existing.retired_rejection_reason is not null then 'rejected'
        when existing.state = 'retired' and existing.confirmed_at is not null then 'confirmed'
        when existing.state = 'retired' then case when proposal->>'proposal_kind' = 'llm_sure' then 'confirmed' else 'pending' end
        when proposal->>'proposal_kind' = 'llm_sure' then 'confirmed'
        when existing.state = 'later' then 'later'
        else 'pending'
      end;
      update public.claim_review_pairings
      set board_no = current_patch.board_no, official_url = current_patch.official_url, official_section = official_fix.section, cluster_slug = cluster.slug,
          cluster_title = cluster.title, cluster_category = cluster.category, cluster_lifecycle_revision = cluster.lifecycle_revision,
          proposal_kind = proposal->>'proposal_kind', proposal_reason = proposal->>'proposal_reason', state = next_state,
          last_seen_at = p_seen_at, seen_count = seen_count + 1,
          confirmed_at = case when next_state = 'confirmed' then coalesce(confirmed_at, p_seen_at) else null end,
          retired_at = null, retired_reason = null,
          rejected_reason = case when next_state = 'rejected' then coalesce(rejected_reason, retired_rejection_reason) else null end,
          retired_rejection_reason = null
      where id = existing.id
      returning * into pairing;
      if existing.state is distinct from pairing.state then
        insert into public.claim_review_audit_events (
          pairing_id, pairing_key, action, actor, occurred_at, prior_state, state, claim_key, patch_version, exact_official_text, cluster_id, reason
        ) values (
          pairing.id, pairing.pairing_key, case when pairing.state = 'confirmed' then 'engine_confirmed' else 'proposed' end,
          'scanner', p_seen_at, existing.state, pairing.state, pairing.claim_key, pairing.patch_version, pairing.exact_official_text, pairing.cluster_id, pairing.proposal_reason
        );
      end if;
    end if;

    if pairing.state = 'confirmed' and not cluster.admin_override then
      made_clock := cluster.fix_claimed_patch_version is distinct from current_patch.patch_version or cluster.fix_claimed_at is null;
      update public.issue_clusters
      set fix_status = 'fix_claimed',
          fix_claimed_at = case when made_clock then p_seen_at else fix_claimed_at end,
          fix_claimed_patch_version = current_patch.patch_version,
          lifecycle_reason = case when lifecycle_reason like 'Needs review:%' then null else lifecycle_reason end
      where id = cluster.id and admin_override = false
      returning lifecycle_revision into next_lifecycle_revision;
      update public.claim_review_pairings as siblings
      set cluster_lifecycle_revision = next_lifecycle_revision
      where siblings.cluster_id = cluster.id
        and siblings.patch_version = current_patch.patch_version
        and siblings.state <> 'retired'
        and siblings.id <> pairing.id
        and siblings.cluster_lifecycle_revision is distinct from next_lifecycle_revision;
      update public.claim_review_pairings
      set cluster_lifecycle_revision = next_lifecycle_revision,
          claim_clock_owned = claim_clock_owned or made_clock
      where id = pairing.id
      returning * into pairing;
    elsif pairing.state in ('pending', 'later') and not cluster.admin_override
      and not exists (
        select 1 from public.claim_review_pairings as confirmed_pairing
        where confirmed_pairing.cluster_id = cluster.id
          and confirmed_pairing.patch_version = current_patch.patch_version
          and confirmed_pairing.state = 'confirmed'
      ) then
      update public.issue_clusters
      set fix_status = case when fix_claimed_patch_version = current_patch.patch_version then fix_status else 'reported' end,
          fix_claimed_at = case when fix_claimed_patch_version = current_patch.patch_version then fix_claimed_at else null end,
          fix_claimed_patch_version = case when fix_claimed_patch_version = current_patch.patch_version then fix_claimed_patch_version else null end,
          lifecycle_reason = 'Needs review: ' || pairing.proposal_reason
      where id = cluster.id and admin_override = false
      returning lifecycle_revision into next_lifecycle_revision;
      update public.claim_review_pairings as siblings
      set cluster_lifecycle_revision = next_lifecycle_revision
      where siblings.cluster_id = cluster.id
        and siblings.patch_version = current_patch.patch_version
        and siblings.state <> 'retired'
        and siblings.id <> pairing.id
        and siblings.cluster_lifecycle_revision is distinct from next_lifecycle_revision;
      update public.claim_review_pairings
      set cluster_lifecycle_revision = next_lifecycle_revision
      where id = pairing.id
      returning * into pairing;
    elsif pairing.state = 'rejected' and not cluster.admin_override then
      if not exists (
        select 1 from public.claim_review_pairings as active_pairing
        where active_pairing.cluster_id = cluster.id
          and active_pairing.patch_version = current_patch.patch_version
          and active_pairing.state in ('pending', 'later')
      ) then
        update public.issue_clusters
        set lifecycle_reason = case when lifecycle_reason like 'Needs review:%' then null else lifecycle_reason end
        where id = cluster.id and admin_override = false
        returning lifecycle_revision into next_lifecycle_revision;
        update public.claim_review_pairings as siblings
        set cluster_lifecycle_revision = next_lifecycle_revision
        where siblings.cluster_id = cluster.id
          and siblings.patch_version = current_patch.patch_version
          and siblings.state <> 'retired'
          and siblings.id <> pairing.id
          and siblings.cluster_lifecycle_revision is distinct from next_lifecycle_revision;
        update public.claim_review_pairings
        set cluster_lifecycle_revision = next_lifecycle_revision
        where id = pairing.id
        returning * into pairing;
      end if;
    end if;
  end loop;

  return query
  select ranked.cluster_id, ranked.state, ranked.proposal_kind, ranked.proposal_reason
  from (
    select pairing_row.*, row_number() over (
      partition by pairing_row.cluster_id
      order by case pairing_row.state when 'confirmed' then 3 when 'pending' then 2 when 'later' then 2 else 1 end desc,
        pairing_row.last_seen_at desc, pairing_row.id desc
    ) as rank
    from public.claim_review_pairings as pairing_row
    where pairing_row.board_no = current_patch.board_no
      and pairing_row.patch_version = current_patch.patch_version
      and pairing_row.state <> 'retired'
  ) ranked
  where ranked.rank = 1;
end;
$$;

-- Routine operator decisions use one CAS transaction. It validates the exact
-- currently stored official text before touching a cluster or audit record.
create or replace function public.mutate_claim_review_pairing(
  p_pairing_id uuid, p_revision integer, p_action text, p_reason text, p_actor text
)
returns public.claim_review_pairings
language plpgsql
security invoker
set search_path = ''
as $$
declare
  pairing public.claim_review_pairings%rowtype;
  cluster public.issue_clusters%rowtype;
  current_patch record;
  support_exists boolean;
  next_state text;
  prior_state text;
  made_clock boolean;
  supporting_pairing_id uuid;
begin
  if p_pairing_id is null or p_revision is null or p_revision < 1 then raise exception 'stale_claim_review_edit' using errcode = 'P0001'; end if;
  if p_action not in ('confirm', 'reject', 'later', 'undo') then raise exception 'claim_review_action_invalid' using errcode = '22023'; end if;
  if p_actor is null or char_length(pg_catalog.btrim(p_actor)) not between 1 and 120 then raise exception 'claim_review_actor_invalid' using errcode = '22023'; end if;
  if p_action = 'reject' and char_length(pg_catalog.btrim(coalesce(p_reason, ''))) not between 3 and 500 then raise exception 'claim_review_rejection_reason_invalid' using errcode = '22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(20260709, 1);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('official_patch_notes_current', 0));
  select * into pairing from public.claim_review_pairings where id = p_pairing_id for update;
  if not found then raise exception 'claim_review_pairing_not_found' using errcode = 'P0001'; end if;
  if pairing.revision <> p_revision then raise exception 'stale_claim_review_edit' using errcode = 'P0001'; end if;
  if pairing.state = 'retired' then raise exception 'stale_claim_review_claim' using errcode = 'P0001'; end if;
  select board_no, patch_version into current_patch from public.official_patch_notes where is_current = true limit 1 for update;
  if not found or current_patch.board_no <> pairing.board_no or current_patch.patch_version <> pairing.patch_version
     or not exists (select 1 from public.official_patch_claimed_fixes as fix where fix.board_no = pairing.board_no and public.claim_review_claim_key(pairing.patch_version, fix.fix_text) = pairing.claim_key) then
    raise exception 'stale_claim_review_claim' using errcode = 'P0001';
  end if;
  select * into cluster from public.issue_clusters where id = pairing.cluster_id for update;
  if not found
     or not cluster.is_public
     or cluster.admin_override
     or cluster.slug <> pairing.cluster_slug
     or cluster.title <> pairing.cluster_title
     or cluster.category <> pairing.cluster_category
     or cluster.lifecycle_revision <> pairing.cluster_lifecycle_revision then
    raise exception 'stale_claim_review_cluster' using errcode = 'P0001';
  end if;

  prior_state := pairing.state;
  if p_action = 'confirm' then
    if pairing.state not in ('pending', 'later') then raise exception 'claim_review_confirm_invalid_state' using errcode = 'P0001'; end if;
    made_clock := cluster.fix_claimed_patch_version is distinct from pairing.patch_version or cluster.fix_claimed_at is null;
    update public.issue_clusters set fix_status = 'fix_claimed',
      fix_claimed_at = case when made_clock then now() else cluster.fix_claimed_at end,
      fix_claimed_patch_version = pairing.patch_version,
      lifecycle_reason = case when lifecycle_reason like 'Needs review:%' then null else lifecycle_reason end
    where id = cluster.id returning * into cluster;
    update public.claim_review_pairings as siblings
    set cluster_lifecycle_revision = cluster.lifecycle_revision
    where siblings.cluster_id = cluster.id
      and siblings.patch_version = pairing.patch_version
      and siblings.state <> 'retired'
      and siblings.id <> pairing.id
      and siblings.cluster_lifecycle_revision is distinct from cluster.lifecycle_revision;
    update public.claim_review_pairings set state = 'confirmed', confirmed_at = now(), rejected_reason = null,
      claim_clock_owned = claim_clock_owned or made_clock, cluster_lifecycle_revision = cluster.lifecycle_revision
    where id = pairing.id returning * into pairing;
    next_state := 'confirmed';
  elsif p_action = 'reject' then
    if pairing.state not in ('pending', 'later') then raise exception 'claim_review_reject_invalid_state' using errcode = 'P0001'; end if;
    update public.claim_review_pairings set state = 'rejected', rejected_reason = pg_catalog.btrim(p_reason), seen_by_operator_at = now()
    where id = pairing.id returning * into pairing;
    if not exists (
      select 1 from public.claim_review_pairings as active_pairing
      where active_pairing.cluster_id = cluster.id
        and active_pairing.patch_version = pairing.patch_version
        and active_pairing.state in ('pending', 'later')
    ) and cluster.lifecycle_reason like 'Needs review:%' then
      update public.issue_clusters set lifecycle_reason = null where id = cluster.id returning * into cluster;
      update public.claim_review_pairings as siblings
      set cluster_lifecycle_revision = cluster.lifecycle_revision
      where siblings.cluster_id = cluster.id
        and siblings.patch_version = pairing.patch_version
        and siblings.state <> 'retired'
        and siblings.id <> pairing.id
        and siblings.cluster_lifecycle_revision is distinct from cluster.lifecycle_revision;
    end if;
    update public.claim_review_pairings
    set cluster_lifecycle_revision = cluster.lifecycle_revision
    where id = pairing.id returning * into pairing;
    next_state := 'rejected';
  elsif p_action = 'later' then
    if pairing.state not in ('pending', 'later') then raise exception 'claim_review_later_invalid_state' using errcode = 'P0001'; end if;
    update public.claim_review_pairings set state = 'later', seen_by_operator_at = now()
    where id = pairing.id returning * into pairing;
    next_state := 'later';
  elsif pairing.state = 'rejected' then
    update public.claim_review_pairings set state = 'pending', rejected_reason = null, seen_by_operator_at = null
    where id = pairing.id returning * into pairing;
    if not exists (
      select 1 from public.claim_review_pairings as confirmed_pairing
      where confirmed_pairing.cluster_id = cluster.id
        and confirmed_pairing.patch_version = pairing.patch_version
        and confirmed_pairing.state = 'confirmed'
    ) then
      update public.issue_clusters
      set lifecycle_reason = 'Needs review: ' || pairing.proposal_reason
      where id = cluster.id returning * into cluster;
      update public.claim_review_pairings as siblings
      set cluster_lifecycle_revision = cluster.lifecycle_revision
      where siblings.cluster_id = cluster.id
        and siblings.patch_version = pairing.patch_version
        and siblings.state <> 'retired'
        and siblings.id <> pairing.id
        and siblings.cluster_lifecycle_revision is distinct from cluster.lifecycle_revision;
    end if;
    update public.claim_review_pairings
    set cluster_lifecycle_revision = cluster.lifecycle_revision
    where id = pairing.id returning * into pairing;
    next_state := 'pending';
  elsif pairing.state = 'later' then
    update public.claim_review_pairings set state = 'pending', seen_by_operator_at = null
    where id = pairing.id returning * into pairing;
    next_state := 'pending';
  elsif pairing.state = 'confirmed' then
    select support.id into supporting_pairing_id
      from public.claim_review_pairings as support
      where support.cluster_id = pairing.cluster_id and support.patch_version = pairing.patch_version
        and support.state = 'confirmed' and support.id <> pairing.id
      order by support.confirmed_at, support.id
      limit 1
      for update;
    support_exists := supporting_pairing_id is not null;
    if pairing.claim_clock_owned and support_exists then
      update public.claim_review_pairings
      set claim_clock_owned = true
      where id = supporting_pairing_id;
    elsif pairing.claim_clock_owned then
      update public.issue_clusters
      set fix_status = 'reported', fix_claimed_at = null, fix_claimed_patch_version = null,
        lifecycle_reason = 'Needs review: ' || pairing.proposal_reason
      where id = cluster.id returning * into cluster;
      update public.claim_review_pairings as siblings
      set cluster_lifecycle_revision = cluster.lifecycle_revision
      where siblings.cluster_id = cluster.id
        and siblings.patch_version = pairing.patch_version
        and siblings.state <> 'retired'
        and siblings.id <> pairing.id
        and siblings.cluster_lifecycle_revision is distinct from cluster.lifecycle_revision;
    end if;
    update public.claim_review_pairings set state = 'pending', confirmed_at = null, claim_clock_owned = false,
      cluster_lifecycle_revision = cluster.lifecycle_revision
    where id = pairing.id returning * into pairing;
    next_state := 'pending';
  else
    raise exception 'claim_review_undo_invalid_state' using errcode = 'P0001';
  end if;

  insert into public.claim_review_audit_events (
    pairing_id, pairing_key, action, actor, prior_state, state, claim_key, patch_version, exact_official_text, cluster_id, reason
  ) values (
    pairing.id, pairing.pairing_key,
    case
      when p_action = 'undo' then 'undo_' || prior_state
      when p_action = 'confirm' then 'confirmed'
      when p_action = 'reject' then 'rejected'
      else 'later'
    end,
    p_actor, prior_state, next_state, pairing.claim_key, pairing.patch_version,
    pairing.exact_official_text, pairing.cluster_id, case when p_action = 'reject' then pairing.rejected_reason else null end
  );
  return pairing;
end;
$$;

revoke all on function public.sync_claim_review_proposals(jsonb, timestamptz), public.mutate_claim_review_pairing(uuid, integer, text, text, text) from public, anon, authenticated;
grant execute on function public.sync_claim_review_proposals(jsonb, timestamptz), public.mutate_claim_review_pairing(uuid, integer, text, text, text) to service_role;

-- Keep the existing private brief shape. Durable pending/later pairings replace
-- the old lifecycle prose count, so one pairing is never counted twice.
create or replace function public.owner_attention_brief()
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  observed timestamptz := now(); pending_count integer; pending_oldest interval; draft_count integer; draft_oldest interval;
  flagged_count integer; unsure_count integer; items jsonb;
begin
  select count(*), (observed - min(created_at)) into pending_count, pending_oldest from public.video_review_candidates where state = 'pending';
  select count(*), (observed - min(approved_at)) into draft_count, draft_oldest from public.video_review_candidates where state = 'draft_ready';
  select count(*) into flagged_count from public.bug_reports where moderation_status = 'pending';
  select count(*) into unsure_count
  from public.claim_review_pairings as pairing
  join public.official_patch_notes as patch
    on patch.is_current = true
   and patch.board_no = pairing.board_no
   and patch.patch_version = pairing.patch_version
  join public.issue_clusters as cluster
    on cluster.id = pairing.cluster_id
   and cluster.is_public = true
   and cluster.admin_override = false
  where pairing.state in ('pending', 'later')
    and exists (
      select 1 from public.official_patch_claimed_fixes as fix
      where fix.board_no = patch.board_no
        and public.claim_review_claim_key(patch.patch_version, fix.fix_text) = pairing.claim_key
    );
  select coalesce(jsonb_agg(item order by item_age_seconds desc), '[]'::jsonb) into items from (
    select jsonb_build_object('title', title, 'channel', channel_label, 'state', state, 'ageSeconds', extract(epoch from item_age)::int,
      'reviewReason', case when state = 'draft_ready' then 'Publication draft ready for owner review.' else 'Video candidate awaiting owner review.' end,
      'adminPath', '/admin/videos') as item, extract(epoch from item_age)::int as item_age_seconds
    from (select title, channel_label, state, case when state = 'draft_ready' then observed - approved_at else observed - created_at end as item_age
      from public.video_review_candidates where state in ('pending', 'draft_ready')
      order by case when state = 'draft_ready' then approved_at else created_at end asc limit 8) ranked
  ) listed;
  return jsonb_build_object('observedAt', to_char(observed at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'status', 'ok',
    'videoInbox', jsonb_build_object('awaitingReview', jsonb_build_object('count', pending_count, 'oldestAgeSeconds', case when pending_count = 0 then null else extract(epoch from pending_oldest)::int end),
      'draftsReady', jsonb_build_object('count', draft_count, 'oldestAgeSeconds', case when draft_count = 0 then null else extract(epoch from draft_oldest)::int end), 'items', items),
    'adminAttention', jsonb_build_object('flaggedPendingReports', flagged_count, 'unsureClaimMatches', unsure_count, 'needsYou', flagged_count + unsure_count,
      'reportQueuePath', '/admin', 'scannerQueuePath', '/scanner', 'claimReviewPath', '/operator?view=claims'));
end;
$$;

revoke all on function public.owner_attention_brief() from public, anon, authenticated;
grant execute on function public.owner_attention_brief() to service_role;
