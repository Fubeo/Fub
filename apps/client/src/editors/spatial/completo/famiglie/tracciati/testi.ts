// I testi della famiglia «tracciati» del Disegno completo (piano K6, T12): le
// chiavi che l'indice generato non porta. `strumento:<id>` è il nome corto di
// uno strumento nella colonna e nella sua tendina (l'indice porta il nome
// lungo, «Strumento Penna»), come nel prototipo (`tendina-penna`). La Gomma
// del motore sta nella casella della gomma di Fub, che si chiama uguale:
// «(Completo)» le distingue. Le chiavi `punto.*` sono la fila delle opzioni
// della Selezione diretta (`opzioni-punto.ts`).

export const TESTI: Readonly<Record<string, { readonly it: string; readonly en: string }>> = {
  "strumento:pen": { it: "Penna", en: "Pen" },
  "strumento:smartPen": { it: "Penna intelligente", en: "Smart Pen" },
  "strumento:curvature": { it: "Curvatura", en: "Curvature" },
  "strumento:addAnchor": { it: "Aggiungi punto di ancoraggio", en: "Add Anchor Point" },
  "strumento:deleteAnchor": { it: "Elimina punto di ancoraggio", en: "Delete Anchor Point" },
  "strumento:anchorPoint": { it: "Punto di ancoraggio", en: "Anchor Point" },
  "strumento:cornerTool": { it: "Angoli", en: "Corner" },
  "strumento:slideAnchor": { it: "Fai scorrere il punto di ancoraggio lungo il tracciato", en: "Slide Anchor Along Path" },
  "strumento:extendPath": { it: "Estendi tracciato", en: "Extend Path" },
  "strumento:pencil": { it: "Matita", en: "Pencil" },
  "strumento:smooth": { it: "Smussa", en: "Smooth" },
  "strumento:join": { it: "Unisci", en: "Join" },
  "strumento:sharedEdge": { it: "Fondi bordo condiviso", en: "Shared Edge Merge" },
  "strumento:eraser": { it: "Gomma (Completo)", en: "Eraser (Full)" },
  "strumento:pathEraser": { it: "Gomma tracciato", en: "Path Eraser" },
  "strumento:anchorEraserBrush": { it: "Pennello gomma punti", en: "Anchor Eraser Brush" },
  "strumento:scissors": { it: "Forbici", en: "Scissors" },
  "strumento:knife": { it: "Coltello", en: "Knife" },
  "strumento:mirrorCut": { it: "Specchia e taglia", en: "Mirror & Cut" },
  "strumento:lineCut": { it: "Taglio linea", en: "Line Cut" },
  "strumento:rectCut": { it: "Taglio rettangolare", en: "Rectangle Cut" },
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
