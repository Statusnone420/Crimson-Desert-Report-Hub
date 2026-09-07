begin;
select plan(36);

select ok(has_function_privilege('service_role', 'public.mutate_video_review_candidate(uuid,integer,text,jsonb,jsonb)', 'EXECUTE'), 'service role can mutate the private inbox atomically');
select ok(not has_function_privilege('anon', 'public.mutate_video_review_candidate(uuid,integer,text,jsonb,jsonb)', 'EXECUTE'), 'anon cannot call the mutation RPC');
select ok(not has_function_privilege('authenticated', 'public.mutate_video_review_candidate(uuid,integer,text,jsonb,jsonb)', 'EXECUTE'), 'authenticated cannot call the mutation RPC');
select ok(not has_table_privilege('anon', 'public.video_review_candidates', 'SELECT'), 'anon cannot read candidates');
select ok(not has_table_privilege('authenticated', 'public.video_review_candidates', 'SELECT'), 'authenticated cannot read candidates');
select ok(not has_table_privilege('anon', 'public.video_publication_drafts', 'SELECT'), 'anon cannot read drafts');
select ok(not has_table_privilege('authenticated', 'public.video_publication_drafts', 'SELECT'), 'authenticated cannot read drafts');
select ok(has_table_privilege('service_role', 'public.video_review_candidates', 'SELECT,UPDATE'), 'service role can read and update candidates');
select ok(has_table_privilege('service_role', 'public.video_publication_drafts', 'SELECT,INSERT,UPDATE,DELETE'), 'service role can maintain drafts');

insert into public.video_review_candidates (
  id, video_id, canonical_url, submitted_url, source_id, creator_channel_id,
  title, channel_label, review_note, excerpt_review_status, topic
) values (
  '94000000-0000-4000-8000-000000000001', 'abcDEF12345',
  'https://www.youtube.com/watch?v=abcDEF12345', 'https://youtu.be/abcDEF12345',
  'creator-one', 'UC1234567890123456789012', 'First video', 'Creator One',
  'https://private.example/owner-only evidence', 'unreviewed', 'expansion'
);

select throws_ok(
  $sql$select public.mutate_video_review_candidate(
    '94000000-0000-4000-8000-000000000001', 1, 'approve', null,
    jsonb_build_object('video_id','abcDEF12345','completeness','invalid','missing_requirements',jsonb_build_array(),'markdown','draft')
  )$sql$,
  '23514', null, 'draft constraint failure rolls back the approval'
);
select is((select state from public.video_review_candidates where id='94000000-0000-4000-8000-000000000001'), 'pending', 'failed draft write leaves candidate pending');
select is((select revision from public.video_review_candidates where id='94000000-0000-4000-8000-000000000001'), 1, 'failed draft write rolls back revision');
select is((select count(*) from public.video_publication_drafts where candidate_id='94000000-0000-4000-8000-000000000001'), 0::bigint, 'failed approval leaves no draft');

select throws_ok(
  $sql$select public.mutate_video_review_candidate('94000000-0000-4000-8000-000000000001', 9, 'save', '{}'::jsonb, null)$sql$,
  'P0001', 'stale_video_review_edit', 'stale revisions fail before mutation'
);
select throws_ok(
  $sql$select public.mutate_video_review_candidate('94000000-0000-4000-8000-000000000001', null, 'approve', null, null)$sql$,
  'P0001', 'stale_video_review_edit', 'a missing revision cannot bypass concurrency checks'
);
select lives_ok(
  $sql$select public.mutate_video_review_candidate(
    '94000000-0000-4000-8000-000000000001', 1, 'approve', null,
    jsonb_build_object('video_id','abcDEF12345','completeness','incomplete','missing_requirements',jsonb_build_array('still'),'markdown','draft one')
  )$sql$,
  'approval and draft creation commit together'
);
select is((select state from public.video_review_candidates where id='94000000-0000-4000-8000-000000000001'), 'draft_ready', 'approval marks the candidate ready');
select is((select count(*) from public.video_publication_drafts where candidate_id='94000000-0000-4000-8000-000000000001'), 1::bigint, 'approval creates one draft');

select lives_ok(
  $sql$select public.mutate_video_review_candidate(
    '94000000-0000-4000-8000-000000000001', 2, 'save',
    jsonb_build_object(
      'video_id','newDEF12345','canonical_url','https://www.youtube.com/watch?v=newDEF12345',
      'submitted_url','https://youtu.be/newDEF12345','source_id','creator-one',
      'creator_channel_id','UC1234567890123456789012','title','Replacement video',
      'channel_label','Creator One','review_note','Replacement identity','reviewed_headline',null,
      'reviewed_excerpt',null,'excerpt_review_status','unreviewed','topic','expansion','published_at',null
    ), null
  )$sql$,
  'identity-changing save resets the workflow'
);
select is((select state from public.video_review_candidates where id='94000000-0000-4000-8000-000000000001'), 'pending', 'identity change returns candidate to pending');
select is((select approved_at from public.video_review_candidates where id='94000000-0000-4000-8000-000000000001'), null::timestamptz, 'identity change clears approval time');
select is((select skipped_at from public.video_review_candidates where id='94000000-0000-4000-8000-000000000001'), null::timestamptz, 'identity change clears skip time');
select is((select count(*) from public.video_publication_drafts where candidate_id='94000000-0000-4000-8000-000000000001'), 0::bigint, 'identity change deletes the old draft');

select lives_ok(
  $sql$select public.mutate_video_review_candidate(
    '94000000-0000-4000-8000-000000000001', 3, 'approve', null,
    jsonb_build_object('video_id','newDEF12345','completeness','incomplete','missing_requirements',jsonb_build_array('coverage'),'markdown','draft two')
  )$sql$,
  'replacement identity can be approved atomically'
);
select lives_ok(
  $sql$select public.mutate_video_review_candidate(
    '94000000-0000-4000-8000-000000000001', 4, 'save',
    jsonb_build_object(
      'video_id','newDEF12345','canonical_url','https://www.youtube.com/watch?v=newDEF12345',
      'submitted_url','https://youtu.be/newDEF12345','source_id','creator-one',
      'creator_channel_id','UC1234567890123456789012','title','Replacement video edited',
      'channel_label','Creator One','review_note','Same identity edit','reviewed_headline','Reviewed replacement',
      'reviewed_excerpt','Reviewed excerpt','excerpt_review_status','reviewed','topic','expansion','published_at','2026-09-07'
    ),
    jsonb_build_object('video_id','newDEF12345','completeness','complete','missing_requirements',jsonb_build_array(),'markdown','draft refreshed')
  )$sql$,
  'same-identity ready save refreshes candidate and draft atomically'
);
select is((select state from public.video_review_candidates where id='94000000-0000-4000-8000-000000000001'), 'draft_ready', 'same identity preserves ready state');
select is((select markdown from public.video_publication_drafts where candidate_id='94000000-0000-4000-8000-000000000001'), 'draft refreshed', 'same identity refreshes draft content');
select is((select video_id from public.video_publication_drafts where candidate_id='94000000-0000-4000-8000-000000000001'), 'newDEF12345', 'draft identity matches candidate');

select throws_ok(
  $sql$select public.mutate_video_review_candidate(
    '94000000-0000-4000-8000-000000000001', 5, 'save',
    jsonb_build_object(
      'video_id','newDEF12345','canonical_url','https://www.youtube.com/watch?v=newDEF12345',
      'submitted_url','https://youtu.be/newDEF12345','source_id','creator-one',
      'creator_channel_id','UC1234567890123456789012','title','Replacement video edited',
      'channel_label','Creator One','review_note','Same identity edit','reviewed_headline','Reviewed replacement',
      'reviewed_excerpt','Reviewed excerpt','excerpt_review_status','reviewed','topic','expansion','published_at','2026-09-07'
    ),
    jsonb_build_object('video_id','wrongID1234','completeness','complete','missing_requirements',jsonb_build_array(),'markdown','wrong')
  )$sql$,
  'P0001', 'video_publication_draft_identity_mismatch', 'mismatched draft identity is rejected'
);
select is((select revision from public.video_review_candidates where id='94000000-0000-4000-8000-000000000001'), 5, 'identity mismatch rolls back candidate revision');
select throws_ok(
  $sql$select public.mutate_video_review_candidate('94000000-0000-4000-8000-000000000001', 5, 'skip', null, null)$sql$,
  'P0001', 'video_review_draft_ready_cannot_skip', 'ready drafts cannot be skipped'
);

insert into public.video_review_candidates (
  id, video_id, canonical_url, submitted_url, source_id, creator_channel_id,
  title, channel_label, review_note, excerpt_review_status, topic
) values (
  '94000000-0000-4000-8000-000000000002', 'xyzDEF12345',
  'https://www.youtube.com/watch?v=xyzDEF12345', 'https://youtu.be/xyzDEF12345',
  'creator-one', 'UC1234567890123456789012', 'Pending video', 'Creator One',
  'https://private.example/do-not-copy', 'unreviewed', 'expansion'
);

select is((public.owner_attention_brief() #>> '{videoInbox,awaitingReview,count}')::integer, 1, 'owner brief counts pending candidates');
select is((public.owner_attention_brief() #>> '{videoInbox,draftsReady,count}')::integer, 1, 'owner brief counts atomically created drafts');
select ok(position('private.example' in public.owner_attention_brief()::text) = 0, 'owner brief does not copy private review-note URLs');

set local role service_role;
select lives_ok($sql$select public.owner_attention_brief()$sql$, 'service role can read the private brief');
reset role;

select throws_ok(
  $sql$select public.mutate_video_review_candidate('94000000-0000-4000-8000-000000000099', 1, 'skip', null, null)$sql$,
  'P0001', 'video_review_candidate_not_found', 'missing candidates have an explicit error'
);

select * from finish();
rollback;
