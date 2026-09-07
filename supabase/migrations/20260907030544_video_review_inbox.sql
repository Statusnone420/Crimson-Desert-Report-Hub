-- Private owner video-review inbox. Candidates and publication drafts stay off
-- public Git, public responses, and browser database roles. Approval never
-- publishes Watch; it only stores a later-PR draft.
--
-- Rolling deploys: application code treats a missing relation or RPC as
-- unavailable, not an empty queue. Permission and other failures must surface.

create table public.video_review_candidates (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1 check (revision >= 1),
  video_id text not null unique check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  canonical_url text not null check (canonical_url ~ '^https://www\.youtube\.com/watch\?v=[A-Za-z0-9_-]{11}$'),
  submitted_url text not null check (char_length(submitted_url) <= 2000),
  source_id text not null check (char_length(source_id) <= 80),
  creator_channel_id text check (creator_channel_id is null or creator_channel_id ~ '^UC[A-Za-z0-9_-]{22}$'),
  title text not null check (char_length(btrim(title)) between 1 and 240),
  channel_label text not null check (char_length(btrim(channel_label)) between 1 and 120),
  review_note text not null check (char_length(btrim(review_note)) between 1 and 500),
  reviewed_headline text check (reviewed_headline is null or char_length(btrim(reviewed_headline)) between 1 and 240),
  reviewed_excerpt text check (reviewed_excerpt is null or char_length(btrim(reviewed_excerpt)) between 1 and 500),
  excerpt_review_status text not null default 'unreviewed'
    check (excerpt_review_status in ('unreviewed', 'reviewed')),
  topic text not null default 'expansion' check (topic in ('base_game', 'expansion')),
  published_at text check (published_at is null or char_length(published_at) <= 40),
  state text not null default 'pending' check (state in ('pending', 'skipped', 'draft_ready')),
  skipped_at timestamptz,
  approved_at timestamptz,
  check (state <> 'skipped' or skipped_at is not null),
  check (state <> 'draft_ready' or approved_at is not null)
);

create index video_review_candidates_state_created_idx
  on public.video_review_candidates (state, created_at);

create index video_review_candidates_approved_idx
  on public.video_review_candidates (approved_at)
  where state = 'draft_ready';

create table public.video_publication_drafts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  candidate_id uuid not null unique references public.video_review_candidates(id) on delete cascade,
  video_id text not null check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  completeness text not null check (completeness in ('complete', 'incomplete')),
  missing_requirements text[] not null default '{}',
  markdown text not null check (char_length(markdown) between 1 and 20000)
);

create index video_publication_drafts_video_id_idx
  on public.video_publication_drafts (video_id);

create or replace function public.touch_video_review_candidate()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' then
    new.revision := old.revision + 1;
  end if;
  return new;
end;
$$;

create trigger video_review_candidates_touch
  before update on public.video_review_candidates
  for each row
  execute function public.touch_video_review_candidate();

create or replace function public.touch_video_publication_draft()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger video_publication_drafts_touch
  before update on public.video_publication_drafts
  for each row
  execute function public.touch_video_publication_draft();

revoke all on function public.touch_video_review_candidate() from public, anon, authenticated;
revoke all on function public.touch_video_publication_draft() from public, anon, authenticated;
grant execute on function public.touch_video_review_candidate() to postgres, service_role;
grant execute on function public.touch_video_publication_draft() to postgres, service_role;

comment on table public.video_review_candidates is
  'Private owner video-review inbox. Pending and skipped rows must never be copied into public Git, assets, or public API responses.';
comment on table public.video_publication_drafts is
  'Private publication drafts for a later PR. Approval stores a draft only; it does not publish Watch or update public registers.';

alter table public.video_review_candidates enable row level security;
alter table public.video_publication_drafts enable row level security;

revoke all on public.video_review_candidates from public, anon, authenticated, service_role;
revoke all on public.video_publication_drafts from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.video_review_candidates to service_role;
grant select, insert, update, delete on public.video_publication_drafts to service_role;

create policy deny_all_public_access on public.video_review_candidates
  for all to anon, authenticated
  using (false)
  with check (false);

create policy deny_all_public_access on public.video_publication_drafts
  for all to anon, authenticated
  using (false)
  with check (false);

-- Candidate state and its private publication draft are one transaction. The
-- caller supplies a reviewed, normalized column payload; this function never
-- accepts ownership of ids, state, revisions, or timestamps from that payload.
create or replace function public.mutate_video_review_candidate(
  p_id uuid,
  p_revision integer,
  p_operation text,
  p_candidate jsonb default null,
  p_draft jsonb default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  candidate_row public.video_review_candidates%rowtype;
  draft_row public.video_publication_drafts%rowtype;
  identity_changed boolean := false;
  write_draft boolean := false;
begin
  select * into candidate_row
  from public.video_review_candidates
  where id = p_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'video_review_candidate_not_found';
  end if;
  if candidate_row.revision is distinct from p_revision then
    raise exception using errcode = 'P0001', message = 'stale_video_review_edit';
  end if;

  if p_operation = 'save' then
    if p_candidate is null or jsonb_typeof(p_candidate) <> 'object' then
      raise exception using errcode = 'P0001', message = 'video_review_candidate_payload_required';
    end if;
    identity_changed :=
      candidate_row.video_id is distinct from (p_candidate ->> 'video_id') or
      candidate_row.source_id is distinct from (p_candidate ->> 'source_id') or
      candidate_row.creator_channel_id is distinct from (p_candidate ->> 'creator_channel_id');

    update public.video_review_candidates
    set
      video_id = p_candidate ->> 'video_id',
      canonical_url = p_candidate ->> 'canonical_url',
      submitted_url = p_candidate ->> 'submitted_url',
      source_id = p_candidate ->> 'source_id',
      creator_channel_id = p_candidate ->> 'creator_channel_id',
      title = p_candidate ->> 'title',
      channel_label = p_candidate ->> 'channel_label',
      review_note = p_candidate ->> 'review_note',
      reviewed_headline = p_candidate ->> 'reviewed_headline',
      reviewed_excerpt = p_candidate ->> 'reviewed_excerpt',
      excerpt_review_status = p_candidate ->> 'excerpt_review_status',
      topic = p_candidate ->> 'topic',
      published_at = p_candidate ->> 'published_at',
      state = case when identity_changed then 'pending' else state end,
      skipped_at = case when identity_changed then null else skipped_at end,
      approved_at = case when identity_changed then null else approved_at end
    where id = p_id
    returning * into candidate_row;

    if identity_changed then
      delete from public.video_publication_drafts where candidate_id = p_id;
    elsif candidate_row.state = 'draft_ready' then
      write_draft := true;
    end if;
  elsif p_operation = 'approve' then
    update public.video_review_candidates
    set
      state = 'draft_ready',
      approved_at = coalesce(approved_at, now()),
      skipped_at = null
    where id = p_id
    returning * into candidate_row;
    write_draft := true;
  elsif p_operation = 'skip' then
    if candidate_row.state = 'draft_ready' then
      raise exception using errcode = 'P0001', message = 'video_review_draft_ready_cannot_skip';
    end if;
    update public.video_review_candidates
    set
      state = 'skipped',
      skipped_at = now(),
      approved_at = null
    where id = p_id
    returning * into candidate_row;
  else
    raise exception using errcode = 'P0001', message = 'invalid_video_review_operation';
  end if;

  if write_draft then
    if p_draft is null or jsonb_typeof(p_draft) <> 'object' then
      raise exception using errcode = 'P0001', message = 'video_publication_draft_payload_required';
    end if;
    if p_draft ->> 'video_id' is distinct from candidate_row.video_id then
      raise exception using errcode = 'P0001', message = 'video_publication_draft_identity_mismatch';
    end if;
    if jsonb_typeof(p_draft -> 'missing_requirements') is distinct from 'array' then
      raise exception using errcode = 'P0001', message = 'video_publication_draft_requirements_invalid';
    end if;

    insert into public.video_publication_drafts (
      candidate_id,
      video_id,
      completeness,
      missing_requirements,
      markdown
    ) values (
      candidate_row.id,
      p_draft ->> 'video_id',
      p_draft ->> 'completeness',
      array(select jsonb_array_elements_text(p_draft -> 'missing_requirements')),
      p_draft ->> 'markdown'
    )
    on conflict (candidate_id) do update set
      video_id = excluded.video_id,
      completeness = excluded.completeness,
      missing_requirements = excluded.missing_requirements,
      markdown = excluded.markdown
    returning * into draft_row;
  end if;

  return jsonb_build_object(
    'candidate', to_jsonb(candidate_row),
    'draft', case when write_draft then to_jsonb(draft_row) else 'null'::jsonb end
  );
end;
$$;

revoke all on function public.mutate_video_review_candidate(uuid, integer, text, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.mutate_video_review_candidate(uuid, integer, text, jsonb, jsonb)
  to service_role;

-- Read-only owner brief for the existing 10 AM cloud health check.
-- Call: select public.owner_attention_brief();
-- Restricted: not granted to anon/authenticated. Missing function is unavailable,
-- never an empty queue.
create or replace function public.owner_attention_brief()
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  observed timestamptz := now();
  pending_count integer;
  pending_oldest interval;
  draft_count integer;
  draft_oldest interval;
  flagged_count integer;
  unsure_count integer;
  items jsonb;
begin
  select count(*), (observed - min(created_at))
    into pending_count, pending_oldest
  from public.video_review_candidates
  where state = 'pending';

  select count(*), (observed - min(approved_at))
    into draft_count, draft_oldest
  from public.video_review_candidates
  where state = 'draft_ready';

  select count(*)
    into flagged_count
  from public.bug_reports
  where moderation_status = 'pending';

  select count(*)
    into unsure_count
  from public.issue_clusters
  where coalesce(admin_override, false) = false
    and coalesce(lifecycle_reason, '') like 'Needs review:%';

  select coalesce(jsonb_agg(item order by item_age_seconds desc), '[]'::jsonb)
    into items
  from (
    select jsonb_build_object(
      'title', title,
      'channel', channel_label,
      'state', state,
      'ageSeconds', extract(epoch from item_age)::int,
      'reviewReason', case
        when state = 'draft_ready' then 'Publication draft ready for owner review.'
        else 'Video candidate awaiting owner review.'
      end,
      'adminPath', '/admin/videos'
    ) as item,
    extract(epoch from item_age)::int as item_age_seconds
    from (
      select
        title,
        channel_label,
        state,
        review_note,
        case
          when state = 'draft_ready' then observed - approved_at
          else observed - created_at
        end as item_age
      from public.video_review_candidates
      where state in ('pending', 'draft_ready')
      order by
        case
          when state = 'draft_ready' then approved_at
          else created_at
        end asc
      limit 8
    ) ranked
  ) listed;

  return jsonb_build_object(
    'observedAt', to_char(observed at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'status', 'ok',
    'videoInbox', jsonb_build_object(
      'awaitingReview', jsonb_build_object(
        'count', pending_count,
        'oldestAgeSeconds', case when pending_count = 0 then null else extract(epoch from pending_oldest)::int end
      ),
      'draftsReady', jsonb_build_object(
        'count', draft_count,
        'oldestAgeSeconds', case when draft_count = 0 then null else extract(epoch from draft_oldest)::int end
      ),
      'items', items
    ),
    'adminAttention', jsonb_build_object(
      'flaggedPendingReports', flagged_count,
      'unsureClaimMatches', unsure_count,
      'needsYou', flagged_count + unsure_count,
      'reportQueuePath', '/admin',
      'scannerQueuePath', '/scanner'
    )
  );
end;
$$;

revoke all on function public.owner_attention_brief() from public, anon, authenticated;
grant execute on function public.owner_attention_brief() to service_role;

comment on function public.owner_attention_brief() is
  'Read-only owner brief: video inbox counts plus Needs-you report/scanner totals. No report bodies, evidence URLs, video IDs, or private source URLs.';
