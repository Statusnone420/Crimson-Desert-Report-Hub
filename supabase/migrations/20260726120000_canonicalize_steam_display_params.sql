-- Re-canonicalize stored Steam URLs after `l`, `curator_clanid` and `snr`
-- became droppable display parameters (src/lib/automation/url.ts).
--
-- NOT APPLIED. This file exists so the change can be reviewed before it touches
-- data. Nothing in the application requires it: rule matching re-canonicalizes
-- stored scope values on read, so lessons keep working untouched. What the
-- backfill buys is the re-observation lookup on source_signals.canonical_url,
-- which compares stored text against a freshly canonicalized URL. Without it,
-- each affected Steam thread arrives once more as a "new" lead before settling
-- on the shorter form for good.
--
-- It deliberately does NOT touch source_signals.external_id_hash, even though a
-- web-search signal's identity is derived from its canonical URL. That column
-- is `not null unique`, and two stored rows that differ only by `?l=` collapse
-- to one value — so recomputing the whole column at once would abort on a
-- duplicate. upsertSignal instead falls back to a canonical_url lookup when the
-- hash misses and rewrites the hash on the row it finds, so identities heal one
-- at a time as pages are seen again.
--
-- Rewrites text only. No row is inserted, deleted, or merged, and neither
-- column carries a unique index, so nothing here can collide. Rows already in
-- the canonical form are left alone by the final inequality.

-- Mirrors canonicalizeUrl: drop the three display parameters, then order what
-- is left by parameter NAME while keeping repeated names in their original
-- order — that is what JavaScript's stable URLSearchParams.sort() does. `collate
-- "C"` keeps the comparison on byte order rather than a locale that would sort
-- `Foo` after `bar`.
create or replace function pg_temp.canonicalize_steam_url(url text)
returns text
language sql
immutable
as $$
  select case
    when url !~ '^https?://(www\.)?(steamcommunity\.com|store\.steampowered\.com)/' then url
    when position('?' in url) = 0 then url
    else
      left(url, position('?' in url) - 1)
      || coalesce(
           '?' || nullif(
             (
               select string_agg(pair, '&' order by split_part(pair, '=', 1) collate "C", ord)
               from unnest(string_to_array(substr(url, position('?' in url) + 1), '&'))
                 with ordinality as parts(pair, ord)
               where pair <> ''
                 and lower(split_part(pair, '=', 1)) not in ('l', 'curator_clanid', 'snr')
             ),
             ''
           ),
           ''
         )
  end;
$$;

update source_signals
set canonical_url = pg_temp.canonicalize_steam_url(canonical_url)
where canonical_url is not null
  and canonical_url <> pg_temp.canonicalize_steam_url(canonical_url);

-- Cosmetic, not required: the Active lessons list shows the stored scope value,
-- so shortening it collapses rows that were only ever one page.
update scanner_feedback_rules
set scope_value = pg_temp.canonicalize_steam_url(scope_value)
where scope_type = 'exact_url'
  and scope_value <> pg_temp.canonicalize_steam_url(scope_value);
