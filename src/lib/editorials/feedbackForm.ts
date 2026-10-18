export const MAX_NOTE_CHARACTERS = 500;
export const MAX_EXAMPLE_CHARACTERS = 1500;
export const MAX_LABEL_CHARACTERS = 80;
export const MAX_VOICE_EXAMPLES = 5;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type StyleNoteInput = { editorialId: string | null; rating: "up" | "down" | null; note: string | null };
export type VoiceExampleInput = { id: string | null; body: string; label: string | null };

function value(formData: FormData, name: string): string {
  const raw = formData.get(name);
  return typeof raw === "string" ? raw : "";
}

/** A thumbs up or down, a note of up to 500 characters, or both. */
export function styleNoteFromForm(formData: FormData): StyleNoteInput | null {
  const editorialId = value(formData, "editorialId").trim();
  const rating = value(formData, "rating");
  const note = value(formData, "note").trim();
  if (editorialId && !UUID.test(editorialId)) return null;
  if (rating && rating !== "up" && rating !== "down") return null;
  if (note.length > MAX_NOTE_CHARACTERS || (!rating && !note)) return null;
  return { editorialId: editorialId || null, rating: rating ? rating as "up" | "down" : null, note: note || null };
}

/** One voice example: 1 to 1,500 characters, with an optional label of up to 80. */
export function voiceExampleFromForm(formData: FormData): VoiceExampleInput | null {
  const id = value(formData, "id").trim();
  const body = value(formData, "body").replace(/\r\n/g, "\n");
  const label = value(formData, "label").trim();
  if (id && !UUID.test(id)) return null;
  if (!body.trim() || body.length > MAX_EXAMPLE_CHARACTERS || label.length > MAX_LABEL_CHARACTERS) return null;
  return { id: id || null, body, label: label || null };
}
