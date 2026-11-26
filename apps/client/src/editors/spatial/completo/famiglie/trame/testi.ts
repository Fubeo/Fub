// I testi della famiglia «trame» del Disegno completo (piano K6): le chiavi
// delle sue finestre che l'indice generato non porta. Le finestre delle Opzioni
// spazi vuoti (Oggetto › Pittura dinamica) e di Crea trama sfumatura leggono `descrizione:<id>`,
// `campo:<id>:<nome>` o `campo:<nome>`, `scelta:<campo>:<valore>` e `unita:<campo>`
// (`finestraDi` di `../../index.ts`).

export const TESTI: Readonly<Record<string, { readonly it: string; readonly en: string }>> = {
  "descrizione:livePaint.gapOptions": {
    it: "Gli spazi vuoti fra i tracciati del gruppo che la pittura dinamica considera chiusi.",
    en: "The gaps between the group's paths that Live Paint treats as closed.",
  },
  "campo:livePaint.gapOptions:detect": { it: "Rileva gli spazi vuoti", en: "Gap detection" },
  "campo:livePaint.gapOptions:size": { it: "Il colore si ferma a", en: "Paint stops at" },
  "campo:livePaint.gapOptions:points": { it: "Spazi personalizzati", en: "Custom gaps" },
  "unita:points": { it: "pt", en: "pt" },
  "campo:livePaint.gapOptions:color": { it: "Colore anteprima spazi", en: "Gap preview color" },
  "campo:livePaint.gapOptions:closeGaps": { it: "Chiudi gli spazi con tracciati", en: "Close gaps with paths" },
  "scelta:size:small": { it: "Piccoli (3 pt)", en: "Small gaps (3 pt)" },
  "scelta:size:medium": { it: "Medi (6 pt)", en: "Medium gaps (6 pt)" },
  "scelta:size:large": { it: "Grandi (12 pt)", en: "Large gaps (12 pt)" },
  "scelta:size:custom": { it: "Personalizzati", en: "Custom" },
  "descrizione:object.mesh.create": {
    it: "Fa degli oggetti scelti una trama sfumatura: una griglia di punti, ognuno col suo colore.",
    en: "Turns the selected objects into a gradient mesh: a grid of points, each with its own color.",
  },
  "campo:object.mesh.create:rows": { it: "Righe", en: "Rows" },
  "campo:object.mesh.create:cols": { it: "Colonne", en: "Columns" },
  "campo:object.mesh.create:appearance": { it: "Aspetto", en: "Appearance" },
  "campo:object.mesh.create:highlight": { it: "Evidenziazione", en: "Highlight" },
  "unita:highlight": { it: "%", en: "%" },
  "scelta:appearance:flat": { it: "Piatto", en: "Flat" },
  "scelta:appearance:center": { it: "Al centro", en: "To Center" },
  "scelta:appearance:edge": { it: "Al bordo", en: "To Edge" },
};
