-- Keep the public schema server-only. The app talks to Supabase through
-- Vercel server functions with the service role; browser roles should not
-- have direct table access.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

alter default privileges in schema public
  revoke all on tables from anon, authenticated;

alter default privileges in schema public
  revoke all on sequences from anon, authenticated;

do $$
declare
  public_table text;
begin
  foreach public_table in array array[
    'issue_clusters',
    'bug_reports',
    'approved_excerpts',
    'source_signals',
    'dossier_runs',
    'automation_runs'
  ]
  loop
    execute format('drop policy if exists deny_all_public_access on public.%I', public_table);
    execute format(
      'create policy deny_all_public_access on public.%I for all to anon, authenticated using (false) with check (false)',
      public_table
    );
  end loop;
end $$;
