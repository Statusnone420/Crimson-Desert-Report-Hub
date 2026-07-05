import { describe, expect, it } from "vitest";
import { buildCsv, csvEscape } from "@/lib/csv";

describe("csvEscape", () => {
  it("passes plain values, quotes commas/quotes/newlines, doubles quotes", () => {
    expect(csvEscape("hello")).toBe("hello");
    expect(csvEscape(null)).toBe("");
    expect(csvEscape(42)).toBe("42");
    expect(csvEscape("a,b")).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape("line1\nline2")).toBe('"line1\nline2"');
  });
});

describe("buildCsv", () => {
  it("emits header row plus data rows in column order", () => {
    const rows = [
      { b: "2", a: "1,x" },
      { a: "3", b: null },
    ];
    const csv = buildCsv(rows, ["a", "b"]);
    expect(csv).toBe('a,b\r\n"1,x",2\r\n3,');
  });
});
