import { z } from "zod";

/** Fact ids: one capital letter for the kind (P patch, F fix, S Steam, T Twitch, C issue, K check-ins), then a number. */
export const FACT_ID = /^[A-Z][0-9]{1,3}$/;
const FACT_ID_PATTERN = "^[A-Z][0-9]{1,3}$";

const sourcedText = {
  type: "object",
  properties: {
    text: { type: "string" },
    sourceIds: { type: "array", items: { type: "string", pattern: FACT_ID_PATTERN } },
  },
  required: ["text", "sourceIds"],
  additionalProperties: false,
} as const;

/**
 * The writer's reply. Structured outputs accept no length or count limits, so the
 * schema stays plain and the zod schema below enforces the limits after the call.
 */
export const WRITER_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    dek: { type: "string" },
    sections: {
      type: "array",
      items: {
        type: "object",
        properties: { subhead: { type: "string" }, paragraphs: { type: "array", items: sourcedText } },
        required: ["subhead", "paragraphs"],
        additionalProperties: false,
      },
    },
    factsBox: { type: "array", items: sourcedText },
  },
  required: ["title", "dek", "sections", "factsBox"],
  additionalProperties: false,
} as const;

const sourcedTextSchema = z.object({
  text: z.string().trim().min(1).max(1200),
  sourceIds: z.array(z.string().regex(FACT_ID)).max(12),
});

export const writerOutputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  dek: z.string().trim().min(1).max(400),
  sections: z.array(z.object({
    subhead: z.string().trim().min(1).max(120),
    paragraphs: z.array(sourcedTextSchema).min(1).max(8),
  })).min(1).max(8),
  factsBox: z.array(sourcedTextSchema).max(10),
});

export type WriterOutput = z.infer<typeof writerOutputSchema>;

export const CHECKER_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    sentences: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          supported: { type: "boolean" },
          citedIds: { type: "array", items: { type: "string" } },
          namesPerson: { type: "boolean" },
          quotesPlayer: { type: "boolean" },
          bannedWords: { type: "array", items: { type: "string" } },
          slopRules: { type: "array", items: { type: "integer" } },
        },
        required: ["id", "supported", "citedIds", "namesPerson", "quotesPlayer", "bannedWords", "slopRules"],
        additionalProperties: false,
      },
    },
  },
  required: ["sentences"],
  additionalProperties: false,
} as const;

export const checkerOutputSchema = z.object({
  sentences: z.array(z.object({
    id: z.string().max(12),
    supported: z.boolean(),
    citedIds: z.array(z.string().max(8)).max(20),
    namesPerson: z.boolean(),
    quotesPlayer: z.boolean(),
    bannedWords: z.array(z.string().max(60)).max(20),
    slopRules: z.array(z.number().int()).max(15),
  })).max(400),
});

export type CheckerOutput = z.infer<typeof checkerOutputSchema>;
export type CheckerVerdict = CheckerOutput["sentences"][number];

/** Parse a structured reply and re-validate it. Anything malformed is null. */
export function parseStructured<T>(text: string | null, schema: z.ZodType<T>): T | null {
  if (!text) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
