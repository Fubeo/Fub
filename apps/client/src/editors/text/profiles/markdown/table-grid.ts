// La griglia di una tabella Markdown nella Live: si seleziona, si scrive e si
// riordina come un foglio di calcolo, e ogni gesto diventa testo.
//
// La griglia è la cornice della Tabella (`tabella/frame/frame.ts`), con i
// suoi gesti, i suoi tasti e i suoi appunti; questo modulo è l'adattatore
// Markdown. Il testo lo possiede l'editor: l'adattatore traduce ogni
// `TableEdit` in una tabella nuova col modello (`table-model.ts`) e la
// consegna all'host, che la scrive come una battuta dell'utente — cronologia
// locale, sessione del documento, salvataggio. Poi la griglia si ridisegna da
// ciò che il testo dice, non da ciò che credeva di aver scritto.
//
// Restano qui le enfasi del Markdown (`**`, `*`, `~~`…), il link della cella
// e l'uscita dalla tabella: dalla prima riga la freccia su esce, dall'ultima
// la freccia giù, Escape torna al testo dopo la tabella.
import type { EditorActionState } from "../../../core/editor-actions";
import { displayBinding } from "../../../../ui/commands";
import { showContextMenu } from "../../../../ui/menu";
import { setSanitizedHtml } from "../../../../ui/sanitize";
import { writeClipboardText } from "../../../../platform/clipboard";
import type { TableCaps, TableEdit } from "../../../../tabella/adapter";
import type { TableTarget } from "../../../../tabella/commands";
import { TableFrame } from "../../../../tabella/frame/frame";
import type { TableFormat } from "../../../../tabella/keys";
import type { Range } from "../../../../tabella/navigation";
import {
  clearFormatting,
  clearRange,
  deleteColumns,
  deleteRows,
  insertColumns,
  insertRows,
  moveColumns,
  moveRows,
  pasteMatrix,
  rangeWrapped,
  setAlign,
  sortRows,
  tableWidth,
  toggleWrap,
  type GridPosition,
  type GridRange,
  type TableData,
} from "./table-model";
import { escapeLinkLabel, linkDestination } from "./link-syntax";

/// Ciò che la griglia chiede all'editor che la ospita.
export interface TableGridHost {
  /// Scrive `next` al posto della tabella, come una battuta. `select` è dove
  /// deve stare la selezione dopo, anche se la griglia viene ridisegnata da
  /// capo. `false` se adesso non si può (sola lettura, tabella cambiata sotto).
  write(next: TableData, select: { anchor: GridPosition; focus: GridPosition }): boolean;
  readOnly(): boolean;
  undo(): void;
  redo(): void;
  /// Esce dalla griglia e rimette il cursore nel testo, prima o dopo la tabella.
  leave(where: "before" | "after"): void;
  /// La resa in riga di una cella, da sanificare, o `null` per il testo nudo.
  cellHtml(row: number, col: number): string | null;
  /// Monta ciò che la resa delle celle chiede (le formule); restituisce lo smontaggio.
  hydrate?(container: HTMLElement): () => void;
  /// Un clic con Mod su un link o un tag dentro una cella: `true` se l'ha seguito.
  activate(event: MouseEvent): boolean;
  /// Il fuoco è entrato nella griglia.
  focused(): void;
  /// Selezione o contenuto sono cambiati: la barra di formattazione rilegge lo stato.
  changed(): void;
}

/// Le azioni dell'editor che la griglia sa fare sulle proprie celle, quando
/// è lei ad avere il fuoco (la barra di formattazione).
export interface TableGridActions {
  actionState(id: string): EditorActionState;
  runAction(id: string): boolean;
}

const WRAPS: Readonly<Record<string, readonly [string, string]>> = {
  "markdown.bold": ["**", "**"],
  "markdown.italic": ["*", "*"],
  "markdown.strikethrough": ["~~", "~~"],
  "markdown.highlight": ["==", "=="],
  "markdown.code": ["`", "`"],
  "markdown.math": ["$", "$"],
  "markdown.comment": ["%%", "%%"],
  "markdown.wikilink": ["[[", "]]"],
};

const FORMATS: Readonly<Record<TableFormat, string>> = {
  bold: "markdown.bold",
  italic: "markdown.italic",
  strike: "markdown.strikethrough",
};

/// Il Markdown sa fare tutto tranne unire le celle; la prima riga è
/// l'intestazione.
const CAPS: TableCaps = {
  insertRows: true,
  deleteRows: true,
  moveRows: true,
  insertColumns: true,
  deleteColumns: true,
  moveColumns: true,
  sort: true,
  align: true,
  merge: false,
  headerRows: 1,
};

const UNAVAILABLE: EditorActionState = { enabled: false, active: null };

const toCell = (position: GridPosition) => ({ row: position.row, column: position.col });
const toPosition = (cell: { readonly row: number; readonly column: number }): GridPosition => ({ row: cell.row, col: cell.column });
const toGridRange = (range: Range): GridRange => ({ top: range.r0, left: range.c0, bottom: range.r1, right: range.c1 });

/// La tabella dopo un `TableEdit`, col modello del Markdown; la stessa se il
/// formato non lo sa fare.
export function applyTableEdit(data: TableData, edit: TableEdit): TableData {
  switch (edit.kind) {
    case "set":
      return edit.blocks.reduce((next, block) => pasteMatrix(next, { row: block.row, col: block.column }, block.rows), data);
    case "clear": return clearRange(data, toGridRange(edit.range));
    case "insert-rows": return insertRows(data, edit.at, edit.count);
    case "delete-rows": return deleteRows(data, edit.from, edit.to);
    case "move-rows": return moveRows(data, edit.from, edit.to, edit.by);
    case "insert-columns": return insertColumns(data, edit.at, edit.count);
    case "delete-columns": return deleteColumns(data, edit.from, edit.to);
    case "move-columns": return moveColumns(data, edit.from, edit.to, edit.by);
    case "sort": return sortRows(data, edit.column, edit.direction);
    case "align": return setAlign(data, edit.from, edit.to, edit.align);
    case "merge":
    case "split":
      return data;
  }
}

export class TableGrid implements TableGridActions {
  readonly #host: TableGridHost;
  readonly #frame: TableFrame;
  #data: TableData;

  constructor(host: TableGridHost, data: TableData) {
    this.#host = host;
    this.#data = data;
    this.#frame = new TableFrame({
      size: () => ({ rows: this.#data.rows.length, columns: tableWidth(this.#data) }),
      caps: () => CAPS,
      cellText: (row, column) => this.#data.rows[row]?.[column] ?? "",
      renderCell: (row, column, into) => {
        const html = host.cellHtml(row, column);
        if (html === null) into.textContent = this.#data.rows[row]?.[column] ?? "";
        else setSanitizedHtml(into, html);
      },
      hydrate: host.hydrate ? (container) => host.hydrate!(container) : undefined,
      align: (column) => this.#data.aligns[column] ?? null,
      readOnly: () => host.readOnly(),
      apply: (edit, select) => this.#apply(edit, select),
      undo: () => host.undo(),
      redo: () => host.redo(),
      leave: (where) => host.leave(where),
      activate: (event) => host.activate(event),
      format: (which) => this.runAction(FORMATS[which]),
      formatInput: (which, input) => wrapInput(input, which === "bold" ? "**" : which === "italic" ? "*" : "~~"),
      openMenu: (entries, at) => showContextMenu(at, entries.map((entry) => ({
        label: entry.label,
        separator: entry.separator,
        disabled: entry.disabled,
        ...(entry.keys ? { hint: displayBinding(entry.keys) } : {}),
        run: entry.run,
      }))),
      writeClipboard: (data) => writeClipboardText(data.text),
      focused: () => host.focused(),
      changed: () => host.changed(),
    }, "markdown-rendered");
  }

  get element(): HTMLElement {
    return this.#frame.element;
  }

  get data(): TableData {
    return this.#data;
  }

  get selection(): { anchor: GridPosition; focus: GridPosition } {
    const { anchor, focus } = this.#frame.selection;
    return { anchor: toPosition(anchor), focus: toPosition(focus) };
  }

  get editing(): boolean {
    return this.#frame.editing;
  }

  /// La tabella è cambiata nel testo (una modifica, un annulla, un altro
  /// riquadro): si ridisegna, e la selezione resta dov'era finché c'è.
  update(data: TableData): void {
    this.#data = data;
    this.#frame.update();
  }

  /// Porta il fuoco nella griglia: sulla prima o sull'ultima riga (entrando
  /// con le frecce dal testo), o su una cella.
  focus(at: "first" | "last" | GridPosition = this.selection.focus): void {
    this.#frame.focus(typeof at === "string" ? at : toCell(at));
  }

  /// Rimette una selezione salvata, per una griglia ridisegnata da capo.
  restore(selection: { anchor: GridPosition; focus: GridPosition }, focused: boolean): void {
    this.#frame.restore({ anchor: toCell(selection.anchor), focus: toCell(selection.focus) }, focused);
  }

  hasFocus(): boolean {
    return this.#frame.hasFocus();
  }

  /// La griglia si smonta dentro un aggiornamento dell'editor, dove scrivere
  /// non si può: la cella in modifica non si conferma qui. La conferma è già
  /// avvenuta all'uscita del fuoco dal campo, che precede ogni gesto capace di
  /// smontare la griglia (cambio di modalità, chiusura del riquadro).
  destroy(): void {
    this.#frame.destroy();
  }

  // ── Azioni della barra ─────────────────────────────────────────────────────

  actionState(id: string): EditorActionState {
    const editable = !this.#host.readOnly();
    const range = toGridRange(this.#frame.range);
    const wrap = WRAPS[id];
    if (wrap) {
      return { enabled: editable, active: editable && rangeWrapped(this.#data, range, wrap[0], wrap[1]) };
    }
    if (id === "markdown.clear" || id === "markdown.link") return { enabled: editable, active: null };
    const command = this.#frame.commandState(id);
    if (!command.known) return UNAVAILABLE;
    return { enabled: command.enabled, active: null };
  }

  runAction(id: string): boolean {
    if (this.#host.readOnly()) return false;
    const range = toGridRange(this.#frame.range);
    const wrap = WRAPS[id];
    if (wrap) return this.#write(toggleWrap(this.#data, range, wrap[0], wrap[1]));
    if (id === "markdown.clear") return this.#write(clearFormatting(this.#data, range));
    if (id === "markdown.link") {
      this.#link();
      return true;
    }
    return this.#frame.runCommand(id);
  }

  // ── Scrittura ──────────────────────────────────────────────────────────────

  #apply(edit: TableEdit, select: TableTarget): boolean {
    const next = applyTableEdit(this.#data, edit);
    if (next === this.#data) return false;
    return this.#host.write(next, { anchor: toPosition(select.anchor), focus: toPosition(select.focus) });
  }

  /// Una tabella nuova che non viene da un gesto della cornice (le enfasi):
  /// la selezione resta dov'è.
  #write(next: TableData): boolean {
    if (next === this.#data) return false;
    const { anchor, focus } = this.#frame.selection;
    if (!this.#host.write(next, { anchor: toPosition(anchor), focus: toPosition(focus) })) return false;
    this.#frame.update();
    this.#host.changed();
    return true;
  }

  /// Un link nella cella attiva: il testo diventa l'etichetta, e si resta a
  /// scrivere l'indirizzo.
  #link(): void {
    const { focus } = this.#frame.selection;
    const text = this.#data.rows[focus.row]?.[focus.column] ?? "";
    const url = /^(?:[a-z][a-z0-9+.-]*:\/\/|www\.|mailto:)\S+$/i.test(text.trim());
    const value = url ? `[](${linkDestination(text.trim())})` : `[${escapeLinkLabel(text)}]()`;
    this.#frame.beginEditing(focus, value, url ? 1 : value.length - 1);
  }
}

/// Avvolge il testo scelto nel campo della cella aperta con `marker`.
function wrapInput(input: HTMLInputElement, marker: string): void {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  const value = input.value;
  input.value = `${value.slice(0, start)}${marker}${value.slice(start, end)}${marker}${value.slice(end)}`;
  input.setSelectionRange(start + marker.length, end + marker.length);
}
