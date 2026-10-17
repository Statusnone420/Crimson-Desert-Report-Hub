-- Forward correction for the already-applied 20260720195847 backfill: old
-- summarize(title, body) rows can still expose this internal retention note in
-- public source-signal summaries. Preserve the title text while removing only
-- the legacy suffix.
update public.source_signals
set summary = btrim(
  regexp_replace(
    summary,
    '[[:space:]]*[(]body retained for 48h moderator review[)][[:space:]]*$',
    '',
    'i'
  )
)
where summary ~* '[[:space:]]*[(]body retained for 48h moderator review[)][[:space:]]*$';
