// Function words that mark Latin-script text as another language, taken from
// the game's largest Steam review languages after English (2026-10-18 counts:
// Brazilian Portuguese, French, Spanish, German, Turkish, Polish, Italian).
// Words English also uses ("as", "to", "do", "on", "per", "um", "die"...) are left out.
const NON_ENGLISH_FUNCTION_WORDS = new Set([
  "der", "das", "und", "nicht", "ist", "ein", "eine", "ich", "mit", "auf", "sich", "auch", "dem", "den", "wenn", "aber", "noch", "spiel", "sehr", "schon", "kann",
  "le", "la", "les", "et", "est", "pas", "une", "des", "du", "je", "qui", "dans", "pour", "avec", "sur", "mais", "très", "plus", "jeu", "cette",
  "el", "los", "las", "y", "es", "una", "que", "por", "para", "con", "pero", "muy", "más", "juego", "del", "al", "lo", "como", "está", "hay", "de",
  "o", "os", "e", "é", "uma", "não", "nao", "com", "mas", "muito", "jogo", "mais", "isso", "eu",
  "bir", "ve", "bu", "çok", "için", "ama", "oyun", "daha", "gibi", "ile", "değil", "yok",
  "nie", "jest", "się", "że", "gra", "ale", "jak", "bardzo", "tak",
  "il", "di", "che", "non", "sono", "gioco", "ma", "molto", "più", "della", "è", "questo",
]);
const ENGLISH_FUNCTION_WORDS = new Set([
  "the", "and", "is", "it", "to", "of", "in", "for", "this", "that", "with", "on", "but", "was", "are", "you", "have", "not", "be", "my", "i", "game",
]);

/**
 * True when text is mostly in another language: a third or more of its letters
 * are outside the Latin script (Chinese, Korean, Russian, Japanese, Thai...),
 * or its Latin words are more often another language's function words than
 * English ones. The owner reads English only, so the scanner uses this both to
 * parse other languages and to keep their text out of every screen.
 */
export function isMostlyNonEnglish(text: string | null | undefined): boolean {
  const letters = text?.match(/\p{L}/gu) ?? [];
  if (letters.length === 0) return false;
  const nonLatin = letters.filter((letter) => !/\p{Script=Latin}/u.test(letter)).length;
  if (nonLatin / letters.length >= 1 / 3) return true;
  let foreign = 0;
  let english = 0;
  for (const word of text?.toLowerCase().match(/\p{L}+/gu) ?? []) {
    if (NON_ENGLISH_FUNCTION_WORDS.has(word)) foreign += 1;
    else if (ENGLISH_FUNCTION_WORDS.has(word)) english += 1;
  }
  return foreign >= 2 && foreign > english;
}

/** Shown in place of a title or snippet in another language. */
export const NOT_IN_ENGLISH = "Not in English (original hidden)";

/** The text itself when it is English, or the placeholder when it is not. */
export function englishOnly(text: string): string {
  return isMostlyNonEnglish(text) ? NOT_IN_ENGLISH : text;
}
