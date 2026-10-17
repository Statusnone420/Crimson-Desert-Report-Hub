import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { ScanControls } from "@/components/ScanControls";

describe("ScanControls", () => {
  it("shows the provider smoke and disables full scans in preview", () => {
    const markup = renderToStaticMarkup(createElement(ScanControls, { activeRunId: null, isPreview: true }));

    expect(markup).toContain("Test AI provider route");
    expect(markup).toContain("one AI call, and no database writes");
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Test scan without publishing<\/button>/);
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Run capped scan now<\/button>/);
  });

  it("keeps the provider smoke out of production and leaves scan controls enabled", () => {
    const markup = renderToStaticMarkup(createElement(ScanControls, { activeRunId: null, isPreview: false }));

    expect(markup).not.toContain("Test AI provider route");
    expect(markup).not.toContain("Preview keeps full scans disabled");
    expect(markup).not.toMatch(/<button[^>]*disabled=""[^>]*>Test scan without publishing<\/button>/);
    expect(markup).not.toMatch(/<button[^>]*disabled=""[^>]*>Run capped scan now<\/button>/);
  });
});
