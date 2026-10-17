-- Keep private briefing links in the scanner workspace after the public alias redirects.
create or replace function public.owner_attention_brief()
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  observed timestamptz := now(); pending_count integer; pending_oldest interval; draft_count integer; draft_oldest interval;
  flagged_count integer; unsure_count integer; items jsonb; durable_ready boolean;
begin
  select count(*), (observed - min(created_at)) into pending_count, pending_oldest from public.video_review_candidates where state = 'pending';
  select count(*), (observed - min(approved_at)) into draft_count, draft_oldest from public.video_review_candidates where state = 'draft_ready';
  select count(*) into flagged_count from public.bug_reports where moderation_status = 'pending';
  select exists (select 1 from public.claim_review_sync_state) into durable_ready;
  if durable_ready then
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
  else
    -- The durable store has not completed a pass yet, so the pre-migration
    -- lifecycle prose is still the only record of outstanding decisions.
    select count(*) into unsure_count
    from public.issue_clusters
    where coalesce(admin_override, false) = false
      and coalesce(lifecycle_reason, '') like 'Needs review:%';
  end if;
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
      'reportQueuePath', '/admin', 'scannerQueuePath', '/operator?view=scanner', 'claimReviewPath', '/operator?view=claims'));
end;
$$;

revoke all on function public.owner_attention_brief() from public, anon, authenticated;
grant execute on function public.owner_attention_brief() to service_role;

-- Pin the two private inbox timestamp triggers flagged by the local advisors.
alter function public.touch_video_review_candidate() set search_path = public;
alter function public.touch_video_publication_draft() set search_path = public;
