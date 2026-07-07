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

  it("routes patch-note quest language", () => {
    expect(classifySignal("Fixed a quest that could not be completed").category).toBe("quest_progression");
  });

  it("prefers audio over quest when both terms appear", () => {
    // audio rule is ordered before quest, so 'audio' wins over 'cutscenes'
    expect(classifySignal("Fixed missing audio during cutscenes").category).toBe("audio");
  });

  it("routes voice/dialogue language to audio", () => {
    expect(classifySignal("Fixed voice lines not playing in dialogue").category).toBe("audio");
  });

  it("routes patch-note startup black screen to crash_startup", () => {
    expect(classifySignal("Fixed a black screen on startup").category).toBe("crash_startup");
  });

  it("routes shadow/rendering language to graphics_visual", () => {
    expect(classifySignal("Improved shadow rendering quality").category).toBe("graphics_visual");
  });

  it("routes loading-time language to performance", () => {
    expect(classifySignal("Reduced loading times").category).toBe("performance");
  });

  it("keeps non-issue patch-note lines as other", () => {
    expect(classifySignal("Added three new armor sets").category).toBe("other");
  });
});

describe("summarize", () => {
  it("truncates to 280 chars with ellipsis and strips newlines", () => {
    const summary = summarize(`${"Title ".repeat(80)}\nline2`, "body text");
    expect(summary.length).toBeLessThanOrEqual(280);
    expect(summary.startsWith("Title Title")).toBe(true);
    expect(summary.includes("\n")).toBe(false);
    expect(summary.endsWith("...")).toBe(true);
  });

  it("does not copy raw body text into the retained summary", () => {
    const summary = summarize("Map crash report", "private repro details token-abc-123");
    expect(summary).toContain("Map crash report");
    expect(summary).toContain("body retained for 48h");
    expect(summary).not.toContain("token-abc-123");
  });
});
