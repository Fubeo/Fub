// I tipi di dato che la shell mette in un trascinamento fra le sue superfici.
//
// Un tipo proprio e non `text/plain`: chi riceve deve poter distinguere «una
// nota dell'albero» da «del testo trascinato da un'altra app», che a parità di
// contenuto (un percorso) vogliono gesti diversi.

/// Una nota trascinata dall'albero dei file: il valore è il suo id nel vault.
export const NOTE_DRAG_TYPE = "application/x-fub-note";

/// Le voci trascinate dall'albero, note e file insieme (la scelta multipla, o
/// un file solo): il valore è un JSON `[{ id, note }]`. Una nota diventa un
/// collegamento, un file un rimando all'allegato.
export const ENTRIES_DRAG_TYPE = "application/x-fub-entries";

export interface DraggedEntry {
  readonly id: string;
  readonly note: boolean;
}

/// Una nota trascinata da una lista che non è l'albero (i risultati della
/// ricerca): porta gli stessi tipi di una nota dell'albero, così cade come lei
/// nell'editor (un collegamento), sulla striscia delle schede (si apre) e nei
/// segnalibri. Ciò che arriva fuori dall'app lo decide chi chiama.
export function offerNote(transfer: DataTransfer, doc: string): void {
  transfer.effectAllowed = "copy";
  transfer.setData(NOTE_DRAG_TYPE, doc);
  transfer.setData(ENTRIES_DRAG_TYPE, JSON.stringify([{ id: doc, note: true } satisfies DraggedEntry]));
}

/// Le voci di un trascinamento dell'albero, o nessuna se il valore non è
/// della forma attesa (un'altra app che usa lo stesso tipo).
export function draggedEntries(raw: string | undefined): DraggedEntry[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((each): each is DraggedEntry =>
      !!each && typeof each === "object" && typeof (each as DraggedEntry).id === "string" && typeof (each as DraggedEntry).note === "boolean");
  } catch {
    return [];
  }
}
