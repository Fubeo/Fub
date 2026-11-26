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
  // Opzioni testo in area (`text.areaOptions`), come in VectorCraft. Senza caratteri, e con
  // colonne, margine, allineamento verticale, il motore rifiuta: il formato del testo non li scrive.
  "descrizione:text.areaOptions": {
    it: "Misure, righe e colonne del testo in area scelto.",
    en: "Size, rows and columns of the selected area type.",
  },
  "azione:text.areaOptions": { it: "Applica", en: "Apply" },
  "campo:text.areaOptions:width": { it: "Larghezza", en: "Width" },
  "campo:text.areaOptions:height": { it: "Altezza", en: "Height" },
  "campo:text.areaOptions:rows": { it: "Righe", en: "Rows" },
  "campo:text.areaOptions:columns": { it: "Colonne", en: "Columns" },
  "campo:text.areaOptions:gutter": {
    it: "Spazio fra le colonne",
    en: "Column gutter",
  },
  "campo:text.areaOptions:rowGutter": {
    it: "Spazio fra le righe",
    en: "Row gutter",
  },
  "campo:text.areaOptions:inset": {
    it: "Margine interno",
    en: "Inset spacing",
  },
  "campo:text.areaOptions:firstBaseline": {
    it: "Prima linea di base",
    en: "First baseline",
  },
  "scelta:firstBaseline:ascent": { it: "Ascendente", en: "Ascent" },
  "scelta:firstBaseline:capHeight": {
    it: "Altezza maiuscole",
    en: "Cap height",
  },
  "scelta:firstBaseline:xHeight": { it: "Altezza x", en: "x height" },
  "scelta:firstBaseline:leading": { it: "Interlinea", en: "Leading" },
  "scelta:firstBaseline:fixed": { it: "Fissa", en: "Fixed" },
  "campo:text.areaOptions:firstBaselineMin": { it: "Minimo", en: "Min" },
  "campo:text.areaOptions:verticalAlign": {
    it: "Allineamento verticale",
    en: "Vertical align",
  },
  "scelta:verticalAlign:top": { it: "In alto", en: "Top" },
  "scelta:verticalAlign:center": { it: "Al centro", en: "Center" },
  "scelta:verticalAlign:bottom": { it: "In basso", en: "Bottom" },
  "scelta:verticalAlign:justify": { it: "Giustificato", en: "Justify" },
  "campo:text.areaOptions:flow": { it: "Ordine del testo", en: "Text flow" },
  "scelta:flow:columns": { it: "Per colonne", en: "By columns" },
  "scelta:flow:rows": { it: "Per righe", en: "By rows" },
  "campo:text.areaOptions:fit": { it: "Adatta", en: "Auto size" },
  "scelta:fit:none": { it: "No", en: "None" },
  "scelta:fit:autoHeight": { it: "Altezza automatica", en: "Auto height" },
  "scelta:fit:shrinkText": { it: "Riduci il testo", en: "Shrink text" },
  "campo:text.areaOptions:fitMinPercent": {
    it: "Riduzione minima (%)",
    en: "Minimum shrink (%)",
  },
  // Opzioni testo su tracciato (`type.pathOptions`).
  "descrizione:type.pathOptions": {
    it: "Dove parte il testo sul tracciato, e da che lato. Il verso si gira solo se il testo parte dall'inizio.",
    en: "Where the type starts on the path, and on which side. The direction flips only when the type starts at the beginning.",
  },
  "azione:type.pathOptions": { it: "Applica", en: "Apply" },
  "campo:type.pathOptions:start": { it: "Inizio (0–1)", en: "Start (0–1)" },
  "campo:type.pathOptions:end": { it: "Fine (0–1)", en: "End (0–1)" },
  "campo:type.pathOptions:flip": { it: "Gira il verso", en: "Flip" },
  "campo:type.pathOptions:effect": { it: "Effetto", en: "Effect" },
  "scelta:effect:rainbow": { it: "Arcobaleno", en: "Rainbow" },
  "scelta:effect:skew": { it: "Inclina", en: "Skew" },
  "scelta:effect:3dRibbon": { it: "Nastro 3D", en: "3D Ribbon" },
  "scelta:effect:stairStep": { it: "Gradini", en: "Stair Step" },
  "scelta:effect:gravity": { it: "Gravità", en: "Gravity" },
  "campo:type.pathOptions:alignToPath": {
    it: "Allinea al tracciato",
    en: "Align to path",
  },
  "scelta:alignToPath:ascender": { it: "Ascendente", en: "Ascender" },
  "scelta:alignToPath:descender": { it: "Discendente", en: "Descender" },
  "scelta:alignToPath:center": { it: "Centro", en: "Center" },
  "scelta:alignToPath:baseline": { it: "Linea di base", en: "Baseline" },
  "campo:type.pathOptions:spacing": { it: "Spaziatura", en: "Spacing" },
};
