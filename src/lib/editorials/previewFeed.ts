import { escapeXml } from "@/lib/editorialFeed";
import { COLUMN_AUTHOR, COLUMN_NAME, formatUtcTimestamp, markdownToSections } from "@/lib/editorials/content";
import { WRITER_MODEL_LABELS, isWriterModel } from "@/lib/editorials/models";
import { SITE_URL } from "@/lib/site";

export const PREVIEW_FEED_PATH = "/editorials/preview.xml";

/** The private fields the preview feed shows. fact_pack and check_report never reach it. */
export type PreviewEdition = {
  id: string;
  slot_key: string;
  is_test: boolean;
  status: "held" | "published" | "vetoed" | "skipped";
  title: string | null;
  dek: string | null;
  body_md: string | null;
  relevance_score: number | null;
  writer_model: string | null;
  writer_effort: string | null;
  skip_reason: string | null;
  /** The check report's note, such as what stopped a checker that never finished. */
  check_note: string | null;
  created_at: string;
  /** Moves on approval, veto and save, so feed readers pick up a changed status. */
  updated_at: string;
  publish_at: string | null;
  vetoed_at: string | null;
};

function modelLabel(model: string | null): string {
  if (!model) return "no model";
  return isWriterModel(model) ? WRITER_MODEL_LABELS[model] : model;
}

/** Where an edition stands right now, in the operator's words. */
export function previewStatusLabel(row: PreviewEdition, now: Date): string {
  if (row.status === "skipped") return `Skipped: ${row.skip_reason ?? "no reason recorded"}${row.check_note ? ` (${row.check_note})` : ""}`;
  if (row.status === "vetoed") return "Vetoed";
  if (row.is_test) return "Test draft";
  if (row.publish_at === null) return "Waiting for approval";
  if (Date.parse(row.publish_at) > now.getTime()) return `Held until ${formatUtcTimestamp(row.publish_at)}`;
  return "Published";
}

/**
 * When an entry last changed for a reader: its last write, or the moment its hold
 * ended and it went public, whichever is later. A hold ending writes nothing.
 */
export function previewUpdatedAt(row: PreviewEdition, now: Date): string {
  const published = row.publish_at && row.status !== "skipped" && row.status !== "vetoed" && Date.parse(row.publish_at) <= now.getTime() ? row.publish_at : null;
  return published && Date.parse(published) > Date.parse(row.updated_at) ? published : row.updated_at;
}

export function previewTitle(row: PreviewEdition, now: Date): string {
  // A skipped row's kept draft was never fact-checked, so the feed names only its slot.
  const title = row.status === "skipped" ? null : row.title;
  if (row.is_test) return `TEST · ${modelLabel(row.writer_model)} · ${title ?? "Untitled"}`;
  return `[${previewStatusLabel(row, now)}] ${title ?? `Slot ${row.slot_key}`}`;
}

function previewText(row: PreviewEdition, now: Date): string {
  const lines = [
    `Status: ${previewStatusLabel(row, now)}`,
    `Slot: ${row.slot_key}`,
    `Writer: ${modelLabel(row.writer_model)}${row.writer_effort ? ` (${row.writer_effort} effort)` : ""}`,
    `Relevance score: ${row.relevance_score ?? "not scored"}`,
  ];
  if (row.status === "skipped") return lines.join("\n");
  if (row.dek) lines.push("", row.dek);
  for (const section of row.body_md ? markdownToSections(row.body_md) ?? [] : []) {
    lines.push("", section.subhead.toUpperCase(), ...section.paragraphs);
  }
  return lines.join("\n");
}

/**
 * The private Atom preview: held, published, vetoed and skipped rows plus test drafts.
 * Links lead to the signed-in operator page, never to a public URL for a hidden edition.
 */
export function buildPreviewAtomXml(rows: readonly PreviewEdition[], now: Date): string {
  const operatorUrl = `${SITE_URL}/operator?view=column`;
  const updated = rows.map((row) => previewUpdatedAt(row, now)).reduce<string | null>((latest, value) => (!latest || Date.parse(value) > Date.parse(latest) ? value : latest), null);
  const entries = rows.map((row) => [
    "  <entry>",
    `    <id>urn:uuid:${escapeXml(row.id)}</id>`,
    `    <title>${escapeXml(previewTitle(row, now))}</title>`,
    `    <link rel="alternate" type="text/html" href="${escapeXml(`${operatorUrl}&edition=${row.id}`)}"/>`,
    `    <updated>${escapeXml(previewUpdatedAt(row, now))}</updated>`,
    `    <content type="text">${escapeXml(previewText(row, now))}</content>`,
    "  </entry>",
  ].join("\n")).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${escapeXml(`${COLUMN_NAME} preview`)}</title>
  <link rel="alternate" type="text/html" href="${escapeXml(operatorUrl)}"/>
  <id>${escapeXml(`${SITE_URL}${PREVIEW_FEED_PATH}`)}</id>
  <updated>${escapeXml(updated ?? now.toISOString())}</updated>
  <author>
    <name>${escapeXml(COLUMN_AUTHOR)}</name>
  </author>
${entries}
</feed>
`;
}
