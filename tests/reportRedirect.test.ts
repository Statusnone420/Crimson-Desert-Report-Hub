import { beforeEach, describe, expect, it, vi } from "vitest";

const redirects = vi.hoisted(() => ({ permanentRedirect: vi.fn() }));

vi.mock("next/navigation", () => ({ permanentRedirect: redirects.permanentRedirect }));

import ReportPage from "@/app/report/page";

describe("/report", () => {
  beforeEach(() => {
    redirects.permanentRedirect.mockClear();
  });

  it("permanently redirects the retired route to the issue board", async () => {
    await ReportPage();

    expect(redirects.permanentRedirect).toHaveBeenCalledWith("/issues");
  });

  it("preserves one valid issue identifier without forwarding other query values", async () => {
    await ReportPage({ searchParams: Promise.resolve({ issue: "123e4567-e89b-42d3-a456-426614174000" }) });
    await ReportPage({ searchParams: Promise.resolve({ issue: ["123e4567-e89b-42d3-a456-426614174000"] }) });

    expect(redirects.permanentRedirect).toHaveBeenNthCalledWith(
      1,
      "/issues#issue-123e4567-e89b-42d3-a456-426614174000",
    );
    expect(redirects.permanentRedirect).toHaveBeenLastCalledWith("/issues");
  });
});
