-- Owner-authorized backfill (2026-07-20), applied to production via MCP the
-- same day; this file exists for migration-history parity.
-- 1) Strip the internal moderation placeholder that leaked into public
--    descriptions (the UI now hides empty/title-echo descriptions).
update issue_clusters
set description = ''
where description like '%(body retained for 48h moderator review)%';

-- 2) Hide the later duplicate of the Xbox graphics-glitch lead.
update issue_clusters
set is_public = false,
    admin_visibility_override = 'force_hidden',
    lifecycle_reason = 'Merged into auto-3504f3a93c0b (duplicate Xbox graphics-glitch lead)',
    visibility_revision = visibility_revision + 1
where slug = 'auto-b7e557a13e9d';

-- 3) Cross-save crash at the main menu is a crash, not quest progression.
update issue_clusters
set category = 'crash_startup'
where slug = 'auto-2852a96a6576';
