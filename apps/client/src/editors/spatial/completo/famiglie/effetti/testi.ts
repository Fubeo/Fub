// I testi della famiglia «effetti» del Disegno completo (piano K6): le chiavi
// delle sue finestre e sezioni che l'indice generato non porta: i nomi dei
// campi delle finestre degli effetti (`campo:<nome>`, o `campo:<id>:<nome>`
// per un effetto solo).

export const TESTI: Readonly<Record<string, { readonly it: string; readonly en: string }>> = {
  // Arrotonda angoli (stylize.roundCorners).
  "campo:radius": { it: "Raggio", en: "Radius" },
};
