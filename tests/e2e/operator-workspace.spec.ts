import { expect, test, type Route } from "@playwright/test";

import { collectConsoleProblems, expectHealthyPage, signInAsAdmin } from "./helpers";

const MOCK_SUPABASE_ORIGIN = `http://127.0.0.1:${process.env.PLAYWRIGHT_SUPABASE_PORT ?? 18765}`;
const MAP_PAIRING = "00000000-0000-4000-8000-000000000201";

async function submitAction(page: Parameters<typeof signInAsAdmin>[0], submit: () => Promise<void>) {
  const posted = page.waitForResponse(async (response) => response.request().method() === "POST" && Boolean((await response.request().allHeaders())["next-action"]));
  await submit();
  expect((await posted).status()).toBeLessThan(400);
}

async function abortActionBeforeSend(page: Parameters<typeof signInAsAdmin>[0], submit: () => Promise<void>) {
  let aborted = 0;
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (request.method() === "POST" && (await request.allHeaders())["next-action"]) {
      aborted += 1;
      await route.abort("failed");
      return;
    }
    await route.continue();
  });
  void submit().catch(() => undefined);
  await expect.poll(() => aborted).toBeGreaterThan(0);
  return () => aborted;
}

async function abortOneActionBeforeSend(page: Parameters<typeof signInAsAdmin>[0], submit: () => Promise<void>) {
  let aborted = 0;
  const handler = async (route: Route) => {
    const request = route.request();
    if (request.method() === "POST" && (await request.allHeaders())["next-action"]) {
      aborted += 1;
      await route.abort("failed");
      return;
    }
    await route.continue();
  };
  await page.route("**/*", handler);
  void submit().catch(() => undefined);
  await expect.poll(() => aborted).toBeGreaterThan(0);
  return async () => page.unroute("**/*", handler);
}

const TRANSPORT_MESSAGE = "Save not confirmed; connection failed; request may have completed, reload current records before retrying.";

test.describe("operator workspace flows", () => {
  test.afterEach(async ({ page }) => {
    const response = await page.request.post(`${MOCK_SUPABASE_ORIGIN}/__test__/reset`);
    expect(response.ok()).toBe(true);
  });

  test("claim rejection retains its reason through reload and undo, and stale input stays local", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await signInAsAdmin(page);
    await page.goto(`/operator?view=claims&item=${MAP_PAIRING}`);

    await page.getByRole("button", { name: "Not the same issue" }).click();
    const reason = page.getByLabel("Why is this not the same issue?");
    await reason.fill("The fixture claim names a map crash, but this pairing needs a different issue.");
    await page.request.post(`${MOCK_SUPABASE_ORIGIN}/rest/v1/rpc/mutate_claim_review_pairing`, {
      data: { p_pairing_id: MAP_PAIRING, p_revision: 1, p_action: "later", p_reason: null, p_actor: "fixture" },
    });
    await submitAction(page, () => page.getByRole("button", { name: "Reject this match" }).click());
    await expect(page.getByText("Nothing was changed by this attempt.")).toBeVisible();
    await expect(reason).toHaveValue("The fixture claim names a map crash, but this pairing needs a different issue.");

    await page.reload();
    await page.getByRole("button", { name: "Not the same issue" }).click();
    await reason.fill("The exact official text describes a map crash, not this broad player issue.");
    await submitAction(page, () => page.getByRole("button", { name: "Reject this match" }).click());
    await page.getByRole("button", { name: "Decision history" }).click();
    await page.getByRole("button", { name: /Map-open crash persists after fix/ }).click();
    await page.getByText("Proposal history and dates").click();
    await expect(page.getByText("Rejection reason: The exact official text describes a map crash, not this broad player issue.")).toBeVisible();
    await submitAction(page, () => page.getByRole("button", { name: "Undo decision" }).click());
    await expect(page.getByText("Decision undone. This match is waiting for review again.")).toBeVisible();
    await expectHealthyPage(page, problems);
  });

  test("an excerpt-only retry keeps the approved report and entered excerpt", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await signInAsAdmin(page);
    await page.goto("/operator?view=reports");
    const excerpt = page.getByLabel("Public excerpt");
    await excerpt.fill("The fixture player reports frame-rate drops near the open field after the patch.");
    const armed = await page.request.post(`${MOCK_SUPABASE_ORIGIN}/__test__/fail-next-approved-excerpt`);
    expect(armed.ok()).toBe(true);
    await submitAction(page, () => page.getByRole("button", { name: "Approve" }).click());
    await expect(page.getByText("The report was approved, but its excerpt was not saved. Retry only the excerpt below.")).toBeVisible();
    await expect(excerpt).toHaveValue("The fixture player reports frame-rate drops near the open field after the patch.");
    const removeAbort = await abortOneActionBeforeSend(page, () => page.getByRole("button", { name: "Retry excerpt only" }).click());
    await expect(page.getByText(TRANSPORT_MESSAGE)).toBeVisible();
    await expect(excerpt).toHaveValue("The fixture player reports frame-rate drops near the open field after the patch.");
    await expect(page.getByRole("button", { name: "Retry excerpt only" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);
    // This exact console entry is the browser's expected result of the route
    // abort above. Keep expectHealthyPage strict for every other problem.
    const abortProblem = "error: Failed to load resource: net::ERR_FAILED";
    problems.splice(0, problems.length, ...problems.filter((problem) => problem !== abortProblem));
    await removeAbort();
    await submitAction(page, () => page.getByRole("button", { name: "Retry excerpt only" }).click());
    await expect(page.getByText("Excerpt saved. Approval was not repeated.")).toBeVisible();
    await expectHealthyPage(page, problems);
  });

  test("a transport abort preserves the report excerpt without deciding the report", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/operator?view=reports");
    const excerpt = page.getByLabel("Public excerpt");
    await excerpt.fill("This report excerpt must survive an unconfirmed request.");
    const aborted = await abortActionBeforeSend(page, () => page.getByRole("button", { name: "Approve" }).click());
    await expect(page.getByText(TRANSPORT_MESSAGE)).toBeVisible();
    await expect(excerpt).toHaveValue("This report excerpt must survive an unconfirmed request.");
    expect(aborted()).toBeGreaterThan(0);
    const report = await page.request.get(`${MOCK_SUPABASE_ORIGIN}/rest/v1/bug_reports?id=eq.00000000-0000-4000-8000-000000000101`);
    expect(report.ok()).toBe(true);
    await expect(report.json()).resolves.toMatchObject([{ moderation_status: "pending" }]);
    await expect(page.getByText("This view could not finish loading.")).toHaveCount(0);
  });

  test("a transport abort preserves the claim rejection reason", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto(`/operator?view=claims&item=${MAP_PAIRING}`);
    await page.getByRole("button", { name: "Not the same issue" }).click();
    const reason = page.getByLabel("Why is this not the same issue?");
    await reason.fill("This claim reason must survive an unconfirmed request.");
    const aborted = await abortActionBeforeSend(page, () => page.getByRole("button", { name: "Reject this match" }).click());
    await expect(page.getByText(TRANSPORT_MESSAGE)).toBeVisible();
    await expect(reason).toHaveValue("This claim reason must survive an unconfirmed request.");
    expect(aborted()).toBeGreaterThan(0);
    await expect(page.getByText("This view could not finish loading.")).toHaveCount(0);
  });

  test("a transport abort preserves Video editor values", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/operator?view=videos&item=video-pending-1");
    const editor = page.getByRole("region", { name: /^Video details:/ });
    const title = editor.getByLabel("Title");
    const note = editor.getByLabel("Review note");
    await title.fill("This Video title must survive an unconfirmed request");
    await note.fill("This Video note must survive an unconfirmed request.");
    const aborted = await abortActionBeforeSend(page, () => editor.getByRole("button", { name: "Save" }).click());
    await expect(page.getByText(TRANSPORT_MESSAGE)).toBeVisible();
    await expect(title).toHaveValue("This Video title must survive an unconfirmed request");
    await expect(note).toHaveValue("This Video note must survive an unconfirmed request.");
    expect(aborted()).toBeGreaterThan(0);
    await expect(page.getByText("This view could not finish loading.")).toHaveCount(0);
  });

  test("a transport abort preserves the Dossier AI selection", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/operator?view=dossiers");
    const useAi = page.getByRole("checkbox", { name: "Draft prose with AI" });
    await useAi.check();
    const aborted = await abortActionBeforeSend(page, () => page.getByRole("button", { name: "Compile now" }).click());
    await expect(page.getByText(TRANSPORT_MESSAGE)).toBeVisible();
    await expect(useAi).toBeChecked();
    expect(aborted()).toBeGreaterThan(0);
    await expect(page.getByText("This view could not finish loading.")).toHaveCount(0);
  });

  test("video save failures and stale revisions retain the selected editor draft", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await signInAsAdmin(page);
    await page.goto("/operator?view=videos&item=video-pending-1");
    const editor = page.getByRole("region", { name: /^Video details:/ });
    const title = editor.getByLabel("Title");
    const note = editor.getByLabel("Review note");
    await title.fill("Edited fixture title survives a failed save");
    await note.fill("Edited fixture note survives a failed save and remains private.");
    expect((await page.request.post(`${MOCK_SUPABASE_ORIGIN}/__test__/fail-next-video-mutation`)).ok()).toBe(true);
    await submitAction(page, () => editor.getByRole("button", { name: "Save" }).click());
    await expect(page.getByText("The private inbox could not save that change. Your entered details are still here; try again.")).toBeVisible();
    await expect(title).toHaveValue("Edited fixture title survives a failed save");
    await expect(note).toHaveValue("Edited fixture note survives a failed save and remains private.");
    await submitAction(page, () => editor.getByRole("button", { name: "Save" }).click());
    await expect(page.getByText("Saved private video review.")).toBeVisible();
    await expect(title).toHaveValue("Edited fixture title survives a failed save");

    await page.reload();
    const staleEditor = page.getByRole("region", { name: /^Video details:/ });
    const staleTitle = staleEditor.getByLabel("Title");
    const staleNote = staleEditor.getByLabel("Review note");
    await staleTitle.fill("Edited title survives a stale revision");
    await staleNote.fill("Edited note survives a stale revision.");
    expect((await page.request.post(`${MOCK_SUPABASE_ORIGIN}/rest/v1/rpc/mutate_video_review_candidate`, {
      data: { p_id: "video-pending-1", p_revision: 2, p_operation: "skip", p_candidate: null, p_draft: null },
    })).ok()).toBe(true);
    await submitAction(page, () => staleEditor.getByRole("button", { name: "Save" }).click());
    await expect(page.getByText("This candidate changed elsewhere. Your entered details are still here; reload before trying again.")).toBeVisible();
    await expect(staleTitle).toHaveValue("Edited title survives a stale revision");
    await expect(staleNote).toHaveValue("Edited note survives a stale revision.");
    await expectHealthyPage(page, problems);
  });

  test("a recoverable dossier input read failure preserves the checked AI choice", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await signInAsAdmin(page);
    await page.goto("/operator?view=dossiers");
    const useAi = page.getByRole("checkbox", { name: "Draft prose with AI" });
    await expect(useAi).toBeEnabled();
    await useAi.check();
    expect((await page.request.post(`${MOCK_SUPABASE_ORIGIN}/__test__/bug-reports-unavailable`)).ok()).toBe(true);
    await submitAction(page, () => page.getByRole("button", { name: "Compile now" }).click());
    await expect(page.getByText("The dossier inputs could not be read. No dossier was compiled; your selected options are still here.")).toBeVisible();
    await expect(useAi).toBeChecked();
    await expectHealthyPage(page, problems);
  });

  test("compilation redirects to the saved canonical run and its output can be copied", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await signInAsAdmin(page);
    await page.goto("/operator?view=dossiers");
    const redirected = page.waitForURL(/\/operator\?view=dossiers&run=mock-dossier-\d+/);
    await submitAction(page, () => page.getByRole("button", { name: "Compile now" }).click());
    await redirected;
    const output = page.getByLabel("Dossier text");
    await expect(output).not.toHaveValue("");
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(page.url()).origin });
    await page.getByRole("button", { name: "Copy to clipboard" }).click();
    await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
    const normalizeLineEndings = (value: string) => value.replace(/\r\n/g, "\n");
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText().then((text) => text.replace(/\r\n/g, "\n")))).toBe(normalizeLineEndings(await output.inputValue()));
    await expectHealthyPage(page, problems);
  });

  test("a missing saved run is explicit and a failed dossier read reaches the route error boundary", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/operator?view=dossiers&run=not-a-saved-run");
    await expect(page.getByText("That saved dossier is no longer available. Choose a run from the list or compile a new dossier.")).toBeVisible();

    const unavailable = await page.request.post(`${MOCK_SUPABASE_ORIGIN}/__test__/dossier-runs-unavailable`);
    expect(unavailable.ok()).toBe(true);
    await page.goto("/operator?view=dossiers");
    await expect(page.getByRole("heading", { name: "This view could not finish loading." })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reload this view" })).toBeVisible();
  });

  test("overview names each available queue and marks a failed claim read unavailable", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await signInAsAdmin(page);
    await page.goto("/operator");
    await expect(page.getByText("Pending visual test report")).toBeVisible();
    await expect(page.getByText("Map-open crash persists after fix")).toBeVisible();
    await expect(page.getByText("Fixture expansion commentary for inbox tests")).toBeVisible();
    await expect(page.getByRole("link", { name: /Map-open crash persists after fix/ })).toHaveAttribute("href", `/operator?view=claims&item=${MAP_PAIRING}`);
    await expect(page.getByRole("link", { name: /Fixture expansion commentary for inbox tests/ })).toHaveAttribute("href", /\/operator\?view=videos&item=video-pending-1/);

    const unavailable = await page.request.post(`${MOCK_SUPABASE_ORIGIN}/__test__/claim-review-unavailable`);
    expect(unavailable.ok()).toBe(true);
    await page.goto("/operator");
    await expect(page.getByText("Some queues could not be read. Available decisions are shown below.")).toBeVisible();
    await expect(page.getByRole("link", { name: /Claim review.*Unavailable/ })).toBeVisible();
    await expectHealthyPage(page, problems);
  });

  test("seven workspace destinations render in both palettes", async ({ page }, testInfo) => {
    const problems = collectConsoleProblems(page);
    await signInAsAdmin(page);
    const destinations = [
      ["overview", "/operator"], ["reports", "/operator?view=reports"], ["claims", "/operator?view=claims"],
      ["scanner", "/operator?view=scanner"], ["videos", "/operator?view=videos"], ["dossiers", "/operator?view=dossiers"],
      ["settings", "/operator?view=settings"],
    ] as const;
    for (const theme of ["light", "dark"] as const) {
      for (const [name, path] of destinations) {
        await page.goto(path);
        if (await page.locator("html").getAttribute("data-theme") !== theme) {
          await page.getByRole("button", { name: `Switch to ${theme} mode` }).click();
        }
        await page.evaluate(() => document.fonts.ready);
        await expect.poll(() => page.locator(".operator-workspace").evaluate((root) => {
          for (let element: Element | null = root; element; element = element.parentElement) {
            if (Number(getComputedStyle(element).opacity) < 1) return false;
          }
          return true;
        })).toBe(true);
        await page.screenshot({ animations: "disabled", caret: "initial", fullPage: true, path: `output/playwright/workspace-${name}-${theme}-${testInfo.project.name}.png` });
      }
    }
    await expectHealthyPage(page, problems);
  });
});
