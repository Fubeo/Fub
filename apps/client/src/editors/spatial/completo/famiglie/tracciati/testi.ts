// I testi della famiglia «tracciati» del Disegno completo (piano K6, T12): le
// chiavi che l'indice generato non porta. Le chiavi `punto.*` sono la fila
// delle opzioni della Selezione diretta (`opzioni-punto.ts`). Le finestre di
// Oggetto › Tracciato (giro 3) leggono le altre (`finestraDi` di `../../index.ts`):
// `descrizione:<id>` e `azione:<id>` per comando, `campo:<id>:<nome>` o
// `campo:<nome>`, `scelta:<campo>:<valore>` e `unita:<campo>`. I nomi corti
// degli strumenti non stanno qui ma nelle parole della colonna
// (`strings/completo.ts`, `draw.engine.name.<id>`): la colonna li mostra
// prima che la famiglia arrivi.

export const TESTI: Readonly<Record<string, { readonly it: string; readonly en: string }>> = {
  "sezione.punto": { it: "Punto di ancoraggio", en: "Anchor point" },
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

  // Sposta tracciato: le parole del prototipo (`pezzo-dlg-sposta`).
  "descrizione:object.path.offsetPath": {
    it: "Un tracciato nuovo, parallelo a quello scelto, alla distanza che scrivi. Un numero negativo lo porta dentro.",
    en: "A new path, parallel to the chosen one, at the distance you type. A negative number moves it inside.",
  },
  "azione:object.path.offsetPath": { it: "Sposta", en: "Offset" },
  "campo:offset": { it: "Spostamento", en: "Offset" },
  "unita:offset": { it: "px", en: "px" },
  "campo:joins": { it: "Giunzioni", en: "Joins" },
  "scelta:joins:miter": { it: "Angolo vivo", en: "Miter" },
  "scelta:joins:round": { it: "Arrotondato", en: "Round" },
  "scelta:joins:bevel": { it: "Smussato", en: "Bevel" },
  "campo:miterLimit": { it: "Limite angolo vivo", en: "Miter limit" },
  "unita:miterLimit": { it: "×", en: "×" },

  // Semplifica.
  "descrizione:object.path.simplify": {
    it: "Meno punti di ancoraggio, con la forma quasi uguale. Più alto il numero, più punti spariscono.",
    en: "Fewer anchor points, with almost the same shape. The higher the number, the more points go.",
  },
  "azione:object.path.simplify": { it: "Semplifica", en: "Simplify" },
  "campo:object.path.simplify:level": { it: "Semplificazione", en: "Simplification" },
  "campo:cornerAngle": { it: "Soglia degli angoli", en: "Corner angle threshold" },
  "unita:cornerAngle": { it: "°", en: "°" },
  "campo:straightLines": { it: "Solo segmenti dritti", en: "Straight lines only" },

  // Smussa.
  "descrizione:object.path.smooth": {
    it: "Curve morbide al posto delle linee spezzate. Più alto il numero, più il tracciato si ammorbidisce.",
    en: "Soft curves instead of jagged lines. The higher the number, the smoother the path.",
  },
  "azione:object.path.smooth": { it: "Smussa", en: "Smooth" },
  "campo:object.path.smooth:level": { it: "Smussatura", en: "Smoothness" },

  // Espandi.
  "descrizione:object.expand": {
    it: "Le parti che scegli diventano forme piene: un tratto diventa il suo contorno.",
    en: "The parts you choose become filled shapes: a stroke becomes its outline.",
  },
  "azione:object.expand": { it: "Espandi", en: "Expand" },
  "campo:object": { it: "Oggetto", en: "Object" },
  "campo:fill": { it: "Riempimento", en: "Fill" },
  "campo:stroke": { it: "Tratto", en: "Stroke" },

  // Dividi in trattini.
  "descrizione:addon.pathtools.divideDashes": {
    it: "Taglia il tracciato in trattini della lunghezza che scrivi.",
    en: "Cuts the path into dashes of the length you type.",
  },
  "azione:addon.pathtools.divideDashes": { it: "Dividi", en: "Divide" },
  "campo:dash": { it: "Lunghezza dei trattini", en: "Dash length" },
  "unita:dash": { it: "px", en: "px" },
  "campo:gap": { it: "Spazio fra i trattini", en: "Gap" },
  "unita:gap": { it: "px", en: "px" },
  "campo:fit": { it: "Adatta alla lunghezza del tracciato", en: "Fit to the path length" },
  "campo:removeGaps": { it: "Togli i pezzi fra i trattini", en: "Remove the pieces between dashes" },
};
