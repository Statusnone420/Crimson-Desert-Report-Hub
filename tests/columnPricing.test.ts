import { describe, expect, it } from "vitest";
import { costFromUsage, HAIKU_LONG_PROMPT_PRICES, PRICES_PER_MILLION, worstCaseCost } from "@/lib/editorials/pricing";

describe("the column's pinned price table", () => {
  it("pins every model's rates in USD per million tokens", () => {
    expect(PRICES_PER_MILLION).toEqual({
      "claude-fable-5-1": { input: 10, output: 50, cacheWrite: 12.5, cacheRead: 0.25 },
      "claude-opus-5-5": { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
      "claude-sonnet-5-5": { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.1 },
      "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 },
    });
    expect(HAIKU_LONG_PROMPT_PRICES).toEqual({ input: 0.5, output: 2.5, cacheWrite: 0.625, cacheRead: 0.05 });
  });

  it("costs a call from its usage, cache writes and reads included", () => {
    const usage = { inputTokens: 1_000_000, cacheWriteTokens: 1_000_000, cacheReadTokens: 1_000_000, outputTokens: 1_000_000 };
    expect(costFromUsage("claude-opus-5-5", usage)).toBeCloseTo(4 + 5 + 0.2 + 20);
    expect(costFromUsage("claude-fable-5-1", usage)).toBeCloseTo(10 + 12.5 + 0.25 + 50);
    expect(costFromUsage("claude-sonnet-5-5", { inputTokens: 2000, cacheWriteTokens: 0, cacheReadTokens: 10_000, outputTokens: 3000 })).toBeCloseTo((2000 * 2 + 10_000 * 0.1 + 3000 * 10) / 1e6);
  });

  it("bills a whole Haiku request at the long-prompt rates once its prompt passes 100k tokens", () => {
    const at = (inputTokens: number, cacheReadTokens = 0) => costFromUsage("claude-haiku-5-5", { inputTokens, cacheWriteTokens: 0, cacheReadTokens, outputTokens: 1000 });
    expect(at(100_000)).toBeCloseTo((100_000 * 0.1 + 1000 * 0.5) / 1e6);
    expect(at(100_001)).toBeCloseTo((100_001 * 0.5 + 1000 * 2.5) / 1e6);
    expect(at(60_000, 40_001)).toBeCloseTo((60_000 * 0.5 + 40_001 * 0.05 + 1000 * 2.5) / 1e6);
  });

  it("reserves the worst case: every prompt token at the dearer of input and cache write, plus every output token", () => {
    expect(worstCaseCost("claude-opus-5-5", 10_000, 8000)).toBeCloseTo((10_000 * 5 + 8000 * 20) / 1e6);
    expect(worstCaseCost("claude-haiku-5-5", 10_000, 16_000)).toBeCloseTo((10_000 * 0.125 + 16_000 * 0.5) / 1e6);
    expect(worstCaseCost("claude-fable-5-1", 30_000, 8000)).toBeLessThan(1);
  });
});
