// I testi della famiglia «dinamici» del Disegno completo (piano K6): le chiavi
// delle sue finestre che l'indice generato non porta. La finestra delle Opzioni
// fusione (Oggetto › Fusione) legge `descrizione:<id>`, `campo:<id>:<nome>`,
// `scelta:<campo>:<valore>` e `unita:<campo>` (`finestraDi` di `../../index.ts`).

export const TESTI: Readonly<Record<string, { readonly it: string; readonly en: string }>> = {
  "descrizione:object.blend.options": {
    it: "Come la fusione scelta riempie lo spazio fra gli oggetti; senza una fusione scelta, come partono quelle nuove.",
    en: "How the selected blend fills the space between its objects; with no blend selected, how new blends start.",
  },
  "campo:object.blend.options:spacing": { it: "Spaziatura", en: "Spacing" },
  "campo:object.blend.options:steps": { it: "Passi specificati", en: "Specified Steps" },
  "campo:object.blend.options:distance": { it: "Distanza specificata", en: "Specified Distance" },
  "campo:object.blend.options:orientation": { it: "Orientamento", en: "Orientation" },
  "campo:object.blend.options:easingType": { it: "Andamento", en: "Type" },
  "campo:object.blend.options:ramp": { it: "Rampa", en: "Ramp" },
  "campo:object.blend.options:colorShift": { it: "Spostamento colore", en: "Color Shift" },
  "unita:distance": { it: "pt", en: "pt" },
  "unita:ramp": { it: "%", en: "%" },
  "scelta:spacing:smooth": { it: "Colore uniforme", en: "Smooth Color" },
  "scelta:spacing:steps": { it: "Passi specificati", en: "Specified Steps" },
  "scelta:spacing:distance": { it: "Distanza specificata", en: "Specified Distance" },
  "scelta:orientation:page": { it: "Allinea alla pagina", en: "Align to Page" },
  "scelta:orientation:path": { it: "Allinea al tracciato", en: "Align to Path" },
  "scelta:easingType:easeIn": { it: "Rallenta all'inizio", en: "Ease In" },
  "scelta:easingType:easeOut": { it: "Rallenta alla fine", en: "Ease Out" },
  "scelta:easingType:easeInOut": { it: "Rallenta all'inizio e alla fine", en: "Ease In-Out" },
  "scelta:easingType:easeOutIn": { it: "Accelera all'inizio e alla fine", en: "Ease Out-In" },
};
