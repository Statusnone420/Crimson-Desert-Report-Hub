# Testing Patterns

**Analysis Date:** 2026-07-09

## Test Framework

**Runner:**
- `vitest` `4.1.9` for unit/integration-like tests in `tests/**/*.test.ts`.
- `playwright` `1.61.1` for end-to-end tests in `tests/e2e`.
- Config: `vitest.config.ts`, `playwright.config.ts`.

**Assertion Library:**
- `expect` from `vitest` and `@playwright/test`.

**Run Commands:**
```bash
npm test                # Run Vitest suite (all `tests/**/*.test.ts`)
npm run test:e2e        # Run Playwright suite (`tests/e2e/**/*.spec.ts`)
npm run lint            # Lint check as part of test validation
npm exec tsc -- --noEmit # Type-check gate in CI and local validation
npm run build           # Pre-merge build gate
```

## Test File Organization

**Location:**
- Tests are centralized under `tests/` with app-level integration routes there (`tests/admin*.test.ts`, `tests/automation*.test.ts`, `tests/reportsRoute.test.ts`).
- End-to-end tests are under `tests/e2e/` (`tests/e2e/public-visual.spec.ts`).

**Naming:**
- Unit/integration tests use `*.test.ts`.
- End-to-end specs use `*.spec.ts`.

**Structure:**
```
tests/
├── *.test.ts                # Vitest suites
└── e2e/
    ├── *.spec.ts            # Playwright scenarios
    ├── __screenshots__/      # Visual baseline images
    └── mock-dev-server.mjs   # Local mock app + API server for e2e
```

## Test Structure

**Suite Organization:**
```typescript
import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";

describe("module/route behavior", () => {
  beforeEach(() => {
    // reset mocks/state
  });

  it("returns expected status and payload", async () => {
    const route = await import("../src/app/api/some/route");
    const response = await route.GET();
    expect(response.status).toBe(200);
  });
});
```

**Patterns:**
- `beforeEach`/`afterEach` used for state reset and restoring mocks.
- Async tests dominate because handlers depend on DB, HTTP, and async service calls.
- Assertions verify both status codes and response JSON for API-style routes.

## Mocking

**Framework:** Vitest.

**Patterns:**
```typescript
vi.mock("@/lib/env", () => ({
  getEnvBool: vi.fn(),
  getEnvInt: vi.fn(),
}));

const fakeTable = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
}));
```

**What to Mock:**
- External dependencies (Supabase client, env helpers, external service calls).
- Environment helpers and shared infra modules before importing route handlers.
- Randomness and timing where deterministic assertions are needed.

**What NOT to Mock:**
- Pure transformation/helpers are usually tested directly with real inputs.
- Internal validation and parsing helpers are frequently tested for failure edge cases without mocks.

## Fixtures and Factories

**Test Data:**
```typescript
const makeRecord = ({ id = "x", state = "ok" } = {}) => ({
  id,
  state,
  created_at: new Date().toISOString(),
});
```

**Location:**
- Most tests define lightweight local factories in-file.
- Shared test stub file: `tests/server-only-stub.ts` for runtime aliasing in Vitest.
- No broad dedicated fixture module was detected.

## Coverage

**Requirements:**
- No dedicated coverage threshold is configured.
- No `coverage` npm script is configured in `package.json`.

**View Coverage:**
```bash
npx vitest run --coverage
```

## Test Types

**Unit Tests:**
- Core utility and route helper behavior is covered in files like `tests/env.test.ts`, `tests/session.test.ts`, `tests/aggregates.test.ts`, and `tests/turnstile.test.ts`.
- Emphasis on input validation, parsing, and transformation correctness.

**Integration Tests:**
- Route modules are imported as black-box adapters and asserted through status/payload behavior (`tests/adminActions.test.ts`, `tests/automationRoute.test.ts`, `tests/adminStatusRoute.test.ts`).
- Mocks isolate external services while preserving request flow semantics.

**E2E Tests:**
- Visual, accessibility, and navigation flows in `tests/e2e/public-visual.spec.ts`.
- Uses `tests/e2e/mock-dev-server.mjs` as a controllable backend for deterministic end-to-end behavior.
- Browser targets include Chromium desktop and mobile in `playwright.config.ts`.

## Common Patterns

**Async Testing:**
```typescript
it("handles async failures", async () => {
  const response = await import("../src/app/api/.../route").then((m) => m.POST());
  await expect(response.json()).resolves.toMatchObject({ error: expect.any(String) });
});
```

**Error Testing:**
```typescript
it("throws on invalid input", async () => {
  await expect(mod.someFn("")).rejects.toThrow();
});
```

**Playwright Assertions:**
```typescript
import { test, expect } from "@playwright/test";

test("visual smoke", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveScreenshot();
});
```

## Verification Commands in Practice

- CI workflow (`.github/workflows/ci.yml`) enforces:
  - `npm run lint`
  - `npm test`
  - `npm exec tsc -- --noEmit`
  - `npm run build`
  - `npm run test:e2e` (Windows runner)
- README mirrors the same commands for local checks.

---

*Testing analysis: 2026-07-09*
