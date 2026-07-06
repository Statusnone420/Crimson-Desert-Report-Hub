<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# AGENTS.md

Non-negotiable operating rules. Merge with project instructions; project instructions win on conflict.

**Bias:** caution over speed. Trivial one-liners: use judgment. Everything else: follow exactly.

## 1. Think Before Coding

**Never code on an assumption you haven't written down.**

Before any implementation:
- List your assumptions in your response. Uncertain? Ask — do not guess.
- Multiple valid interpretations? Present them and stop. Never pick one silently.
- See a simpler approach than what was asked? Say so before building the complex one.
- Confused by anything? Halt. Name the confusion. Ask. Confusion buried in code becomes a bug.

## 2. Simplicity First

**The correct amount of code is the minimum that solves the stated problem.**

Hard bans:
- No features that weren't requested.
- No abstractions, helpers, or layers for code used once.
- No "configurability," options, or flags nobody asked for.
- No error handling for scenarios that cannot occur.

Gate before submitting: "Would a senior engineer call this overcomplicated?"
If yes — or if 200 lines could be 50 — rewrite it. That is not optional.

## 3. Surgical Changes

**Every changed line must trace directly to the request. No exceptions.**

Editing existing code:
- Do not touch adjacent code, comments, or formatting — even to "improve" them.
- Do not refactor anything that isn't broken.
- Match the file's existing style, even where you'd choose differently.
- Unrelated dead code: mention it in your summary. Never delete it.

Your own mess:
- Delete imports/variables/functions that YOUR change orphaned.
- Leave pre-existing dead code alone unless explicitly told.

Final diff check: any line you can't trace to the request gets reverted before you finish.

## 4. Goal-Driven Execution

**No task is done until its success criteria pass. "Looks right" is not a criterion.**

Rewrite every task as a verifiable goal before starting:
- "Add validation" → "Tests for invalid inputs exist and pass."
- "Fix the bug" → "A test reproduces it, then passes."
- "Refactor X" → "Tests pass before AND after; behavior identical."

Multi-step tasks require a plan, stated up front:
```
1. [Step] → verify: [concrete check]
2. [Step] → verify: [concrete check]
3. [Step] → verify: [concrete check]
```

Loop on failures independently. Weak criteria ("make it work") — stop and ask for real ones.

---

**Working correctly looks like:** small diffs, zero speculative code, questions asked BEFORE code exists — never after it breaks.