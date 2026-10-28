// I tasti della Tabella, in due modi.
//
// - **Foglio** (il foglio e il Markdown): la tabella ha il fuoco e una cella
//   attiva; le frecce la muovono, Maiusc allarga, Ctrl va al bordo; Invio e
//   F2 aprono la cella, un carattere la riscrive; Tab va avanti e dall'ultima
//   cella aggiunge una riga.
// - **Documento** (il docx): il cursore è nel testo della cella; le frecce
//   restano del testo, Tab e Maiusc+Tab vanno di cella in cella, e Maiusc con
//   una freccia che esce dalla cella comincia la selezione di celle.
//
// Qui c'è soltanto la decisione: un tasto diventa un'intenzione, e chi la
// esegue è la cornice o l'adattatore.

/// Ciò che serve di un evento di tastiera.
export interface KeyLike {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
}

export type TableIntent =
  | { readonly kind: "move"; readonly rows: number; readonly columns: number; readonly extend: boolean }
  | { readonly kind: "edge"; readonly row: "first" | "last" | null; readonly column: "first" | "last" | null; readonly extend: boolean }
  | { readonly kind: "page"; readonly direction: -1 | 1; readonly extend: boolean }
  | { readonly kind: "tab"; readonly step: 1 | -1 }
  | { readonly kind: "enter"; readonly step: 1 | -1 }
  | { readonly kind: "edit" }
  | { readonly kind: "type"; readonly text: string }
  | { readonly kind: "clear" }
  | { readonly kind: "select-all" }
  | { readonly kind: "undo" }
  | { readonly kind: "redo" }
  | { readonly kind: "menu" }
  | { readonly kind: "leave" }
  | { readonly kind: "format"; readonly which: TableFormat };

/// Le enfasi che i tasti chiedono: l'adattatore sa come il suo formato le
/// scrive.
export type TableFormat = "bold" | "italic" | "strike";

/// L'intenzione di un tasto con la tabella a fuoco e nessuna cella aperta;
/// `null` quando il tasto non è della Tabella.
export function sheetIntent(event: KeyLike): TableIntent | null {
  const mod = event.ctrlKey || event.metaKey;
  const { key, shiftKey: extend } = event;
  const lower = key.toLowerCase();
  if (mod && !event.altKey) {
    if (lower === "z") return { kind: extend ? "redo" : "undo" };
    if (lower === "y") return { kind: "redo" };
    if (lower === "a") return { kind: "select-all" };
    if (!extend && lower === "b") return { kind: "format", which: "bold" };
    if (!extend && lower === "i") return { kind: "format", which: "italic" };
    if (extend && lower === "x") return { kind: "format", which: "strike" };
    if (key === "ArrowUp") return { kind: "edge", row: "first", column: null, extend };
    if (key === "ArrowDown") return { kind: "edge", row: "last", column: null, extend };
    if (key === "ArrowLeft") return { kind: "edge", row: null, column: "first", extend };
    if (key === "ArrowRight") return { kind: "edge", row: null, column: "last", extend };
    if (key === "Home") return { kind: "edge", row: "first", column: "first", extend };
    if (key === "End") return { kind: "edge", row: "last", column: "last", extend };
    // Ctrl+C, X e V diventano gli eventi degli appunti.
    return null;
  }
  switch (key) {
    case "ArrowUp": return { kind: "move", rows: -1, columns: 0, extend };
    case "ArrowDown": return { kind: "move", rows: 1, columns: 0, extend };
    case "ArrowLeft": return { kind: "move", rows: 0, columns: -1, extend };
    case "ArrowRight": return { kind: "move", rows: 0, columns: 1, extend };
    case "Tab": return { kind: "tab", step: extend ? -1 : 1 };
    case "Home": return { kind: "edge", row: null, column: "first", extend };
    case "End": return { kind: "edge", row: null, column: "last", extend };
    case "PageUp": return { kind: "page", direction: -1, extend };
    case "PageDown": return { kind: "page", direction: 1, extend };
    case "Enter": return extend ? { kind: "enter", step: -1 } : { kind: "edit" };
    case "F2": return { kind: "edit" };
    case "Delete":
    case "Backspace": return { kind: "clear" };
    case "Escape": return { kind: "leave" };
    case "ContextMenu": return { kind: "menu" };
    case "F10": return extend ? { kind: "menu" } : null;
    default:
      if (key.length === 1 && !event.altKey) return { kind: "type", text: key };
      return null;
  }
}

/// Dentro una cella aperta: che cosa conclude la modifica e dove si va.
/// `replace` è la cella aperta da un carattere, dove anche le frecce laterali
/// concludono; `edit` è aperta con Invio, F2 o il doppio clic.
export type EditingIntent =
  | { readonly kind: "commit"; readonly rows: number; readonly columns: number }
  | { readonly kind: "commit-tab"; readonly step: 1 | -1 }
  | { readonly kind: "cancel" }
  | { readonly kind: "format"; readonly which: TableFormat };

export function editingIntent(event: KeyLike, mode: "replace" | "edit"): EditingIntent | null {
  const mod = event.ctrlKey || event.metaKey;
  const lower = event.key.toLowerCase();
  if (mod && !event.shiftKey && (lower === "b" || lower === "i")) return { kind: "format", which: lower === "b" ? "bold" : "italic" };
  switch (event.key) {
    case "Enter": return { kind: "commit", rows: event.shiftKey ? -1 : 1, columns: 0 };
    case "Tab": return { kind: "commit-tab", step: event.shiftKey ? -1 : 1 };
    case "Escape": return { kind: "cancel" };
    case "ArrowUp": return { kind: "commit", rows: -1, columns: 0 };
    case "ArrowDown": return { kind: "commit", rows: 1, columns: 0 };
    case "ArrowLeft":
    case "ArrowRight":
      return mode === "replace" ? { kind: "commit", rows: 0, columns: event.key === "ArrowLeft" ? -1 : 1 } : null;
    default: return null;
  }
}

/// Nel modo documento: Tab e Maiusc+Tab di cella in cella, Maiusc con una
/// freccia verso fuori della cella per scegliere celle. `atEdge` dice se il
/// cursore è all'inizio (`start`) o alla fine (`end`) del testo della cella.
export function documentIntent(event: KeyLike, atEdge: { readonly start: boolean; readonly end: boolean }): TableIntent | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  if (event.key === "Tab") return { kind: "tab", step: event.shiftKey ? -1 : 1 };
  if (!event.shiftKey) return null;
  if ((event.key === "ArrowRight" || event.key === "ArrowDown") && atEdge.end) {
    return { kind: "move", rows: event.key === "ArrowDown" ? 1 : 0, columns: event.key === "ArrowRight" ? 1 : 0, extend: true };
  }
  if ((event.key === "ArrowLeft" || event.key === "ArrowUp") && atEdge.start) {
    return { kind: "move", rows: event.key === "ArrowUp" ? -1 : 0, columns: event.key === "ArrowLeft" ? -1 : 0, extend: true };
  }
  return null;
}
