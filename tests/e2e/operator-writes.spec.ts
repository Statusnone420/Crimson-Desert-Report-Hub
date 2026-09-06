import { expect, test, type Page } from "@playwright/test";

import { collectConsoleProblems, expectHealthyPage, signInAsAdmin } from "./helpers";

const MOCK_SUPABASE_ORIGIN = `http://127.0.0.1:${process.env.PLAYWRIGHT_SUPABASE_PORT ?? 18765}`;

/**
 * Assert something about a public page after an operator write. The public
 * surfaces render through tagged caches (PUBLIC_DASHBOARD / PUBLIC_ISSUES) and a
 * write marks those stale rather than clearing them, so a request can still be
 * served the previous render while the refresh happens behind it. Reloading
 * until the assertion holds keeps the contract on the outcome; pinning it to a
 * fixed number of requests would encode whatever the cache happens to do under
 * this suite's frozen clock.
 */
async function expectAfterWrite(page: Page, path: string, assertion: () => Promise<void>) {
  await expect(async () => {
    await page.goto(path);
    await assertion();
  }).toPass({ timeout: 30_000 });
}

/**
 * Submit a server action and wait for its own POST. Without this the assertion
 * that follows would just time out on the DOM when the action throws, hiding the
 * status code that says why.
 */
async function submitAction(page: Page, submit: () => Promise<void>) {
  const posted = page.waitForResponse(async (response) => {
    const request = response.request();
    if (request.method() !== "POST") return false;
    return Boolean((await request.allHeaders())["next-action"]);
  });
  await submit();
  const response = await posted;
  expect(response.status(), "server action returned an error status").toBeLessThan(400);
}

/**
 * The operator write paths, exercised rather than rendered. Every test here
 * submits a real server action against the mock Supabase shim, so it fails if an
 * RPC is missing, mis-named, or returns the wrong shape — which is the whole
 * point: the rest of the admin coverage only proves these controls draw.
 *
 * Each test restores the fixture afterwards, and each undoes its own write
 * through the UI first. The shim is one process shared with the screenshot
 * projects that run after this one, and the reset endpoint can only restore
 * rows — undoing through the UI is what makes the app drop its cached renders
 * too. A write left behind would drift a baseline instead of failing here.
 */
test.describe("operator write paths", () => {
  test.afterEach(async ({ page }) => {
    const reset = await page.request.post(`${MOCK_SUPABASE_ORIGIN}/__test__/reset`);
    expect(reset.ok(), "fixture reset failed — later tests would inherit this test's writes").toBe(true);
  });

  test("rejecting an archived ask and Undo preserve learning without publishing a headline", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await signInAsAdmin(page);

    const ask = "Day 20 of asking to add caracals to the desert : r/CrimsonDesert";
    await page.goto("/");
    await expect(page.getByText(ask)).toHaveCount(0);

    await page.goto("/scanner");
    const contextLanes = page.locator('section[aria-label="Scanner context archive"]');
    // Context lanes is a record, so it opens on request. Everything inside —
    // including the Undo this test proves — stays one click away.
    await contextLanes.locator("details.operator-section > summary").click();
    const askCard = contextLanes.locator("article.lead-item").filter({ hasText: "Day 20 of asking" });
    const askStatus = askCard.locator(".lead-item__status");
    await expect(askStatus).toContainText("RETAINED");
    await askCard.locator("details.lead-feedback > summary").click();
    await askCard.getByRole("textbox", { name: "Operator reason" }).fill("Feature request, not patch context.");
    await submitAction(page, () => askCard.getByRole("button", { name: "Reject and teach" }).click());

    // Two records, one Undo: the decision row is what turns the card's controls over.
    await expect(askCard.getByRole("button", { name: "Undo — restore item and revoke rule" })).toBeVisible();
    await expect(askStatus).toContainText("HIDDEN");
    const lessons = page.locator('section[aria-label="Active scanner feedback rules"]');
    // The rejection created a rule; its row opens from the domain group.
    await lessons.locator("details.feedback-group > summary").first().click();
    await expect(lessons.getByText("BLOCK OFF-TOPIC")).toBeVisible();
    await expect(lessons.getByText("Feature request, not patch context.")).toBeVisible();

    // Verify persisted visibility as well as the UI. Neither state republishes raw search text.
    await expectAfterWrite(page, "/", async () => {
      expect(await page.getByText(ask).count()).toBe(0);
      const records = await (await page.request.get(`${MOCK_SUPABASE_ORIGIN}/rest/v1/patch_observations`)).json();
      expect(records.find((row: { title: string }) => row.title === ask)?.is_public).toBe(false);
    });

    await page.goto("/scanner");
    // A fresh load closes the record sections again; the undoable item is still
    // announced in the section summary, so it is found rather than hunted for.
    await expect(contextLanes.locator(".operator-section__count")).toContainText("2 undoable");
    await contextLanes.locator("details.operator-section > summary").click();
    await submitAction(page, () =>
      askCard.getByRole("button", { name: "Undo — restore item and revoke rule" }).click(),
    );
    await expect(askStatus).toContainText("RETAINED");
    await expect(lessons.getByText("No scanner lessons yet.")).toBeVisible();

    await expectAfterWrite(page, "/", async () => {
      expect(await page.getByText(ask).count()).toBe(0);
      const records = await (await page.request.get(`${MOCK_SUPABASE_ORIGIN}/rest/v1/patch_observations`)).json();
      expect(records.find((row: { title: string }) => row.title === ask)?.is_public).toBe(true);
    });
    await expectHealthyPage(page, problems);
  });

  test("teaching on a rejected candidate clears it from the desk, and Undo returns it", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await signInAsAdmin(page);
    await page.goto("/scanner");

    const candidate = page.locator("article.decision-card").filter({ hasText: "Crimson Desert patch 1.13 patch notes repost" });
    await expect(candidate).toHaveCount(1);
    await candidate.locator("details.decision-card__reject > summary").click();
    await candidate.getByRole("textbox", { name: "Operator reason" }).fill("Mirror of the official notes, not a lead.");
    await submitAction(page, () => candidate.getByRole("button", { name: "Record decision" }).click());

    // A decided candidate carries decision_id and feedback_rule_id, so the desk's
    // undecided-only query stops returning it.
    await expect(candidate).toHaveCount(0);
    const lessons = page.locator('section[aria-label="Active scanner feedback rules"]');
    // The ledger header and its group rows are always visible; a rule's own row
    // and its Undo live one disclosure inside the group.
    await expect(lessons.locator(".feedback-ledger__summary")).toContainText("active rule");
    await lessons.locator("details.feedback-group > summary").first().click();
    await expect(lessons.getByText("Mirror of the official notes, not a lead.")).toBeVisible();

    await submitAction(page, () => lessons.getByRole("button", { name: "Undo" }).first().click());
    await expect(candidate).toHaveCount(1);
    await expect(lessons.getByText("No scanner lessons yet.")).toBeVisible();
    await expectHealthyPage(page, problems);
  });

  test("keeping a candidate as relevant clears it from the desk and records a KEEP lesson", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await signInAsAdmin(page);
    await page.goto("/scanner");

    // The whole rescue pipeline runs before this returns: run ledger insert,
    // deterministic extraction (no OPENROUTER key in the harness), cluster
    // routing, signal insert, stats refresh, decision RPC, rescued_at mark.
    // Any missing shim surface fails the POST here, not silently downstream.
    const candidate = page
      .locator("article.decision-card")
      .filter({ hasText: "Base PS5 performance mode drops after update" });
    await expect(candidate).toHaveCount(1);
    await submitAction(page, () => candidate.getByRole("button", { name: "Keep as relevant" }).click());

    // rescued_at plus the decision row leave the undecided-only desk query
    // nothing to return, and the Relevant decision surfaces as an allow rule.
    await expect(candidate).toHaveCount(0);
    const lessons = page.locator('section[aria-label="Active scanner feedback rules"]');
    // A keep is its own group; the rule row and its Undo open from it.
    await expect(lessons.locator(".feedback-ledger__summary")).toContainText("1 keep");
    await lessons.locator("details.feedback-group > summary").first().click();
    await expect(lessons.getByText("KEEP", { exact: true })).toBeVisible();
    await expect(
      lessons.getByText("Operator inspected this page and confirmed it is a relevant Crimson Desert issue lead."),
    ).toBeVisible();

    // Undo revokes the KEEP rule but must NOT return the candidate: undo
    // deliberately skips a rescued candidate, so the card staying gone is the
    // proof that rescued_at actually landed — the desk filter alone would also
    // hide a candidate that only carried a decision row.
    await submitAction(page, () => lessons.getByRole("button", { name: "Undo" }).first().click());
    await expect(lessons.getByText("No scanner lessons yet.")).toBeVisible();
    await expect(candidate).toHaveCount(0);

    // A rescue has no UI control that fully reverses it, so this test cleans up
    // after itself instead of relying on a later test to re-invalidate the
    // tagged public caches: rendering /scanner repopulated PUBLIC_DASHBOARD
    // entries with post-rescue rows, and the fixture reset alone cannot evict
    // them. Reset first, then re-assert the current patch — a write the app
    // itself revalidates all public tags for, against the restored rows.
    const reset = await page.request.post(`${MOCK_SUPABASE_ORIGIN}/__test__/reset`);
    expect(reset.ok(), "mid-test fixture reset failed").toBe(true);
    await page.goto("/admin");
    const patchLedger = page
      .locator("details")
      .filter({ has: page.getByText("Current patch override", { exact: true }) })
      .first();
    await patchLedger.locator(":scope > summary").click();
    await patchLedger.getByLabel("New current patch").fill("1.13.01");
    await submitAction(page, () => patchLedger.getByRole("button", { name: "Set current patch" }).click());
    await expectHealthyPage(page, problems);
  });

  test("forcing an issue hidden takes it off the board, and reset hands it back to the engine", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await signInAsAdmin(page);

    await page.goto("/issues");
    await expect(page.getByRole("heading", { name: "FPS regression since 1.13" })).toBeVisible();

    await page.goto("/admin");
    const visibilityLedger = page
      .locator("details")
      .filter({ has: page.getByText("Visibility overrides", { exact: true }) })
      .first();
    await visibilityLedger.locator(":scope > summary").click();
    const createOverride = visibilityLedger.locator('details[aria-label="Create visibility override"]');
    await createOverride.locator(":scope > summary").click();
    await createOverride.getByRole("searchbox", { name: "Issue title" }).fill("FPS regression");

    // The break-glass form sits one disclosure deeper: search results are
    // per-issue <details>, and the form only exists once you open one.
    const overrideEntry = createOverride
      .locator("details.override-create")
      .filter({ hasText: "FPS regression since 1.13" });
    await overrideEntry.locator(":scope > summary").click();
    const overrideForm = overrideEntry.locator("form.override-create__form");
    await overrideForm.getByLabel("Temporary visibility").selectOption("force_hidden");
    await overrideForm.getByLabel("Why are you overriding the engine?").fill("Held while the duplicate reports are merged.");
    await overrideForm.getByRole("checkbox").check();
    await submitAction(page, () => overrideForm.getByRole("button", { name: "Apply break-glass override" }).click());

    const forcedCard = visibilityLedger.locator("article.override-card").filter({ hasText: "FPS regression since 1.13" });
    await expect(forcedCard.getByText(/FORCED HIDDEN/)).toBeVisible();
    await expectAfterWrite(page, "/issues", async () => {
      expect(await page.getByRole("heading", { name: "FPS regression since 1.13" }).count()).toBe(0);
    });

    // Reset is the only writer of visibility=auto, and the restore columns are
    // what put the issue back the way the engine had it.
    await page.goto("/admin");
    await visibilityLedger.locator(":scope > summary").click();
    await submitAction(page, () => forcedCard.getByRole("button", { name: "Reset to automatic" }).click());
    await expect(forcedCard).toHaveCount(0);
    await expectAfterWrite(page, "/issues", async () => {
      expect(await page.getByRole("heading", { name: "FPS regression since 1.13" }).count()).toBe(1);
    });
    await expectHealthyPage(page, problems);
  });

  test("setting the current patch by hand takes over the board", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await signInAsAdmin(page);
    await page.goto("/admin");

    const patchLedger = page
      .locator("details")
      .filter({ has: page.getByText("Current patch override", { exact: true }) })
      .first();
    await patchLedger.locator(":scope > summary").click();
    await patchLedger.getByLabel("New current patch").fill("1.13.02");
    await submitAction(page, () => patchLedger.getByRole("button", { name: "Set current patch" }).click());

    await expect(page.getByText(/1\.13\.02/).first()).toBeVisible();
    await expectAfterWrite(page, "/issues", async () => {
      expect(await page.getByText("Issue Board · Patch 1.13.02").count()).toBe(1);
    });

    // This control has no undo, so the test puts the patch back by hand. The
    // fixture reset alone would not be enough: it restores the rows but cannot
    // touch the app's tagged render caches, and this project runs before the
    // screenshot projects. Overriding back makes the app do its own
    // revalidation, so the pages the next project renders are the seeded ones.
    await page.goto("/admin");
    await patchLedger.locator(":scope > summary").click();
    await patchLedger.getByLabel("New current patch").fill("1.13.01");
    await submitAction(page, () => patchLedger.getByRole("button", { name: "Set current patch" }).click());
    await expectAfterWrite(page, "/issues", async () => {
      expect(await page.getByText("Issue Board · Patch 1.13.01").count()).toBe(1);
    });
    await expectHealthyPage(page, problems);
  });
});
