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
  "punto.scrivi": { it: "Scrivi un numero e premi Invio: il punto va lì.", en: "Type a number and press Enter: the point moves there." },
  "punto.serve_uno": { it: "Scegli un punto solo per scriverne la posizione.", en: "Pick a single point to type its position." },
  "punto.sposta": { it: "Sposta il punto", en: "Move the point" },
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

  // Pulisci (K6 T12): tutto il disegno, non la selezione; i tre interruttori del motore.
  "descrizione:object.path.cleanUp": {
    it: "Toglie ciò che non serve: i punti isolati, i tracciati senza riempimento né contorno e i testi vuoti. Vale su tutto il disegno.",
    en: "Removes what is not needed: stray points, paths with no fill or stroke, and empty texts. It works on the whole drawing.",
  },
  "azione:object.path.cleanUp": { it: "Pulisci", en: "Clean up" },
  "campo:strayPoints": { it: "Punti isolati", en: "Stray points" },
  "campo:unpaintedObjects": { it: "Tracciati senza riempimento né contorno", en: "Paths without fill or stroke" },
  "campo:emptyTextPaths": { it: "Testi vuoti", en: "Empty texts" },

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

  // Dividi in griglia (K6 T12): righe, colonne e spaziatura; le guide non si chiedono.
  "descrizione:object.path.splitIntoGrid": {
    it: "Divide l'oggetto scelto in una griglia di rettangoli: righe, colonne e spaziatura.",
    en: "Divides the chosen object into a grid of rectangles: rows, columns and gutter.",
  },
  "azione:object.path.splitIntoGrid": { it: "Dividi", en: "Divide" },
  "campo:rows": { it: "Righe", en: "Rows" },
  "campo:columns": { it: "Colonne", en: "Columns" },
  "campo:gutter": { it: "Spaziatura", en: "Gutter" },
  "unita:gutter": { it: "pt", en: "pt" },

  // Media e Media e unisci (giro 6): l'asse e il punto che l'unione lascia.
  "descrizione:path.average": {
    it: "Porta i punti scelti nel loro punto medio, su un asse o su tutti e due. Senza punti scelti vale per tutti i punti dei tracciati scelti.",
    en: "Moves the chosen points to their average position, along one axis or both. With no points chosen it uses every point of the chosen paths.",
  },
  "azione:path.average": { it: "Media", en: "Average" },
  "campo:axis": { it: "Asse", en: "Axis" },
  "scelta:axis:both": { it: "Entrambi", en: "Both" },
  "scelta:axis:horizontal": { it: "Orizzontale", en: "Horizontal" },
  "scelta:axis:vertical": { it: "Verticale", en: "Vertical" },
  "descrizione:path.averageJoin": {
    it: "Porta i due punti finali nel loro punto medio e li unisce lì. Con un tracciato aperto solo, lo chiude.",
    en: "Moves the two end points to their midpoint and joins them there. With a single open path, it closes it.",
  },
  "azione:path.averageJoin": { it: "Media e unisci", en: "Average & Join" },
  "campo:to": { it: "Punto unito", en: "Joined point" },
  "scelta:to:corner": { it: "Angolo", en: "Corner" },
  "scelta:to:smooth": { it: "Morbido", en: "Smooth" },
};
