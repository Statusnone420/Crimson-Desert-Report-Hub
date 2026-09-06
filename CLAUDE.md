# Crimson Desert Report Hub

## Master Coding Agent Document

[AGENTS.md](AGENTS.md) contains the repository's coding rules. Follow it and the host's instruction precedence. This file adds the database-safety guidance below; it does not grant authority to change the product or design.

For current project context, start at [docs/README.md](docs/README.md), [PRODUCT.md](PRODUCT.md), and [DESIGN.md](DESIGN.md). Historical plans and inventories describe earlier work, not the current interface.

## Database Safety

Never apply migrations, run direct SQL, or push schema changes to the remote Supabase project unless the user explicitly authorizes production database changes in the current message.

For feature branch, worktree, or preview work:
- create migration files only
- test with local Supabase or a Supabase preview branch
- do not run `supabase db push`
- do not use Supabase Apply Migration against the linked production project
