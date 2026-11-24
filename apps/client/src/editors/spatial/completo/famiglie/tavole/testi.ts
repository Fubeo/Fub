// I testi della famiglia «tavole» del Disegno completo (piano K6): le chiavi
// delle sue finestre e sezioni che l'indice generato non porta. La finestra di
// Oggetto › Tavole da disegno › Ridisponi legge `descrizione:<id>`,
// `azione:<id>`, `campo:<id>:<nome>`, `scelta:<campo>:<valore>` e
// `unita:<campo>` (`finestraDi` di `../../index.ts`); la sezione «Tavole» del
// Design (`sezione.ts`) legge le chiavi `tavole.*`.

export const TESTI: Readonly<Record<string, { readonly it: string; readonly en: string }>> = {
  // Ridisponi tutte le tavole (VectorCraft: Object › Artboards › Rearrange All Artboards…).
  "descrizione:artboard.rearrange": {
    it: "Mette tutte le tavole in fila, nel loro ordine, a partire dal posto della prima. Una tavola bloccata resta dov'è.",
    en: "Lays all the artboards out in their order, starting where the first one is. A locked artboard stays where it is.",
  },
  "azione:artboard.rearrange": { it: "Ridisponi", en: "Rearrange" },
  "campo:artboard.rearrange:layout": { it: "Disposizione", en: "Layout" },
  "scelta:layout:gridByRow": { it: "Griglia per righe", en: "Grid by row" },
  "scelta:layout:gridByColumn": { it: "Griglia per colonne", en: "Grid by column" },
  "scelta:layout:row": { it: "Una riga", en: "Arrange by row" },
  "scelta:layout:column": { it: "Una colonna", en: "Arrange by column" },
  "campo:artboard.rearrange:order": { it: "Ordine", en: "Layout order" },
  "scelta:order:leftToRight": { it: "Da sinistra a destra", en: "Left to right" },
  "scelta:order:rightToLeft": { it: "Da destra a sinistra", en: "Right to left" },
  "campo:artboard.rearrange:columns": { it: "Colonne (righe per colonne)", en: "Columns (rows by column)" },
  "campo:artboard.rearrange:spacing": { it: "Distanza", en: "Spacing" },
  "unita:spacing": { it: "px", en: "px" },
  "campo:artboard.rearrange:moveArtwork": { it: "Sposta il disegno con le tavole", en: "Move artwork with artboard" },

  // La sezione «Tavole» del Design (VectorCraft: il pannello Artboards).
  "tavole.titolo": { it: "Tavole", en: "Artboards" },
  "tavole.elenco": { it: "Tavole del disegno", en: "Artboards of the drawing" },
  "tavole.attiva": { it: "attuale", en: "current" },
  "tavole.nome": { it: "Nome", en: "Name" },
  "tavole.x": { it: "X", en: "X" },
  "tavole.y": { it: "Y", en: "Y" },
  "tavole.larghezza": { it: "Larghezza", en: "Width" },
  "tavole.altezza": { it: "Altezza", en: "Height" },
  "tavole.nuova": { it: "Nuova tavola", en: "New artboard" },
  "tavole.duplica": { it: "Duplica tavola", en: "Duplicate artboard" },
  "tavole.elimina": { it: "Elimina tavola", en: "Delete artboard" },
  "tavole.eliminaVuote": { it: "Elimina le tavole vuote", en: "Delete empty artboards" },
  "tavole.su": { it: "Sposta su", en: "Move up" },
  "tavole.giu": { it: "Sposta giù", en: "Move down" },
  "tavole.copia": { it: "Copia tavola", en: "Copy artboard" },
  "tavole.taglia": { it: "Taglia tavola", en: "Cut artboard" },
  "tavole.conDisegno": { it: "Il disegno va con la tavola", en: "Move artwork with artboard" },
  "tavole.passo.opzioni": { it: "Opzioni tavola", en: "Artboard options" },
  "tavole.passo.ordine": { it: "Ordine delle tavole", en: "Artboard order" },
  "tavole.ultima": { it: "Una tavola resta sempre.", en: "One artboard always stays." },
  "tavole.nessuna": { it: "Il disegno non ha tavole: «Nuova tavola» ne fa una.", en: "The drawing has no artboards: “New artboard” makes one." },
  "tavole.misura": { it: "Scrivi un numero più grande di zero.", en: "Type a number greater than zero." },
};
