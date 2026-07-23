import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConfirmButtons } from "@/components/ConfirmButtons";

describe("ConfirmButtons", () => {
  it("names the player check-in group with its visible question", () => {
    const markup = renderToStaticMarkup(createElement(ConfirmButtons, {
      clusterId: "cluster-1",
      storageScope: "patch-1",
      question: "Player check-in: Affecting you?",
      kinds: ["have_it"],
      counts: { have_it: 1 },
    }));
    const labelledBy = markup.match(/role="group" aria-labelledby="([^"]+)"/)?.[1];

    expect(labelledBy).toBeTruthy();
    expect(markup).toContain(`id="${labelledBy}"`);
    expect(markup).toContain("Player check-in: Affecting you?");
    expect(markup).toContain("Happening to me");
  });
});
