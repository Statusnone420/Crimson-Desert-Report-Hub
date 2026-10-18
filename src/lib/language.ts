// Function words that mark Latin-script text as another language, taken from
// the game's largest Steam review languages after English (2026-10-18 counts:
// Brazilian Portuguese, French, Spanish, German, Turkish, Polish, Italian).
// Words English also uses ("as", "to", "do", "on", "per", "um", "die"...) are left out,
// and so are single letters ("y", "o", "e"), which English uses for keys and codes
// ("Press E", "Error E100").
const NON_ENGLISH_FUNCTION_WORDS = new Set([
  "der", "das", "und", "nicht", "ist", "ein", "eine", "ich", "mit", "auf", "sich", "auch", "dem", "den", "wenn", "aber", "noch", "spiel", "sehr", "schon", "kann",
  "le", "la", "les", "et", "est", "pas", "une", "des", "du", "je", "qui", "dans", "pour", "avec", "sur", "mais", "très", "plus", "jeu", "cette",
  "el", "los", "las", "es", "una", "que", "por", "para", "con", "pero", "muy", "más", "juego", "del", "al", "lo", "como", "está", "hay", "de",
  "os", "é", "uma", "não", "nao", "com", "mas", "muito", "jogo", "mais", "isso", "eu",
  "bir", "ve", "bu", "çok", "için", "ama", "oyun", "daha", "gibi", "ile", "değil", "yok",
  "nie", "jest", "się", "że", "gra", "ale", "jak", "bardzo", "tak",
  "il", "di", "che", "non", "sono", "gioco", "ma", "molto", "più", "della", "è", "questo",
]);
const ENGLISH_FUNCTION_WORDS = new Set([
  "the", "and", "is", "it", "to", "of", "in", "for", "this", "that", "with", "on", "but", "was", "are", "you", "have", "not", "be", "my", "i", "game",
]);
// Letters of the game's big Latin-script review languages that English text does not use.
const FOREIGN_LATIN_LETTERS = /[äöüßçşğıłśżźęąńõãñáéíóúàèìòùâêîôûœæø]/iu;

/**
 * Problem words in the same languages, as regular expression sources: `\p{L}*`
 * marks a stem that takes any ending. The scanner's symptom check reads them
 * as reports. None of them occurs in English, so they also mark a short report
 * as another language ("Pantalla negra", "Czarny ekran", "Errore").
 */
export const LATIN_SCRIPT_SYMPTOM_TERMS: readonly string[] = [
  // German
  // Separable verbs split around other words: "Das Spiel stürzt ständig ab".
  "absturz\\p{L}*", "abstürz\\p{L}*", "st(?:ü|ue)rzt(?:\\s+\\p{L}+){0,4}\\s+ab", "friert(?:\\s+\\p{L}+){0,4}\\s+ein", "eingefroren",
  "ruckel\\p{L}*", "ruckler", "startet nicht", "funktioniert nicht", "schwarzer bildschirm", "verbuggt",
  "h(?:ä|ae)ngt sich(?:\\s+\\p{L}+){0,3}\\s+auf",
  // French
  "plantage\\p{L}*", "(?:jeu|il|ça|ca)\\s+plante", "écran noir", "ecran noir", "ne se lance pas", "ne démarre pas", "ne fonctionne pas",
  // Past participles only: "bloquer" is the combat verb "to block".
  "bugu[ée]\\p{L}*", "saccade\\p{L}*", "bloqu(?:é|ée|és|ées)",
  // Spanish
  "se cierra", "crashea\\p{L}*", "se congela\\p{L}*", "pantalla negra", "no funciona", "no inicia", "no arranca", "tirones",
  "buguead\\p{L}*", "bugead\\p{L}*", "se traba\\p{L}*",
  // Portuguese
  "(?:jogo|game)\\s+trava\\p{L}*", "travamento\\p{L}*", "crashand\\p{L}*", "fecha sozinho", "tela preta", "não funciona", "nao funciona",
  "não abre", "nao abre", "bugad\\p{L}*", "bugou",
  // Turkish
  "çök(?:üyor|tü|me|üyo)\\p{L}*", "donuyor", "dondu", "takılıyor", "kasıyor", "kasma\\p{L}*", "açılmıyor", "çalışmıyor",
  "siyah ekran", "masaüstüne atıyor",
  // Polish
  "crashuje", "wywala\\p{L}*", "zawiesza się", "zacina się", "przycina", "błąd", "błędy", "błędów", "nie działa",
  "nie uruchamia się", "czarny ekran", "zbugowan\\p{L}*",
  // Italian
  "crasha\\p{L}*", "si blocca", "si chiude", "scatti", "errore", "buggat\\p{L}*", "non funziona", "non si avvia", "schermo nero",
];
const FOREIGN_SYMPTOM = new RegExp(String.raw`(?<![\p{L}\p{N}])(?:${LATIN_SCRIPT_SYMPTOM_TERMS.join("|")})(?![\p{L}\p{N}])`, "iu");

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
  const raw = text ?? "";
  const allCapitals = raw === raw.toUpperCase();
  const words = raw.match(/\p{L}+/gu) ?? [];
  for (const token of words) {
    const word = token.toLowerCase();
    if (ENGLISH_FUNCTION_WORDS.has(word)) english += 1;
    else if (NON_ENGLISH_FUNCTION_WORDS.has(word)) {
      // Short capitals in mixed-case text are English abbreviations
      // ("EU servers", "Windows OS", "8pm ET"), not function words.
      if (!allCapitals && token.length <= 3 && token === token.toUpperCase()) continue;
      foreign += 1;
    }
  }
  if (foreign >= 2 && foreign > english) return true;
  // A short report carries one marker at most ("Spiel stürzt ab", "Gra wywala",
  // "Oyun çöküyor", "Pantalla negra"): a foreign function word, letters English
  // does not use, or a problem word in another language, with no English
  // function word beside it.
  return words.length <= 8 && english === 0 && (foreign >= 1 || FOREIGN_LATIN_LETTERS.test(raw) || FOREIGN_SYMPTOM.test(raw));
}

/** Shown in place of a title or snippet in another language. */
export const NOT_IN_ENGLISH = "Not in English (original hidden)";

/** The text itself when it is English, or the placeholder when it is not. */
export function englishOnly(text: string): string {
  return isMostlyNonEnglish(text) ? NOT_IN_ENGLISH : text;
}
