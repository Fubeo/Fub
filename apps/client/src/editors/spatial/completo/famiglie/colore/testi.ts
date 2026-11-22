// I testi della famiglia «colore» del Disegno completo (piano K6, T14): le chiavi che l'indice
// generato non porta. Le finestre di Modifica › Modifica colori (giro 1) leggono queste parole
// (`finestraDi` di `../../index.ts`): `descrizione:<id>` e `azione:<id>` per comando,
// `campo:<id>:<nome>` o `campo:<nome>`, e `unita:<campo>`. La sezione Colore del Design non ne ha
// bisogno: la mette il Completo (`../../colore-sezione.ts`) con le sue parole.

export const TESTI: Readonly<Record<string, { readonly it: string; readonly en: string }>> = {
  // Satura.
  "descrizione:edit.colors.saturate": {
    it: "Colori più vivi o più spenti negli oggetti scelti. Un numero negativo li porta verso il grigio.",
    en: "Brighter or duller colors in the chosen objects. A negative number moves them toward grey.",
  },
  "azione:edit.colors.saturate": { it: "Satura", en: "Saturate" },
  "campo:intensity": { it: "Intensità", en: "Intensity" },
  "unita:intensity": { it: "%", en: "%" },

  // Regola bilanciamento colore.
  "descrizione:edit.colors.adjustBalance": {
    it: "Aggiunge o toglie rosso, verde e blu ai colori degli oggetti scelti.",
    en: "Adds or removes red, green and blue in the colors of the chosen objects.",
  },
  "azione:edit.colors.adjustBalance": { it: "Regola", en: "Adjust" },
  "campo:r": { it: "Rosso", en: "Red" },
  "campo:g": { it: "Verde", en: "Green" },
  "campo:b": { it: "Blu", en: "Blue" },
  "unita:r": { it: "%", en: "%" },
  "unita:g": { it: "%", en: "%" },
  "unita:b": { it: "%", en: "%" },
  "campo:fill": { it: "Riempimento", en: "Fill" },
  "campo:stroke": { it: "Contorno", en: "Stroke" },

  // Sovrastampa nero.
  "descrizione:edit.colors.overprintBlack": {
    it: "In stampa il nero degli oggetti scelti va sopra i colori sotto, senza buco. Vale per il nero CMYK e il grigio, non per il nero RGB.",
    en: "When printed, the black of the chosen objects goes over the colors below, with no knockout. It applies to CMYK black and grey, not to RGB black.",
  },
  "azione:edit.colors.overprintBlack": { it: "Applica", en: "Apply" },
  "campo:remove": { it: "Togli la sovrastampa", en: "Remove overprint" },
  "campo:percentage": { it: "Nero di almeno", en: "Black of at least" },
  "unita:percentage": { it: "%", en: "%" },
  "campo:includeCmyBlacks": { it: "Anche i neri con ciano, magenta o giallo", en: "Include blacks with cyan, magenta or yellow" },
  "campo:includeSpotBlacks": { it: "Anche i neri delle tinte piatte", en: "Include spot blacks" },
};
