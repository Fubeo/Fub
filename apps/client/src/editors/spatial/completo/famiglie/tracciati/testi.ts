// I testi della famiglia «tracciati» del Disegno completo (piano K6, T12): le
// chiavi che l'indice generato non porta. Le chiavi `punto.*` sono la fila
// delle opzioni della Selezione diretta (`opzioni-punto.ts`). I nomi corti
// degli strumenti non stanno qui ma nelle parole della colonna
// (`strings/completo.ts`, `draw.engine.name.<id>`): la colonna li mostra
// prima che la famiglia arrivi.

export const TESTI: Readonly<Record<string, { readonly it: string; readonly en: string }>> = {
  "punto.converti": { it: "Converti", en: "Convert" },
  "punto.angolo": { it: "Angolo", en: "Corner" },
  "punto.angolo.titolo": { it: "Converti il punto: angolo", en: "Convert the point: corner" },
  "punto.morbido": { it: "Morbido", en: "Smooth" },
  "punto.morbido.titolo": { it: "Converti il punto: morbido", en: "Convert the point: smooth" },
  "punto.gruppo": { it: "Punto", en: "Point" },
  "punto.taglia": { it: "Taglia il tracciato nel punto", en: "Cut the path at the point" },
  "punto.unisci": { it: "Unisci i due punti", en: "Join the two points" },
  "punto.elimina": { it: "Elimina il punto", en: "Delete the point" },
  "punto.posizione": { it: "Posizione del punto", en: "Point position" },
  "punto.coordinata": { it: " del punto", en: " of the point" },
  "punto.sola_lettura": { it: "Per spostare il punto, trascinalo sul foglio.", en: "To move the point, drag it on the sheet." },
  "punto.serve_punto": { it: "Scegli prima i punti con la Selezione diretta.", en: "Pick the points first with Direct Selection." },
  "punto.serve_estremi": { it: "Scegli i due punti finali da unire.", en: "Pick the two end points to join." },
};
