# Crimson Desert Report Hub

## Master Coding Agent Document

[AGENTS.md](AGENTS.md) at the repo root is the master coding-agent operating document. Read it and follow its rules (think before coding, simplicity first, surgical changes, goal-driven execution) for ALL coding work in this repo. This file adds project-specific rules on top; per AGENTS.md's own terms, project instructions here win on conflict.

## Database Safety

Never apply migrations, run direct SQL, or push schema changes to the remote Supabase project unless the user explicitly authorizes production database changes in the current message.

For feature branch, worktree, or preview work:
- create migration files only
- test with local Supabase or a Supabase preview branch
- do not run `supabase db push`
- do not use Supabase Apply Migration against the linked production project
