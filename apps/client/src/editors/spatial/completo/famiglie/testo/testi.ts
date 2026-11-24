// I testi della famiglia «testo» del Disegno completo (piano K6): le chiavi
// delle sue finestre e sezioni che l'indice generato non porta. Trova e
// sostituisci e Inserisci carattere (T16) leggono `descrizione:`, `azione:` e `campo:` (`finestraDi`
// di `../../index.ts`).

export const TESTI: Readonly<
  Record<string, { readonly it: string; readonly en: string }>
> = {
  "descrizione:edit.findReplace": {
    it: "Cerca le parole in tutti i testi del disegno e le sostituisce. Una parola non si trova se è a cavallo di due stili.",
    en: "Finds the words in every text of the drawing and replaces them. A word split across two styles is not found.",
  },
  "azione:edit.findReplace": { it: "Sostituisci tutto", en: "Replace all" },
  "campo:find": { it: "Trova", en: "Find" },
  "campo:replace": { it: "Sostituisci con", en: "Replace with" },
  "campo:matchCase": { it: "Maiuscole e minuscole uguali", en: "Match case" },
  "campo:wholeWord": { it: "Solo parole intere", en: "Whole words only" },
  "descrizione:type.insert": {
    it: "Aggiunge il carattere in fondo a ogni testo scelto.",
    en: "Adds the character at the end of every selected text.",
  },
  "azione:type.insert": { it: "Inserisci", en: "Insert" },
  "campo:char": { it: "Carattere", en: "Character" },
  "scelta:char:bullet": { it: "Punto elenco •", en: "Bullet •" },
  "scelta:char:copyright": { it: "Copyright ©", en: "Copyright ©" },
  "scelta:char:ellipsis": { it: "Puntini di sospensione …", en: "Ellipsis …" },
  "scelta:char:paragraph": {
    it: "Simbolo di paragrafo ¶",
    en: "Paragraph symbol ¶",
  },
  "scelta:char:registered": {
    it: "Marchio registrato ®",
    en: "Registered trademark ®",
  },
  "scelta:char:section": { it: "Simbolo di sezione §", en: "Section symbol §" },
  "scelta:char:trademark": { it: "Marchio ™", en: "Trademark ™" },
  "scelta:char:emDash": { it: "Lineetta lunga —", en: "Em dash —" },
  "scelta:char:enDash": { it: "Lineetta media –", en: "En dash –" },
  "scelta:char:discretionaryHyphen": {
    it: "Trattino facoltativo",
    en: "Discretionary hyphen",
  },
  "scelta:char:nonBreakingHyphen": {
    it: "Trattino unificatore",
    en: "Nonbreaking hyphen",
  },
  "scelta:char:doubleLeftQuote": {
    it: "Virgolette doppie aperte “",
    en: "Double left quotation mark “",
  },
  "scelta:char:doubleRightQuote": {
    it: "Virgolette doppie chiuse ”",
    en: "Double right quotation mark ”",
  },
  "scelta:char:singleLeftQuote": {
    it: "Virgoletta singola aperta ‘",
    en: "Single left quotation mark ‘",
  },
  "scelta:char:singleRightQuote": {
    it: "Virgoletta singola chiusa ’",
    en: "Single right quotation mark ’",
  },
  "scelta:char:emSpace": { it: "Spazio lungo (em)", en: "Em space" },
  "scelta:char:enSpace": { it: "Spazio medio (en)", en: "En space" },
  "scelta:char:hairSpace": { it: "Spazio capillare", en: "Hair space" },
  "scelta:char:sixthSpace": { it: "Spazio di un sesto", en: "Sixth space" },
  "scelta:char:thinSpace": { it: "Spazio sottile", en: "Thin space" },
  "scelta:char:nonBreakingSpace": {
    it: "Spazio unificatore",
    en: "Nonbreaking space",
  },
  "scelta:char:figureSpace": { it: "Spazio cifra", en: "Figure space" },
  "scelta:char:punctuationSpace": {
    it: "Spazio punteggiatura",
    en: "Punctuation space",
  },
  "scelta:char:thirdSpace": { it: "Spazio di un terzo", en: "Third space" },
  "scelta:char:quarterSpace": {
    it: "Spazio di un quarto",
    en: "Quarter space",
  },
  "scelta:char:tab": { it: "Tabulazione", en: "Tab" },
  "scelta:char:forcedLineBreak": {
    it: "Interruzione di riga forzata",
    en: "Forced line break",
  },
  "scelta:char:paragraphReturn": {
    it: "A capo di paragrafo",
    en: "Paragraph return",
  },
};
