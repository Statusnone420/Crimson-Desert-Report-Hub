import { describe, expect, it } from "vitest";
import { classifySignal, summarize } from "@/lib/reddit";

describe("classifySignal", () => {
  it("routes performance language", () => {
    expect(classifySignal("Constant FPS drops and stutter since 1.13").category).toBe("performance");
  });

  it("routes crash language", () => {
    expect(classifySignal("Game crashes to desktop when opening the map").category).toBe("crash_startup");
  });

  it("routes controls language", () => {
    expect(classifySignal("My horse controls completely lock up randomly").category).toBe("controls_gameplay");
  });

  it("falls back to other with low confidence", () => {
    const result = classifySignal("Anyone else think the soundtrack is great?");
    expect(result.category).toBe("other");
    expect(result.confidence).toBe("low");
  });
});

describe("summarize", () => {
  it("truncates to 280 chars with ellipsis and strips newlines", () => {
    const summary = summarize("Title here", `${"x".repeat(500)}\nline2`);
    expect(summary.length).toBeLessThanOrEqual(280);
    expect(summary.startsWith("Title here - ")).toBe(true);
    expect(summary.includes("\n")).toBe(false);
    expect(summary.endsWith("...")).toBe(true);
  });
});
