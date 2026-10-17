begin;
select plan(12);

update public.official_patch_notes set is_current = false where is_current;
insert into public.official_patch_notes (board_no, title, patch_version, official_url, published_at, is_current)
values ('test-2-03-02', 'Patch Notes Version 2.03.02', '2.03.02', 'https://example.com/2-03-02', '2026-09-25T00:00:00Z', true);

insert into public.issue_clusters (id, slug, title, category, description, fix_status, confidence, is_public, auto_public)
values
  ('98400000-0000-4000-8000-000000000001', 'approval-old-patch', 'Old patch report', 'performance', 'Test.', 'reported', 'low', false, false),
  ('98400000-0000-4000-8000-000000000002', 'approval-current-patch', 'Current patch report', 'performance', 'Test.', 'reported', 'low', false, false),
  ('98400000-0000-4000-8000-000000000003', 'approval-earlier-hotfix', 'Earlier hotfix in family', 'performance', 'Test.', 'reported', 'low', false, false);

insert into public.bug_reports (id, cluster_id, patch_version, platform, category, severity, frequency, issue_title, description, duplicate_fingerprint, moderation_status)
values
  ('98400000-0000-4000-8000-000000000011', '98400000-0000-4000-8000-000000000001', '1.13.00', 'pc_steam', 'performance', 'high', 'always', 'FPS drop', 'Test.', 'fp-approval-old', 'pending'),
  ('98400000-0000-4000-8000-000000000012', '98400000-0000-4000-8000-000000000002', '2.03.02', 'pc_steam', 'performance', 'high', 'always', 'FPS drop', 'Test.', 'fp-approval-current', 'pending'),
  ('98400000-0000-4000-8000-000000000013', '98400000-0000-4000-8000-000000000003', '2.03.00', 'pc_steam', 'performance', 'high', 'always', 'FPS drop', 'Test.', 'fp-approval-family', 'pending');

update public.bug_reports set moderation_status = 'approved'
where id in ('98400000-0000-4000-8000-000000000011', '98400000-0000-4000-8000-000000000012', '98400000-0000-4000-8000-000000000013');

select is((select is_public from public.issue_clusters where id = '98400000-0000-4000-8000-000000000001'), false,
  'approving an earlier-patch report does not publish its cluster');
select is((select auto_public from public.issue_clusters where id = '98400000-0000-4000-8000-000000000001'), false,
  'approving an earlier-patch report does not claim engine ownership');
select ok((select visibility_revision > 0 from public.issue_clusters where id = '98400000-0000-4000-8000-000000000001'),
  'approving an earlier-patch report still invalidates in-flight refreshes');
select is((select is_public from public.issue_clusters where id = '98400000-0000-4000-8000-000000000002'), true,
  'approving a current-patch report publishes its cluster');
select is((select is_public from public.issue_clusters where id = '98400000-0000-4000-8000-000000000003'), true,
  'a report from an earlier hotfix of the current patch family still publishes');

-- Correcting an approved report's patch is judged like a new approval.
select is((select visibility_revision from public.issue_clusters where id = '98400000-0000-4000-8000-000000000001'), 1::bigint,
  'baseline revision before the patch correction');
update public.bug_reports set patch_version = '2.03.02' where id = '98400000-0000-4000-8000-000000000011';
select is((select is_public from public.issue_clusters where id = '98400000-0000-4000-8000-000000000001'), true,
  'correcting an approved report onto the current patch family publishes its cluster');
select is((select auto_public from public.issue_clusters where id = '98400000-0000-4000-8000-000000000001'), true,
  'the corrected approval claims engine ownership');
update public.bug_reports set patch_version = '1.13.00' where id = '98400000-0000-4000-8000-000000000012';
select ok((select visibility_revision > 1 and is_public from public.issue_clusters where id = '98400000-0000-4000-8000-000000000002'),
  'correcting an approved report onto an earlier patch only invalidates in-flight refreshes; the next refresh decides');

-- With no current patch recorded, approval cannot establish current-patch evidence.
update public.official_patch_notes set is_current = false where is_current;
insert into public.issue_clusters (id, slug, title, category, description, fix_status, confidence, is_public, auto_public)
values ('98400000-0000-4000-8000-000000000004', 'approval-no-patch', 'No current patch', 'performance', 'Test.', 'reported', 'low', false, false);
insert into public.bug_reports (id, cluster_id, patch_version, platform, category, severity, frequency, issue_title, description, duplicate_fingerprint, moderation_status)
values ('98400000-0000-4000-8000-000000000014', '98400000-0000-4000-8000-000000000004', '2.03.02', 'pc_steam', 'performance', 'high', 'always', 'FPS drop', 'Test.', 'fp-approval-no-patch', 'approved');
select is((select is_public from public.issue_clusters where id = '98400000-0000-4000-8000-000000000004'), false,
  'approval without a recorded current patch does not publish');

select is(public.patch_family_key('2.03.02'), '2.3', 'family key drops the hotfix and leading zeros');
select is(public.patch_family_key('other'), null, 'a non-version has no family key');

select * from finish();
rollback;
