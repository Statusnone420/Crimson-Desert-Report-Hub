import { z } from "zod";
import { SITE_URL } from "@/lib/site";

export const COLUMN_NAME = "State of the Game";
export const COLUMN_SECTION = "The Pywel Desk";
export const COLUMN_AUTHOR = "Statusnone";
export const EDITORIAL_PATH_PREFIX = "/editorials";

export type EditionSource = { id: string; label: string; url: string };
export type EditionFact = { text: string; sourceIds: string[] };
export type EditionSection = { subhead: string; paragraphs: string[] };
export type FactsBox = { items: EditionFact[]; sources: EditionSource[] };

/** What a public page, feed or sitemap may know about an edition. Private columns never reach it. */
export type PublicEdition = {
  id: string;
  slug: string;
  title: string;
  dek: string | null;
  sections: EditionSection[];
  factsBox: FactsBox;
  publishAt: string;
  author: typeof COLUMN_AUTHOR;
};

/** The public columns of an editorials row. Selecting exactly these keeps private data out. */
export const PUBLIC_EDITORIAL_COLUMNS = "id, slug, title, dek, body_md, facts_box, status, publish_at, vetoed_at, is_test, author";

export type PublicEditorialRow = {
  id: string;
  slug: string | null;
  title: string | null;
  dek: string | null;
  body_md: string | null;
  facts_box: unknown;
  status: string;
  publish_at: string | null;
  vetoed_at: string | null;
  is_test: boolean;
  author: string;
};

const OFFICIAL_HOST = "crimsondesert.pearlabyss.com";
const HUB_HOST = new URL(SITE_URL).hostname;

/** Sources are Hub pages or official Pearl Abyss pages only. */
export function isPublicSourceUrl(value: string): boolean {
  if (value.startsWith("/")) return !value.startsWith("//") && !/[\s\\]/.test(value);
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === OFFICIAL_HOST || url.hostname === HUB_HOST) && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** Who published a source, by its host. A Hub page can be a path or an absolute Hub URL. */
export function sourceProvenance(value: string): string {
  if (value.startsWith("/")) return "Crimson Desert Report Hub";
  try {
    const host = new URL(value).hostname;
    if (host === HUB_HOST) return "Crimson Desert Report Hub";
    if (host === OFFICIAL_HOST) return "Pearl Abyss";
  } catch {
    // isPublicSourceUrl has already refused anything unparseable.
  }
  return "Source";
}

export function absoluteSourceUrl(value: string): string {
  return value.startsWith("/") ? `${SITE_URL}${value}` : value;
}

const sourceSchema = z.object({
  id: z.string().regex(/^[A-Z][0-9]{1,3}$/),
  label: z.string().trim().min(1).max(160),
  url: z.string().min(1).max(500).refine(isPublicSourceUrl),
});

export const factsBoxSchema = z.object({
  items: z.array(z.object({
    text: z.string().trim().min(1).max(400),
    sourceIds: z.array(z.string().regex(/^[A-Z][0-9]{1,3}$/)).min(1).max(6),
  })).min(1).max(8),
  sources: z.array(sourceSchema).min(1).max(40),
}).refine((box) => box.items.every((item) => item.sourceIds.every((id) => box.sources.some((source) => source.id === id))), {
  message: "Every fact cites a listed source.",
}).refine((box) => new Set(box.sources.map((source) => source.id)).size === box.sources.length, {
  message: "Each source id is listed once, so every citation has one clear source.",
});

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** Sections as stored Markdown: a "## " subhead line, then paragraphs separated by blank lines. */
export function sectionsToMarkdown(sections: readonly EditionSection[]): string {
  return sections
    .map((section) => [`## ${oneLine(section.subhead)}`, ...section.paragraphs.map(oneLine).filter(Boolean)].join("\n\n"))
    .join("\n\n");
}

/** Reads back only the Markdown that sectionsToMarkdown writes. */
export function markdownToSections(markdown: string): EditionSection[] | null {
  const sections: EditionSection[] = [];
  for (const block of markdown.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean)) {
    if (block.startsWith("## ")) sections.push({ subhead: oneLine(block.slice(3)), paragraphs: [] });
    else if (sections.length) sections[sections.length - 1].paragraphs.push(oneLine(block));
    else return null;
  }
  return sections.length && sections.every((section) => section.subhead && section.paragraphs.length) ? sections : null;
}

/** A row becomes a public edition only when every public field is well formed. */
export function toPublicEdition(row: PublicEditorialRow): PublicEdition | null {
  if (!row.slug || !row.title || !row.body_md || !row.publish_at || row.author !== COLUMN_AUTHOR) return null;
  const sections = markdownToSections(row.body_md);
  const factsBox = factsBoxSchema.safeParse(row.facts_box);
  if (!sections || !factsBox.success) return null;
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    dek: row.dek,
    sections,
    factsBox: factsBox.data,
    publishAt: row.publish_at,
    author: COLUMN_AUTHOR,
  };
}

export function editorialPath(slug: string): `/editorials/${string}` {
  return `${EDITORIAL_PATH_PREFIX}/${slug}` as `/editorials/${string}`;
}

/** Every public timestamp uses one format: "Oct 18, 16:00 UTC". */
export function formatUtcTimestamp(iso: string): string {
  const date = new Date(iso);
  const month = date.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const time = date.toLocaleString("en-US", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" });
  return `${month} ${date.getUTCDate()}, ${time} UTC`;
}

export function editionDescription(edition: PublicEdition): string {
  return edition.dek ?? edition.sections[0].paragraphs[0];
}
