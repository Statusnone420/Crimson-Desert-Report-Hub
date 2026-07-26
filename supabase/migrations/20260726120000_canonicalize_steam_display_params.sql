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
-- Rewrites text only. No row is inserted, deleted, or merged, and there is no
-- unique index on either column, so nothing can collide. Rows already in the
-- canonical form are left alone by the final inequality.

-- Drops the three display parameters and re-sorts the rest, mirroring
-- canonicalizeUrl: URLSearchParams.sort() orders by key, and `k=v` string order
-- agrees with that for distinct keys.
create or replace function pg_temp.canonicalize_steam_url(url text)
returns text
language sql
immutable
as $$
  select case
    when url !~ '^https?://(www\.)?(steamcommunity\.com|store\.steampowered\.com)/' then url
    when position('?' in url) = 0 then url
    else
      split_part(url, '?', 1)
      || coalesce(
           '?' || nullif(
             (
               select string_agg(pair, '&' order by pair)
               from unnest(string_to_array(split_part(url, '?', 2), '&')) as pair
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
