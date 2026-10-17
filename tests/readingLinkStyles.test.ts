import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function rules(css: string) {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selector: match[1].replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ").trim(),
    body: match[2],
  }));
}

function declarations(body: string) {
  return Object.fromEntries(body.split(";").flatMap((entry) => {
    const index = entry.indexOf(":");
    if (index < 0) return [];
    return [[entry.slice(0, index).trim(), entry.slice(index + 1).trim()]];
  }));
}

const newspaper = rules(readFileSync("src/components/newspaper/newspaper.css", "utf8"));
const reading = rules(readFileSync("src/components/newspaper/reading.css", "utf8"));
const interactions = rules(readFileSync("src/components/newspaper/interactions.css", "utf8"));

describe("reading-link style ownership", () => {
  it("does not let chart SVG margins reach directional arrows", () => {
    const colliding = newspaper.filter(({ selector }) =>
      /(?:^|,)\s*\.newspaper\s+\.charts\s+(?:svg|circle|text)(?:\s|,|$)/.test(selector) ||
      selector === ".newspaper .charts svg",
    );
    expect(colliding).toEqual([]);
    expect(newspaper.some(({ selector }) => selector.includes(".radar-plot"))).toBe(true);
  });

  it("keeps generic newspaper link hover and footer stretch off reading links", () => {
    const hover = newspaper.find(({ selector }) => selector.includes(".story-title:hover"));
    expect(hover?.selector).toContain("a:not(.reading-link):hover");
    const footer = newspaper.filter(({ selector }) => selector.includes("footer section:nth-child(2)") && selector.includes(">a"));
    expect(footer.every(({ selector }) => selector.includes(":not(.reading-link)"))).toBe(true);
    const wire = newspaper.find(({ selector }) => selector.includes(".np-wire") && selector.includes("a") && selector.includes("hover"));
    expect(wire?.selector).toContain("a:not(.reading-link)");
  });

  it("does not pad or un-pad leftover .action hooks on shared reading links", () => {
    const storyAction = newspaper.filter(({ selector }) => selector.includes(".stories") && selector.includes(".action"));
    const reportAction = newspaper.filter(({ selector }) => selector.includes(".report-actions") && /\.action|\.chart-link/.test(selector));
    expect(storyAction.flatMap(({ body }) => Object.keys(declarations(body)))).not.toContain("padding-top");
    expect(storyAction.flatMap(({ body }) => Object.keys(declarations(body)))).not.toContain("padding");
    expect(reportAction).toEqual([]);
  });

  it("keeps compact reading links shrink-wrapped so flex parents cannot stretch them", () => {
    const link = reading.find(({ selector }) => selector === ".newspaper .reading-link");
    expect(link).toBeDefined();
    const box = declarations(link!.body);
    expect(box["align-self"]).toBe("start");
    expect(box["justify-self"]).toBe("start");
    expect(box.width).toBe("max-content");
    expect(box["max-width"]).toBe("100%");
    expect(box["justify-content"]).toBe("flex-start");
    expect(box.padding).toBe("10px 14px");
    const iconSvg = reading.find(({ selector }) => selector.includes(".reading-link__icon svg"));
    expect(declarations(iconSvg!.body).margin).toBe("0");
  });

  it("does not restyle the lead action through the leftover .action class", () => {
    expect(interactions.some(({ selector }) => selector.includes(".front-page-lead") && selector.includes(".action"))).toBe(false);
  });

  it("keeps the method note as an inline citation instead of a reading action", () => {
    const source = readFileSync("src/components/newspaper/IssueBoard.tsx", "utf8");
    expect(source).toContain('<a href="/about#registers">Read the method</a>');
    expect(source).not.toMatch(/board-method[\s\S]*<ReadingLink href="\/about#registers"/);
  });
});
