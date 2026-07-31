begin;

select plan(14);

select lives_ok(
  $sql$
    select public.persist_patch_observations(
      '9.99.99',
      jsonb_build_array(jsonb_build_object(
        'kind', 'community_ask',
        'title', 'Day 20 of asking for caracals',
        'url', 'https://www.reddit.com/r/CrimsonDesert/comments/aaa/day_20/',
        'url_hash', 'campaign-caracals',
        'source_domain', 'reddit.com',
        'snippet', 'Day 20',
        'source_published_at', '2026-07-20T08:00:00.000Z',
        'date_contract', 'displayable_only',
        'observed_at', '2026-07-20T12:00:00.000Z'
      ))
    )
  $sql$,
  'inserts the first campaign thread'
);

select lives_ok(
  $sql$
    select public.persist_patch_observations(
      '9.99.99',
      jsonb_build_array(jsonb_build_object(
        'kind', 'community_ask',
        'title', 'Day 21 of asking for caracals',
        'url', 'https://www.reddit.com/r/CrimsonDesert/comments/bbb/day_21/',
        'url_hash', 'campaign-caracals',
        'source_domain', 'reddit.com',
        'snippet', 'Day 21',
        'source_published_at', '2026-07-21T08:00:00.000Z',
        'date_contract', 'displayable_only',
        'observed_at', '2026-07-21T12:00:00.000Z'
      ))
    )
  $sql$,
  'advances the campaign to a dated thread'
);

select is(
  (
    select url
    from public.patch_observations
    where patch_version = '9.99.99' and url_hash = 'campaign-caracals'
  ),
  'https://www.reddit.com/r/CrimsonDesert/comments/bbb/day_21/',
  'the dated rollover stores the new URL'
);

select is(
  (
    select source_published_at
    from public.patch_observations
    where patch_version = '9.99.99' and url_hash = 'campaign-caracals'
  ),
  '2026-07-21T08:00:00.000Z'::timestamptz,
  'the dated rollover stores the new URL publication date'
);

select is(
  (
    select created_at
    from public.patch_observations
    where patch_version = '9.99.99' and url_hash = 'campaign-caracals'
  ),
  '2026-07-21T12:00:00.000Z'::timestamptz,
  'the dated rollover rebinds first seen to the new URL'
);

select is(
  (
    select seen_count
    from public.patch_observations
    where patch_version = '9.99.99' and url_hash = 'campaign-caracals'
  ),
  2,
  'campaign momentum remains cumulative across URLs'
);

select lives_ok(
  $sql$
    select public.persist_patch_observations(
      '9.99.99',
      jsonb_build_array(jsonb_build_object(
        'kind', 'community_ask',
        'title', 'Day 21 of asking for caracals',
        'url', 'https://www.reddit.com/r/CrimsonDesert/comments/bbb/day_21/',
        'url_hash', 'campaign-caracals',
        'source_domain', 'reddit.com',
        'snippet', 'Day 21, seen again',
        'source_published_at', null,
        'date_contract', 'displayable_only',
        'observed_at', '2026-07-21T13:00:00.000Z'
      ))
    )
  $sql$,
  're-observes the same page without a new asserted date'
);

select is(
  (
    select source_published_at
    from public.patch_observations
    where patch_version = '9.99.99' and url_hash = 'campaign-caracals'
  ),
  '2026-07-21T08:00:00.000Z'::timestamptz,
  'a same-URL null keeps the established publication date'
);

select is(
  (
    select created_at
    from public.patch_observations
    where patch_version = '9.99.99' and url_hash = 'campaign-caracals'
  ),
  '2026-07-21T12:00:00.000Z'::timestamptz,
  'a same-URL re-observation keeps the first-seen clock'
);

select lives_ok(
  $sql$
    select public.persist_patch_observations(
      '9.99.99',
      jsonb_build_array(jsonb_build_object(
        'kind', 'community_ask',
        'title', 'Day 22 of asking for caracals',
        'url', 'https://www.reddit.com/r/CrimsonDesert/comments/ccc/day_22/',
        'url_hash', 'campaign-caracals',
        'source_domain', 'reddit.com',
        'snippet', 'Day 22',
        'source_published_at', null,
        'date_contract', 'displayable_only',
        'observed_at', '2026-07-22T12:00:00.000Z'
      ))
    )
  $sql$,
  'advances the campaign to an undated thread'
);

select is(
  (
    select url
    from public.patch_observations
    where patch_version = '9.99.99' and url_hash = 'campaign-caracals'
  ),
  'https://www.reddit.com/r/CrimsonDesert/comments/ccc/day_22/',
  'the undated rollover stores the new URL'
);

select ok(
  (
    select source_published_at is null
    from public.patch_observations
    where patch_version = '9.99.99' and url_hash = 'campaign-caracals'
  ),
  'the undated rollover clears the prior URL publication date'
);

select is(
  (
    select created_at
    from public.patch_observations
    where patch_version = '9.99.99' and url_hash = 'campaign-caracals'
  ),
  '2026-07-22T12:00:00.000Z'::timestamptz,
  'the undated rollover rebinds first seen to the new URL'
);

select is(
  (
    select seen_count
    from public.patch_observations
    where patch_version = '9.99.99' and url_hash = 'campaign-caracals'
  ),
  4,
  'the campaign keeps cumulative momentum after the undated rollover'
);

select * from finish();

rollback;
