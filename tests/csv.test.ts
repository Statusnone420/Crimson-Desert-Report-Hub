import { describe, expect, it } from "vitest";
import { buildCsv, csvEscape, neutralizeSpreadsheetFormula } from "@/lib/csv";

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

describe("neutralizeSpreadsheetFormula", () => {
  it("prefixes an apostrophe when the first non-whitespace character starts a formula", () => {
    expect(neutralizeSpreadsheetFormula("=SUM(A1:A9)")).toBe("'=SUM(A1:A9)");
    expect(neutralizeSpreadsheetFormula("+1+1")).toBe("'+1+1");
    expect(neutralizeSpreadsheetFormula("-2+3")).toBe("'-2+3");
    expect(neutralizeSpreadsheetFormula("@cmd")).toBe("'@cmd");
    expect(neutralizeSpreadsheetFormula("  =late")).toBe("'  =late");
  });

  it("prefixes an apostrophe when the cell begins with a tab or carriage return", () => {
    expect(neutralizeSpreadsheetFormula("\tvalue")).toBe("'\tvalue");
    expect(neutralizeSpreadsheetFormula("\rvalue")).toBe("'\rvalue");
  });

  it("leaves ordinary text alone, including mid-string formula characters", () => {
    expect(neutralizeSpreadsheetFormula("hello")).toBe("hello");
    expect(neutralizeSpreadsheetFormula("a=b")).toBe("a=b");
    expect(neutralizeSpreadsheetFormula("save at 99%")).toBe("save at 99%");
    expect(neutralizeSpreadsheetFormula("")).toBe("");
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

  it("neutralizes formula cells before structural quoting", () => {
    const rows = [{ a: '=HYPERLINK("http://evil,example")', b: "-fps drops", c: 42 }];
    const csv = buildCsv(rows, ["a", "b", "c"]);
    // The apostrophe lands inside the quoted cell; non-string values never gain one.
    expect(csv).toBe('a,b,c\r\n"\'=HYPERLINK(""http://evil,example"")",\'-fps drops,42');
  });
});
