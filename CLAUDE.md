# Crimson Desert Report Hub

## Database Safety

Never apply migrations, run direct SQL, or push schema changes to the remote Supabase project unless the user explicitly authorizes production database changes in the current message.

For feature branch, worktree, or preview work:
- create migration files only
- test with local Supabase or a Supabase preview branch
- do not run `supabase db push`
- do not use Supabase Apply Migration against the linked production project
