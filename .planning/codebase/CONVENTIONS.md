# Coding Conventions

**Analysis Date:** 2026-07-09

## Naming Patterns

**Files:**
- Source modules use functional naming and concise nouns for domains, e.g. `src/lib/automation/search.ts`, `src/lib/automation/settings.ts`, `src/app/api/scan/route.ts`.
- React UI files are component-named where they export a component, e.g. `src/components/AdminControls.tsx`, `src/components/SubmitButton.tsx`.
- Route entry points are consistently in `route.ts` files under `src/app/api/**/`.

**Functions:**
- Use `camelCase` names for functions and command-style helpers in shared libs, e.g. `src/lib/session.ts`, `src/lib/route.ts`.
- Route handlers use HTTP verb names (`GET`, `POST`) and domain helpers such as `handleX`/`loadX`.
- Tests mirror behavior names with `describe` context and verb-style `it` descriptions, e.g. `tests/adminGuard.test.ts`, `tests/automationRoute.test.ts`.

**Variables:**
- Lower `camelCase` variables, often `const`-first, as seen in `src/lib/automation/search.ts`, `src/lib/env.ts`, and handlers under `src/app/api`.
- Typed records and config bags are named as nouns (`config`, `env`, `state`, `inputs`) and passed as single objects.

**Types:**
- `type` aliases are preferred for request/response payload contracts and service return shapes in `src/lib` utilities and route modules.
- Imports are strongly typed where external dependencies are wrapped and returned, e.g. `src/lib/session.ts`, `src/lib/env.ts`.

## Code Style

**Formatting:**
- Enforced by TypeScript/ESLint pipeline; no separate formatter configuration file was detected.
- The code uses semicolons and trailing commas in object literals/argument lists.
- Indentation is consistently 2 spaces in both `src/` and `tests/` files.

**Linting:**
- ESLint is configured via `eslint.config.mjs` and Next.js presets.
- CI enforces linting before test/build (`.github/workflows/ci.yml`).
- TypeScript strictness is enabled in `tsconfig.json`.

## Import Organization

**Order:**
1. External dependencies first (`next`, `zod`, `vitest` in tests).
2. Internal project modules through `@/...`.
3. Relative imports (`./` / `../`) for same-folder dependencies.

**Path Aliases:**
- `@/*` maps to `./src/*` (from `tsconfig.json` and `vitest.config.ts`).
- Tests use the same alias for consistency, e.g. `tests/automationRoute.test.ts`, `tests/adminActions.test.ts`.
- `server-only` is aliased to `tests/server-only-stub.ts` in test config to avoid running server runtime checks.

## Error Handling

**Patterns:**
- Library-level helpers throw explicit `Error` instances when preconditions fail.
- Route and action handlers convert failures into structured JSON responses with explicit HTTP status (`400`, `401`, `500`) via `NextResponse.json`.
- Validation failures are checked early and short-circuit with clear messages before downstream calls.
- Environment-dependent operations are guarded, with tests asserting message-level behavior.

## Logging

**Framework:** native `console` output.

**Patterns:**
- Operational errors are logged at boundaries around external calls and route execution.
- Tests commonly silence/spy on logging via mock assertions or minimal setup to keep unit expectations deterministic.

## Comments

**When to Comment:**
- Minimal comments are used; logic is favored as self-documenting through naming and helper extraction.
- Comments appear mainly when intent is non-obvious across async flows.

**JSDoc/TSDoc:**
- No repository-wide JSDoc requirement.
- Inline type annotations dominate over doc comments.

## Function Design

**Size:**
- Helpers are small and focused; large concerns are split into service-like helpers under `src/lib/`.
- Route handlers are thin wrappers around library calls, with validation and response formatting kept close to entrypoints.

**Parameters:**
- Prefer object-shaped inputs for configuration/options so call sites stay explicit and resilient (`src/app/report/page.tsx`, `src/lib/automation/settings.ts`).
- Shared helpers typically avoid deep nesting and long parameter lists.

**Return Values:**
- Pure helpers return concrete typed values.
- Framework entrypoints return framework response types (`NextResponse` in `src/app/api/**/route.ts`).

## Module Design

**Exports:**
- Named exports are the default for utilities and route helpers; default exports are rare and intentionally avoided.
- This keeps tree-level testing of functions straightforward via named imports.

**Barrel Files:**
- No broad barrel export file strategy was detected.
- Imports are direct from module file paths, preserving locality and explicit dependencies.

---

*Convention analysis: 2026-07-09*
