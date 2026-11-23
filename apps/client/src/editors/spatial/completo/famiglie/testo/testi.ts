// I testi della famiglia «testo» del Disegno completo (piano K6): le chiavi
// delle sue finestre e sezioni che l'indice generato non porta. Trova e
// sostituisci (T16) legge `descrizione:`, `azione:` e `campo:` (`finestraDi`
// di `../../index.ts`).

export const TESTI: Readonly<Record<string, { readonly it: string; readonly en: string }>> = {
  "descrizione:edit.findReplace": {
    it: "Cerca le parole in tutti i testi del disegno e le sostituisce. Una parola non si trova se è a cavallo di due stili.",
    en: "Finds the words in every text of the drawing and replaces them. A word split across two styles is not found.",
  },
  "azione:edit.findReplace": { it: "Sostituisci tutto", en: "Replace all" },
  "campo:find": { it: "Trova", en: "Find" },
  "campo:replace": { it: "Sostituisci con", en: "Replace with" },
  "campo:matchCase": { it: "Maiuscole e minuscole uguali", en: "Match case" },
  "campo:wholeWord": { it: "Solo parole intere", en: "Whole words only" },
};
