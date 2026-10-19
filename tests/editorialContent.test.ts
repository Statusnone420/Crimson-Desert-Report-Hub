import { describe, expect, it } from "vitest";
import {
  formatUtcTimestamp,
  isPublicSourceUrl,
  sourceProvenance,
  markdownToSections,
  PUBLIC_EDITORIAL_COLUMNS,
  sectionsToMarkdown,
  toPublicEdition,
} from "@/lib/editorials/content";
import { editionSections, publicRow } from "./editorialFixtures";

describe("edition content", () => {
  it("stores sections as plain Markdown and reads them back", () => {
    const markdown = sectionsToMarkdown([{ subhead: "The  forecast\n", paragraphs: ["One.\nStill one.", "Two."] }]);
    expect(markdown).toBe("## The forecast\n\nOne. Still one.\n\nTwo.");
    expect(markdownToSections(markdown)).toEqual([{ subhead: "The forecast", paragraphs: ["One. Still one.", "Two."] }]);
    expect(markdownToSections(sectionsToMarkdown(editionSections))).toEqual(editionSections);
  });

  it("refuses Markdown it did not write", () => {
    expect(markdownToSections("A paragraph before any subhead.")).toBeNull();
    expect(markdownToSections("## A subhead with no paragraphs")).toBeNull();
    expect(markdownToSections("")).toBeNull();
  });

  it("allows only Hub pages and official Pearl Abyss pages as sources", () => {
    expect(isPublicSourceUrl("/patches/2-03-02")).toBe(true);
    expect(isPublicSourceUrl("https://crimsondesert.pearlabyss.com/en-us/News/Notice/Detail?_boardNo=140")).toBe(true);
    expect(isPublicSourceUrl("https://crimsonreporthub.com/issues")).toBe(true);
    expect(isPublicSourceUrl("//evil.example/path")).toBe(false);
    expect(isPublicSourceUrl("https://steamcommunity.com/app/3321460/discussions/0/1/")).toBe(false);
    expect(isPublicSourceUrl("http://crimsondesert.pearlabyss.com/")).toBe(false);
    expect(isPublicSourceUrl("javascript:alert(1)")).toBe(false);
  });

  it("names a source's publisher by its host, absolute Hub URLs included", () => {
    expect(sourceProvenance("/observatory#updates")).toBe("Crimson Desert Report Hub");
    expect(sourceProvenance("https://crimsonreporthub.com/issues")).toBe("Crimson Desert Report Hub");
    expect(sourceProvenance("https://crimsondesert.pearlabyss.com/en-us/News/Notice/Detail?_boardNo=140")).toBe("Pearl Abyss");
  });

  it("builds a public edition only from well-formed public fields", () => {
    expect(toPublicEdition(publicRow())).toMatchObject({ slug: "clear-skies-over-the-inventory-screen", author: "Statusnone", sections: editionSections });
    expect(toPublicEdition(publicRow({ facts_box: { items: [], sources: [] } }))).toBeNull();
    expect(toPublicEdition(publicRow({ body_md: "No subhead." }))).toBeNull();
    expect(toPublicEdition(publicRow({ author: "Someone else" }))).toBeNull();
    const unlisted = { items: [{ text: "A fact.", sourceIds: ["Z9"] }], sources: [{ id: "P1", label: "Notes", url: "/patches" }] };
    expect(toPublicEdition(publicRow({ facts_box: unlisted }))).toBeNull();
    const offsite = { items: [{ text: "A fact.", sourceIds: ["P1"] }], sources: [{ id: "P1", label: "A forum post", url: "https://forum.example/post/1" }] };
    expect(toPublicEdition(publicRow({ facts_box: offsite }))).toBeNull();
    const duplicate = { items: [{ text: "A fact.", sourceIds: ["P1"] }], sources: [{ id: "P1", label: "Notes", url: "/patches" }, { id: "P1", label: "Other", url: "/issues" }] };
    expect(toPublicEdition(publicRow({ facts_box: duplicate }))).toBeNull();
  });

  it("never selects private columns for public reads", () => {
    for (const column of ["fact_pack", "check_report", "writer_model", "writer_effort", "relevance_score", "skip_reason", "slot_key"]) {
      expect(PUBLIC_EDITORIAL_COLUMNS).not.toContain(column);
    }
  });

  it("writes every public time in the house UTC format", () => {
    expect(formatUtcTimestamp("2026-10-18T16:00:00Z")).toBe("Oct 18, 16:00 UTC");
    expect(formatUtcTimestamp("2026-11-02T00:05:00Z")).toBe("Nov 2, 00:05 UTC");
  });
});
