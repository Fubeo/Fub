// I gesti di blocco (N13), detti a chi li anima. È un pezzo minuscolo e a
// parte perché lo nominano anche la Live e le azioni comuni (la freccia di un
// ripiegabile, la casella di un'attività), che non devono caricare i Blocchi
// per dirlo: fuori dai Blocchi l'annotazione c'è e nessuno la legge.
import { Annotation } from "@codemirror/state";

export type BlockGestureKind = "drop" | "swap" | "transform" | "born" | "gone" | "fold" | "color" | "columns" | "check";

/// Un gesto di blocco: soltanto questi muovono qualcosa, mai una battuta.
export interface BlockGesture {
  readonly kind: BlockGestureKind;
  /// Da dove viene, nel documento di prima, l'inizio di una riga del
  /// documento nuovo che una sostituzione ha riscritto (uno spostamento
  /// riscrive la finestra dei fratelli): `null` se è nata ora.
  readonly origin?: (pos: number) => number | null;
  /// Il blocco protagonista nel documento nuovo: il trascinato, il nato, il
  /// trasformato, il ripiegabile.
  readonly lead?: { readonly from: number; readonly to: number };
  /// Dove si vedeva l'immagine sollevata al momento del rilascio: di quanto
  /// (px) il suo angolo stava lontano dal posto vecchio del protagonista, e
  /// la sua scala dall'angolo in alto a sinistra. L'atterraggio parte da lì.
  readonly lift?: { readonly x: number; readonly y: number; readonly scale?: number };
  /// Il tratto del documento che sparisce senza che il testo cambi: il corpo
  /// di un ripiegabile che si chiude.
  readonly hides?: { readonly from: number; readonly to: number };
  /// La frase della regione viva.
  readonly say?: string;
}

export const blockGesture = Annotation.define<BlockGesture>();
