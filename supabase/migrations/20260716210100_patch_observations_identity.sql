-- Patch observations evolved after the initial lane migration was written.
-- Keep this follow-up separate so environments that already applied the base
-- migration receive both the community-ask genre and patch-scoped identity.

alter table public.patch_observations
  drop constraint if exists patch_observations_kind_check;

alter table public.patch_observations
  add constraint patch_observations_kind_check
  check (kind in ('patch_release', 'press_reception', 'fix_announcement', 'community_ask'));

alter table public.patch_observations
  drop constraint if exists patch_observations_url_hash_key;

alter table public.patch_observations
  add constraint patch_observations_url_hash_patch_version_key
  unique (url_hash, patch_version);
