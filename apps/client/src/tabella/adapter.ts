// Il contratto fra la Tabella e chi la ospita. La Tabella possiede la
// selezione, la cella attiva, i tasti, gli appunti e i comandi; l'adattatore
// possiede la tabella vera (un testo Markdown, un documento ProseMirror, una
// cartella di Excel) e traduce un `TableEdit` nel suo formato. Le differenze
// fra i formati sono capacità dichiarate (`TableCaps`), non copie del codice.

import type { Range } from "./navigation";

/// Quante righe e colonne ha la tabella.
export interface TableSize {
  readonly rows: number;
  readonly columns: number;
}

/// Che cosa il formato sa fare. Un comando che chiede una capacità assente
/// non compare; uno che c'è ma qui non vale si spegne.
export interface TableCaps {
  readonly insertRows: boolean;
  readonly deleteRows: boolean;
  readonly moveRows: boolean;
  readonly insertColumns: boolean;
  readonly deleteColumns: boolean;
  readonly moveColumns: boolean;
  readonly sort: boolean;
  readonly align: boolean;
  readonly merge: boolean;
  /// Quante righe in cima sono d'intestazione: non si spostano, non si
  /// ordinano e non si cancellano come righe.
  readonly headerRows: number;
}

export type TableAlign = "left" | "center" | "right" | null;

/// Un blocco di valori da scrivere da `row`, `column`.
export interface TableBlock {
  readonly row: number;
  readonly column: number;
  readonly rows: readonly (readonly string[])[];
}

/// Un cambio della tabella, come lo chiede la Tabella. Un'unione chiusa:
/// l'adattatore sa sempre che cosa gli si chiede.
export type TableEdit =
  /// Blocchi di valori, ciascuno scritto dalla sua cella in alto a sinistra.
  /// Un blocco che esce dalla tabella la allarga, se il formato può.
  | { readonly kind: "set"; readonly blocks: readonly TableBlock[] }
  | { readonly kind: "clear"; readonly range: Range }
  | { readonly kind: "insert-rows"; readonly at: number; readonly count: number }
  | { readonly kind: "delete-rows"; readonly from: number; readonly to: number }
  | { readonly kind: "move-rows"; readonly from: number; readonly to: number; readonly by: -1 | 1 }
  | { readonly kind: "insert-columns"; readonly at: number; readonly count: number }
  | { readonly kind: "delete-columns"; readonly from: number; readonly to: number }
  | { readonly kind: "move-columns"; readonly from: number; readonly to: number; readonly by: -1 | 1 }
  | { readonly kind: "sort"; readonly column: number; readonly direction: 1 | -1 }
  | { readonly kind: "align"; readonly from: number; readonly to: number; readonly align: TableAlign }
  | { readonly kind: "merge"; readonly range: Range }
  | { readonly kind: "split"; readonly row: number; readonly column: number };

/// Una voce di menu come dato: l'ospite la disegna col suo menu.
export interface TableMenuEntry {
  readonly id: string;
  readonly label: string;
  /// Il tasto, nella forma `Mod-x` dei comandi della shell.
  readonly keys?: string;
  readonly separator: boolean;
  readonly disabled: boolean;
  readonly run: () => void;
}

/// Gli appunti che la Tabella scrive: il TSV e una tabella HTML.
export interface TableClipboard {
  readonly text: string;
  readonly html: string;
}
