import { createElement, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: Omit<ComponentProps<"a">, "href"> & { href: string; children?: ReactNode }) =>
    createElement("a", { ...props, href }, children),
}));
vi.mock("@/components/ConfirmButtons", () => ({ ConfirmButtons: () => null }));

import { PublicScannerView } from "@/components/scanner/PublicScannerView";
import { emptyPatchRadarData } from "@/lib/radar.server";
import type { PublicScannerData } from "@/lib/queries";

const scoreboard = {
  reviewedThisWeek: 0,
  filteredThisWeek: 0,
  keptThisWeek: 0,
  awaiting: 0,
  published: 0,
  lastCheckedAt: null,
  scannerActive: false,
  scannerConnected: true,
  llmPaused: false,
  steamPulse: [],
  platformContext: null,
  pulseReadFailures: [],
} satisfies PublicScannerData;

function render(data: PublicScannerData) {
  const radar = emptyPatchRadarData({ version: "1.14.00", publishedAt: null });
  return renderToStaticMarkup(
    createElement(PublicScannerView, {
      data,
      radar: { ...radar, connected: true, activeLeadClusters: 3 },
      integrations: [],
      patchVersion: "1.14.00",
      leadQuestions: [],
    }),
  );
}

describe("PublicScannerView with a failed scoreboard read", () => {
  it("does not publish a zero-filled published count as a count", () => {
    const markup = render({ ...scoreboard, scannerConnected: false });

    expect(markup).toContain("The scanner read failed, so this count is unavailable — not zero");
    // The cell renders the word, not the placeholder number behind it.
    expect(markup).toContain('<div class="stat-band__value">Unavailable</div>');
    expect(markup).not.toContain("Full cards on the issue board");
  });

  it("does not claim every problem area carries a public link", () => {
    // `awaiting` is zero-filled when the read failed, and this is the strongest
    // claim on the public page — it must never be derived from an unread number.
    const markup = render({ ...scoreboard, scannerConnected: false });

    expect(markup).not.toContain("Every area carries a public link or an approved report");
    expect(markup).toContain("Whether each one carries a public link is unavailable right now");
  });

  it("still makes the claim when the read succeeded and nothing is awaiting", () => {
    const markup = render(scoreboard);

    expect(markup).toContain("Every area carries a public link or an approved report");
  });
});
