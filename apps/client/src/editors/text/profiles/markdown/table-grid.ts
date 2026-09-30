// La griglia di una tabella Markdown nella Live: si seleziona, si scrive e si
// riordina come un foglio di calcolo, e ogni gesto diventa testo.
//
// Questo modulo possiede soltanto il DOM e la tastiera della griglia. Il
// testo lo possiede l'editor: la griglia chiede la tabella corrente all'host,
// calcola la tabella nuova col modello (`table-model.ts`) e la consegna
// all'host, che la scrive come una battuta dell'utente — cronologia locale,
// sessione del documento, salvataggio. Poi la griglia si ridisegna da ciò
// che il testo dice, non da ciò che credeva di aver scritto.
//
// # I gesti
//
// Come nel foglio dell'app (`editors/grid/engine.ts`): le frecce muovono la
// cella attiva, Maiusc allarga la selezione, Mod le porta al bordo; Tab va
// avanti riga per riga e dall'ultima cella aggiunge una riga; Invio o F2
// modificano la cella, un carattere la riscrive da capo; Canc la svuota;
// Mod+C, Mod+X e Mod+V passano tabulazioni e a capo, come fra fogli di
// calcolo. Dentro la cella Invio conferma e scende, Tab conferma e avanza,
// Escape annulla. Dalla prima riga la freccia su esce dalla tabella, dall'ultima
// la freccia giù; Escape torna al testo dopo la tabella.
import type { EditorActionState } from "../../../core/editor-actions";
import { t, type Key } from "../../../../i18n/strings";
import { displayBinding } from "../../../../ui/commands";
import { openLifetime, type Lifetime } from "../../../../ui/lifetime";
import { showContextMenu, type MenuItem } from "../../../../ui/menu";
import { setSanitizedHtml } from "../../../../ui/sanitize";
import { writeClipboardText } from "../../../../platform/clipboard";
import {
  clearFormatting,
  clearRange,
  columnName,
  deleteColumns,
  deleteRows,
  inRange,
  insertColumns,
  insertRows,
  moveColumns,
  moveRows,
  normalizeRange,
  parseTsv,
  pasteMatrix,
  rangeTsv,
  rangeWrapped,
  setAlign,
  setCell,
  sortRows,
  tableWidth,
  toggleWrap,
  type GridPosition,
  type GridRange,
  type TableAlign,
  type TableData,
} from "./table-model";

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

interface Editing {
  readonly row: number;
  readonly col: number;
  readonly input: HTMLInputElement;
  /// `replace`: la modifica è cominciata con un carattere, e le frecce laterali
  /// confermano e si muovono. `edit`: con Invio, F2 o doppio clic, e le frecce
  /// muovono il cursore dentro il testo.
  readonly mode: "replace" | "edit";
  readonly original: string;
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

const UNAVAILABLE: EditorActionState = { enabled: false, active: null };
let serial = 0;

export class TableGrid implements TableGridActions {
  readonly element: HTMLElement;
  readonly #host: TableGridHost;
  readonly #life: Lifetime;
  readonly #grid: HTMLElement;
  readonly #id = `md-grid-${++serial}`;
  #data: TableData;
  #anchor: GridPosition = { row: 0, col: 0 };
  #focus: GridPosition = { row: 0, col: 0 };
  #editing: Editing | null = null;
  #cells: HTMLElement[][] = [];
  #letters: HTMLElement[] = [];
  #rowHeads: HTMLElement[] = [];
  #shape = "";
  #adders: HTMLButtonElement[] = [];
  #drag: Lifetime | null = null;
  #hydrated: (() => void) | null = null;

  constructor(host: TableGridHost, data: TableData) {
    this.#host = host;
    this.#data = data;
    this.#life = openLifetime();
    this.element = document.createElement("div");
    this.element.className = "cm-md-grid-block markdown-rendered";
    this.element.contentEditable = "false";
    this.#grid = document.createElement("div");
    this.#grid.className = "cm-md-grid";
    this.#grid.tabIndex = 0;
    this.#grid.setAttribute("role", "grid");
    this.#grid.setAttribute("aria-multiselectable", "true");
    this.element.append(this.#grid, this.#drawAdders());
    this.#life.listen(this.#grid, "keydown", (event) => this.#keydown(event));
    this.#life.listen(this.#grid, "mousedown", (event) => this.#mousedown(event));
    this.#life.listen(this.#grid, "dblclick", (event) => this.#dblclick(event));
    this.#life.listen(this.#grid, "contextmenu", (event) => this.#contextmenu(event));
    this.#life.listen(this.#grid, "focusin", () => this.#host.focused());
    this.#life.listen(this.#grid, "copy", (event) => this.#copy(event, false));
    this.#life.listen(this.#grid, "cut", (event) => this.#copy(event, true));
    this.#life.listen(this.#grid, "paste", (event) => this.#paste(event));
    this.#render();
  }

  // ── Stato pubblico ─────────────────────────────────────────────────────────

  get data(): TableData {
    return this.#data;
  }

  get selection(): { anchor: GridPosition; focus: GridPosition } {
    return { anchor: this.#anchor, focus: this.#focus };
  }

  get editing(): boolean {
    return this.#editing !== null;
  }

  /// La tabella è cambiata nel testo (una modifica, un annulla, un altro
  /// riquadro): si ridisegna, e la selezione resta dov'era finché c'è.
  update(data: TableData): void {
    this.#data = data;
    this.#anchor = this.#clamp(this.#anchor);
    this.#focus = this.#clamp(this.#focus);
    this.#render();
  }

  /// Porta il fuoco nella griglia: sulla prima o sull'ultima riga (entrando
  /// con le frecce dal testo), o su una cella.
  focus(at: "first" | "last" | GridPosition = this.#focus): void {
    const position = at === "first" ? { row: 0, col: 0 }
      : at === "last" ? { row: this.#data.rows.length - 1, col: 0 }
      : at;
    this.#select(this.#clamp(position), false);
    this.#grid.focus({ preventScroll: true });
    this.#scrollToFocus();
  }

  /// Rimette una selezione salvata, per una griglia ridisegnata da capo.
  restore(selection: { anchor: GridPosition; focus: GridPosition }, focused: boolean): void {
    this.#anchor = this.#clamp(selection.anchor);
    this.#focus = this.#clamp(selection.focus);
    this.#paintSelection();
    if (focused) {
      this.#grid.focus({ preventScroll: true });
      this.#scrollToFocus();
    }
  }

  hasFocus(): boolean {
    return this.element.contains(this.element.ownerDocument.activeElement);
  }

  /// La griglia si smonta dentro un aggiornamento dell'editor, dove scrivere
  /// non si può: la cella in modifica non si conferma qui. La conferma è già
  /// avvenuta all'uscita del fuoco dal campo, che precede ogni gesto capace di
  /// smontare la griglia (cambio di modalità, chiusura del riquadro).
  destroy(): void {
    this.#editing = null;
    this.#drag?.close();
    this.#hydrated?.();
    this.#life.close();
  }

  // ── Azioni della barra ─────────────────────────────────────────────────────

  actionState(id: string): EditorActionState {
    const editable = !this.#host.readOnly();
    const range = this.#range();
    const wrap = WRAPS[id];
    if (wrap) {
      return { enabled: editable, active: editable && rangeWrapped(this.#data, range, wrap[0], wrap[1]) };
    }
    const operation = this.#operations()[id];
    if (!operation) return UNAVAILABLE;
    return { enabled: editable && operation.applicable(), active: null };
  }

  runAction(id: string): boolean {
    if (this.#host.readOnly()) return false;
    const wrap = WRAPS[id];
    if (wrap) return this.#commit(toggleWrap(this.#data, this.#range(), wrap[0], wrap[1]));
    const operation = this.#operations()[id];
    if (!operation || !operation.applicable()) return false;
    operation.run();
    return true;
  }

  // ── Operazioni ─────────────────────────────────────────────────────────────

  #range(): GridRange {
    return normalizeRange(this.#anchor, this.#focus);
  }

  /// Le operazioni della griglia, per id delle azioni dell'editor: la barra e
  /// il menu contestuale nominano le stesse.
  #operations(): Record<string, { applicable: () => boolean; run: () => void }> {
    const range = this.#range();
    const data = this.#data;
    const width = tableWidth(data);
    const last = data.rows.length - 1;
    const rows = (top: number, bottom: number) => ({
      anchor: { row: top, col: this.#anchor.col },
      focus: { row: bottom, col: this.#focus.col },
    });
    return {
      "markdown.table.row.before": {
        applicable: () => range.top >= 1,
        run: () => this.#commit(insertRows(data, range.top), rows(range.top, range.top)),
      },
      "markdown.table.row.after": {
        applicable: () => true,
        run: () => this.#commit(insertRows(data, range.bottom + 1), rows(range.bottom + 1, range.bottom + 1)),
      },
      "markdown.table.row.up": {
        applicable: () => range.top > 1,
        run: () => this.#commit(moveRows(data, range.top, range.bottom, -1), rows(range.top - 1, range.bottom - 1)),
      },
      "markdown.table.row.down": {
        applicable: () => range.top >= 1 && range.bottom < last,
        run: () => this.#commit(moveRows(data, range.top, range.bottom, 1), rows(range.top + 1, range.bottom + 1)),
      },
      "markdown.table.row.delete": {
        applicable: () => range.bottom >= 1,
        run: () => {
          const top = Math.max(1, range.top);
          const row = Math.min(top, last - (range.bottom - top + 1));
          this.#commit(deleteRows(data, top, range.bottom), rows(row, row));
        },
      },
      "markdown.table.column.before": {
        applicable: () => true,
        run: () => this.#commit(insertColumns(data, range.left), this.#columns(range.left, range.left)),
      },
      "markdown.table.column.after": {
        applicable: () => true,
        run: () => this.#commit(insertColumns(data, range.right + 1), this.#columns(range.right + 1, range.right + 1)),
      },
      "markdown.table.column.left": {
        applicable: () => range.left > 0,
        run: () => this.#commit(moveColumns(data, range.left, range.right, -1), this.#columns(range.left - 1, range.right - 1)),
      },
      "markdown.table.column.right": {
        applicable: () => range.right < width - 1,
        run: () => this.#commit(moveColumns(data, range.left, range.right, 1), this.#columns(range.left + 1, range.right + 1)),
      },
      "markdown.table.column.delete": {
        applicable: () => range.right - range.left + 1 < width,
        run: () => {
          const col = Math.min(range.left, width - 1 - (range.right - range.left + 1));
          this.#commit(deleteColumns(data, range.left, range.right), this.#columns(col, col));
        },
      },
      "markdown.table.sort.ascending": {
        applicable: () => data.rows.length > 2,
        run: () => this.#commit(sortRows(data, this.#focus.col, 1)),
      },
      "markdown.table.sort.descending": {
        applicable: () => data.rows.length > 2,
        run: () => this.#commit(sortRows(data, this.#focus.col, -1)),
      },
      "markdown.clear": {
        applicable: () => true,
        run: () => this.#commit(clearFormatting(data, range)),
      },
      "markdown.link": {
        applicable: () => true,
        run: () => this.#link(),
      },
    };
  }

  #columns(left: number, right: number): { anchor: GridPosition; focus: GridPosition } {
    return { anchor: { row: this.#anchor.row, col: left }, focus: { row: this.#focus.row, col: right } };
  }

  /// Un link nella cella attiva: il testo diventa l'etichetta, e si resta a
  /// scrivere l'indirizzo.
  #link(): void {
    const { row, col } = this.#focus;
    const text = this.#data.rows[row]?.[col] ?? "";
    const url = /^(?:[a-z][a-z0-9+.-]*:\/\/|www\.|mailto:)\S+$/i.test(text.trim());
    const value = url ? `[](${text.trim()})` : `[${text}]()`;
    this.#beginEditing({ row, col }, "edit", value, url ? 1 : value.length - 1);
  }

  /// Scrive una tabella nuova e sposta la selezione dove il gesto l'ha lasciata.
  #commit(next: TableData, select?: { anchor: GridPosition; focus: GridPosition }): boolean {
    if (next === this.#data) return false;
    const target = select ?? { anchor: this.#anchor, focus: this.#focus };
    if (!this.#host.write(next, target)) return false;
    // Se l'host ha ridisegnato questa stessa griglia, `update` è già arrivato
    // con la tabella che il testo dice adesso.
    this.#anchor = this.#clamp(target.anchor);
    this.#focus = this.#clamp(target.focus);
    this.#paintSelection();
    this.#scrollToFocus();
    this.#host.changed();
    return true;
  }

  // ── Disegno ────────────────────────────────────────────────────────────────

  #clamp(position: GridPosition): GridPosition {
    return {
      row: Math.max(0, Math.min(this.#data.rows.length - 1, position.row)),
      col: Math.max(0, Math.min(tableWidth(this.#data) - 1, position.col)),
    };
  }

  #cellId(row: number, col: number): string {
    return `${this.#id}-r${row}c${col}`;
  }

  #render(): void {
    const shape = `${this.#data.rows.length}x${tableWidth(this.#data)}`;
    if (shape !== this.#shape) {
      this.#finishEditing(false);
      this.#build();
      this.#shape = shape;
    }
    this.#fill();
    this.#paintSelection();
  }

  /// La struttura: la riga delle lettere, e per ogni riga il suo numero e le
  /// sue celle. Si rifà soltanto quando cambia la forma.
  #build(): void {
    const width = tableWidth(this.#data);
    // Le righe e le celle sono della griglia: la tabella HTML dà soltanto la
    // disposizione (e la pelle delle tabelle rese), non una seconda struttura.
    const table = document.createElement("table");
    table.setAttribute("role", "presentation");
    const head = document.createElement("thead");
    const letters = document.createElement("tr");
    letters.setAttribute("role", "row");
    letters.className = "cm-md-grid-letters";
    const corner = document.createElement("td");
    corner.className = "cm-md-grid-corner";
    corner.setAttribute("role", "presentation");
    letters.append(corner);
    this.#letters = [];
    for (let col = 0; col < width; col++) {
      const letter = document.createElement("td");
      letter.className = "cm-md-grid-letter";
      letter.setAttribute("role", "columnheader");
      letter.dataset.col = String(col);
      letter.textContent = columnName(col);
      this.#letters.push(letter);
      letters.append(letter);
    }
    head.append(letters);
    const body = document.createElement("tbody");
    this.#cells = [];
    this.#rowHeads = [];
    this.#data.rows.forEach((row, r) => {
      const line = document.createElement("tr");
      line.setAttribute("role", "row");
      const number = document.createElement("td");
      number.className = "cm-md-grid-rowhead";
      number.setAttribute("role", "rowheader");
      number.dataset.row = String(r);
      number.textContent = String(r + 1);
      this.#rowHeads.push(number);
      line.append(number);
      const cells: HTMLElement[] = [];
      row.forEach((_, c) => {
        const cell = document.createElement(r === 0 ? "th" : "td");
        cell.className = r === 0 ? "cm-md-grid-cell cm-md-grid-head" : "cm-md-grid-cell";
        cell.id = this.#cellId(r, c);
        cell.setAttribute("role", "gridcell");
        cell.dataset.row = String(r);
        cell.dataset.col = String(c);
        cells.push(cell);
        line.append(cell);
      });
      this.#cells.push(cells);
      body.append(line);
    });
    table.append(head, body);
    this.#grid.replaceChildren(table);
    this.#grid.setAttribute("aria-rowcount", String(this.#data.rows.length));
    this.#grid.setAttribute("aria-colcount", String(width));
  }

  /// Il contenuto delle celle, resa in riga compresa. La cella in modifica
  /// resta com'è: il suo testo è di chi sta scrivendo.
  #fill(): void {
    this.#grid.setAttribute("aria-label", t("table.grid.label"));
    const [addRow, addColumn] = this.#adders;
    if (addRow) addRow.textContent = `+ ${t("table.grid.add_row")}`;
    if (addColumn) addColumn.textContent = `+ ${t("table.grid.add_column")}`;
    for (const button of this.#adders) button.hidden = this.#host.readOnly();
    this.#data.rows.forEach((row, r) => row.forEach((text, c) => {
      const cell = this.#cells[r]?.[c];
      if (!cell || (this.#editing?.row === r && this.#editing.col === c)) return;
      const align = this.#data.aligns[c] ?? null;
      cell.style.textAlign = align ?? "";
      const html = text === "" ? null : this.#host.cellHtml(r, c);
      const key = `${text}\u0000${html ?? ""}`;
      if (cell.dataset.shown === key) return;
      cell.dataset.shown = key;
      const content = document.createElement("div");
      content.className = "cm-md-grid-content";
      if (html !== null) setSanitizedHtml(content, html);
      else content.textContent = text;
      cell.replaceChildren(content);
    }));
    this.#hydrated?.();
    this.#hydrated = this.#host.hydrate?.(this.#grid) ?? null;
  }

  #paintSelection(): void {
    const range = this.#range();
    this.#cells.forEach((cells, r) => cells.forEach((cell, c) => {
      const selected = inRange(range, r, c);
      cell.classList.toggle("is-selected", selected);
      cell.classList.toggle("is-active", r === this.#focus.row && c === this.#focus.col);
      cell.setAttribute("aria-selected", String(selected));
    }));
    this.#letters.forEach((letter, c) => letter.classList.toggle("is-selected", c >= range.left && c <= range.right));
    this.#rowHeads.forEach((head, r) => head.classList.toggle("is-selected", r >= range.top && r <= range.bottom));
    this.#grid.setAttribute("aria-activedescendant", this.#cellId(this.#focus.row, this.#focus.col));
  }

  #scrollToFocus(): void {
    this.#cells[this.#focus.row]?.[this.#focus.col]?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }

  #drawAdders(): HTMLElement {
    const bar = document.createElement("div");
    bar.className = "cm-md-grid-adders";
    const row = document.createElement("button");
    row.type = "button";
    row.className = "cm-md-grid-add";
    row.dataset.add = "row";
    const column = document.createElement("button");
    column.type = "button";
    column.className = "cm-md-grid-add";
    column.dataset.add = "column";
    this.#adders = [row, column];
    for (const button of [row, column]) {
      button.tabIndex = -1;
      this.#life.listen(button, "mousedown", (event) => event.preventDefault());
      this.#life.listen(button, "click", () => {
        if (this.#host.readOnly()) return;
        const last = this.#data.rows.length - 1;
        const width = tableWidth(this.#data);
        if (button === row) {
          this.#commit(insertRows(this.#data, last + 1), { anchor: { row: last + 1, col: 0 }, focus: { row: last + 1, col: 0 } });
        } else {
          this.#commit(insertColumns(this.#data, width), { anchor: { row: 0, col: width }, focus: { row: 0, col: width } });
        }
        this.#grid.focus({ preventScroll: true });
      });
    }
    bar.append(row, column);
    return bar;
  }

  // ── Selezione ──────────────────────────────────────────────────────────────

  #select(position: GridPosition, extend: boolean): void {
    this.#focus = this.#clamp(position);
    if (!extend) this.#anchor = this.#focus;
    this.#paintSelection();
    this.#scrollToFocus();
    this.#host.changed();
  }

  #move(rows: number, cols: number, extend: boolean): void {
    this.#select({ row: this.#focus.row + rows, col: this.#focus.col + cols }, extend);
  }

  /// Tab e Maiusc+Tab: avanti e indietro lungo le righe. Dall'ultima cella
  /// Tab aggiunge una riga, come quando si compila una tabella.
  #tab(step: 1 | -1): void {
    const width = tableWidth(this.#data);
    const index = this.#focus.row * width + this.#focus.col + step;
    const total = this.#data.rows.length * width;
    if (index >= total) {
      if (this.#host.readOnly()) return;
      const row = this.#data.rows.length;
      this.#commit(insertRows(this.#data, row), { anchor: { row, col: 0 }, focus: { row, col: 0 } });
      return;
    }
    if (index < 0) return;
    this.#select({ row: Math.floor(index / width), col: index % width }, false);
  }

  #selectAll(): void {
    this.#anchor = { row: 0, col: 0 };
    this.#focus = { row: this.#data.rows.length - 1, col: tableWidth(this.#data) - 1 };
    this.#paintSelection();
    this.#host.changed();
  }

  // ── Tastiera ───────────────────────────────────────────────────────────────

  #keydown(event: KeyboardEvent): void {
    if (event.defaultPrevented) return;
    if (this.#editing && event.target === this.#editing.input) {
      this.#editingKey(event);
      return;
    }
    if (event.isComposing) return;
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key;
    const lower = key.toLowerCase();
    const extend = event.shiftKey;
    const last = this.#data.rows.length - 1;
    const width = tableWidth(this.#data);
    if (mod && !event.altKey) {
      if (lower === "z" && event.shiftKey) this.#host.redo();
      else if (lower === "z") this.#host.undo();
      else if (lower === "y") this.#host.redo();
      else if (lower === "a") this.#selectAll();
      else if (lower === "b" && !event.shiftKey) this.runAction("markdown.bold");
      else if (lower === "i" && !event.shiftKey) this.runAction("markdown.italic");
      else if (lower === "x" && event.shiftKey) this.runAction("markdown.strikethrough");
      else if (key === "ArrowUp") this.#select({ row: 0, col: this.#focus.col }, extend);
      else if (key === "ArrowDown") this.#select({ row: last, col: this.#focus.col }, extend);
      else if (key === "ArrowLeft") this.#select({ row: this.#focus.row, col: 0 }, extend);
      else if (key === "ArrowRight") this.#select({ row: this.#focus.row, col: width - 1 }, extend);
      else if (key === "Home") this.#select({ row: 0, col: 0 }, extend);
      else if (key === "End") this.#select({ row: last, col: width - 1 }, extend);
      // Mod+C, Mod+X e Mod+V diventano gli eventi degli appunti: non si fermano.
      else return;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    switch (key) {
      case "ArrowUp":
        if (this.#focus.row === 0 && !extend) this.#host.leave("before");
        else this.#move(-1, 0, extend);
        break;
      case "ArrowDown":
        if (this.#focus.row === last && !extend) this.#host.leave("after");
        else this.#move(1, 0, extend);
        break;
      case "ArrowLeft": this.#move(0, -1, extend); break;
      case "ArrowRight": this.#move(0, 1, extend); break;
      case "Tab": this.#tab(extend ? -1 : 1); break;
      case "Home": this.#select({ row: this.#focus.row, col: 0 }, extend); break;
      case "End": this.#select({ row: this.#focus.row, col: width - 1 }, extend); break;
      case "PageUp": this.#move(-10, 0, extend); break;
      case "PageDown": this.#move(10, 0, extend); break;
      case "Enter":
      case "F2":
        if (event.shiftKey && key === "Enter") this.#move(-1, 0, false);
        else this.#beginEditing(this.#focus, "edit");
        break;
      case "Delete":
      case "Backspace":
        if (!this.#host.readOnly()) this.#commit(clearRange(this.#data, this.#range()));
        break;
      case "Escape": this.#host.leave("after"); break;
      case "ContextMenu": this.#openMenu(null); break;
      default:
        if (key === "F10" && event.shiftKey) {
          this.#openMenu(null);
          break;
        }
        if (key.length === 1 && !event.altKey && !this.#host.readOnly()) {
          this.#beginEditing(this.#focus, "replace", key);
          break;
        }
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  #editingKey(event: KeyboardEvent): void {
    const editing = this.#editing!;
    const mod = event.ctrlKey || event.metaKey;
    const lower = event.key.toLowerCase();
    if (event.isComposing) return;
    if (mod && (lower === "b" || lower === "i") && !event.shiftKey) {
      this.#wrapInput(editing.input, lower === "b" ? "**" : "*");
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const finishAndMove = (rows: number, cols: number) => {
      this.#finishEditing(true);
      this.#move(rows, cols, false);
    };
    switch (event.key) {
      case "Enter": finishAndMove(event.shiftKey ? -1 : 1, 0); break;
      case "Tab":
        this.#finishEditing(true);
        this.#tab(event.shiftKey ? -1 : 1);
        break;
      case "Escape": this.#finishEditing(false); break;
      case "ArrowUp": finishAndMove(-1, 0); break;
      case "ArrowDown": finishAndMove(1, 0); break;
      case "ArrowLeft":
      case "ArrowRight":
        if (editing.mode === "replace") {
          finishAndMove(0, event.key === "ArrowLeft" ? -1 : 1);
          break;
        }
        event.stopPropagation();
        return;
      default:
        // Il resto è del campo: annulla, copia e incolla del testo compresi.
        // Non sale oltre la griglia, così nessuna scorciatoia dell'app
        // scatta mentre si scrive in una cella.
        event.stopPropagation();
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  #wrapInput(input: HTMLInputElement, marker: string): void {
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    const value = input.value;
    input.value = `${value.slice(0, start)}${marker}${value.slice(start, end)}${marker}${value.slice(end)}`;
    input.setSelectionRange(start + marker.length, end + marker.length);
  }

  #beginEditing(position: GridPosition, mode: "replace" | "edit", initial?: string, caret?: number): void {
    if (this.#host.readOnly()) return;
    this.#finishEditing(true);
    const { row, col } = this.#clamp(position);
    const cell = this.#cells[row]?.[col];
    if (!cell) return;
    this.#select({ row, col }, false);
    const original = this.#data.rows[row]?.[col] ?? "";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "cm-md-grid-input";
    input.spellcheck = true;
    input.value = initial ?? original;
    input.setAttribute("aria-label", t("table.grid.cell", { cell: `${columnName(col)}${row + 1}` }));
    cell.replaceChildren(input);
    delete cell.dataset.shown;
    this.#editing = { row, col, input, mode, original };
    input.focus({ preventScroll: true });
    const at = caret ?? input.value.length;
    input.setSelectionRange(at, at);
    // Il fuoco che esce dalla griglia conferma: un clic nel testo non butta
    // ciò che si era scritto.
    input.addEventListener("blur", () => {
      queueMicrotask(() => {
        if (this.#editing?.input === input && !this.#grid.contains(this.#grid.ownerDocument.activeElement)) {
          this.#finishEditing(true, false);
        }
      });
    });
  }

  /// Chiude la modifica: `commit` scrive il testo, altrimenti si torna a
  /// quello di prima. Il fuoco torna alla griglia se era nel campo.
  #finishEditing(commit: boolean, refocus = true): void {
    const editing = this.#editing;
    if (!editing) return;
    this.#editing = null;
    const hadFocus = editing.input.ownerDocument.activeElement === editing.input;
    const value = editing.input.value.replace(/\r?\n/g, " ");
    const cell = this.#cells[editing.row]?.[editing.col];
    if (cell) delete cell.dataset.shown;
    if (commit && value !== editing.original) {
      this.#commit(setCell(this.#data, editing.row, editing.col, value));
    }
    this.#fill();
    this.#paintSelection();
    if (hadFocus && refocus) this.#grid.focus({ preventScroll: true });
  }

  // ── Puntatore ──────────────────────────────────────────────────────────────

  #positionOf(target: EventTarget | null): { kind: "cell" | "row" | "col" | "corner"; row: number; col: number } | null {
    const element = target instanceof Element ? target.closest<HTMLElement>("td, th") : null;
    if (!element || !this.#grid.contains(element)) return null;
    if (element.classList.contains("cm-md-grid-corner")) return { kind: "corner", row: 0, col: 0 };
    const row = Number(element.dataset.row ?? -1);
    const col = Number(element.dataset.col ?? -1);
    if (element.classList.contains("cm-md-grid-letter")) return { kind: "col", row: -1, col };
    if (element.classList.contains("cm-md-grid-rowhead")) return { kind: "row", row, col: -1 };
    if (row < 0 || col < 0) return null;
    return { kind: "cell", row, col };
  }

  #mousedown(event: MouseEvent): void {
    if (this.#editing && event.target instanceof Node && this.#editing.input.contains(event.target)) return;
    if (event.button === 0 && (event.ctrlKey || event.metaKey) && this.#host.activate(event)) {
      event.preventDefault();
      return;
    }
    const hit = this.#positionOf(event.target);
    if (!hit) return;
    if (event.button !== 0) {
      // Il tasto destro tiene la selezione se il clic ci cade dentro.
      if (hit.kind === "cell" && !inRange(this.#range(), hit.row, hit.col)) this.#select(hit, false);
      return;
    }
    event.preventDefault();
    this.#finishEditing(true, false);
    this.#grid.focus({ preventScroll: true });
    const last = this.#data.rows.length - 1;
    const width = tableWidth(this.#data);
    if (hit.kind === "corner") {
      this.#selectAll();
      return;
    }
    if (hit.kind === "col") {
      if (!event.shiftKey) this.#anchor = { row: 0, col: hit.col };
      this.#focus = { row: last, col: hit.col };
      this.#anchor = { row: 0, col: this.#anchor.col };
      this.#paintSelection();
      this.#host.changed();
      return;
    }
    if (hit.kind === "row") {
      if (!event.shiftKey) this.#anchor = { row: hit.row, col: 0 };
      this.#focus = { row: hit.row, col: width - 1 };
      this.#anchor = { row: this.#anchor.row, col: 0 };
      this.#paintSelection();
      this.#host.changed();
      return;
    }
    this.#select(hit, event.shiftKey);
    // Trascinare allarga la selezione fino alla cella sotto il puntatore.
    this.#drag?.close();
    const drag = openLifetime();
    this.#drag = drag;
    const doc = this.#grid.ownerDocument;
    drag.listen(doc, "mousemove", (move) => {
      const under = doc.elementFromPoint?.(move.clientX, move.clientY) ?? null;
      const over = this.#positionOf(under);
      if (over?.kind === "cell" && (over.row !== this.#focus.row || over.col !== this.#focus.col)) {
        this.#select(over, true);
      }
    });
    drag.listen(doc, "mouseup", () => {
      drag.close();
      if (this.#drag === drag) this.#drag = null;
    });
  }

  #dblclick(event: MouseEvent): void {
    const hit = this.#positionOf(event.target);
    if (hit?.kind !== "cell") return;
    event.preventDefault();
    this.#beginEditing(hit, "edit");
  }

  #contextmenu(event: MouseEvent): void {
    if (this.#editing && event.target instanceof Node && this.#editing.input.contains(event.target)) return;
    const hit = this.#positionOf(event.target);
    if (!hit) return;
    event.preventDefault();
    if (hit.kind === "cell" && !inRange(this.#range(), hit.row, hit.col)) this.#select(hit, false);
    this.#openMenu(event);
  }

  // ── Menu ───────────────────────────────────────────────────────────────────

  #openMenu(event: MouseEvent | null): void {
    const cell = this.#cells[this.#focus.row]?.[this.#focus.col];
    const box = cell?.getBoundingClientRect();
    const at = event ?? new MouseEvent("contextmenu", { clientX: box?.left ?? 0, clientY: box?.bottom ?? 0 });
    const readOnly = this.#host.readOnly();
    const operations = this.#operations();
    const item = (label: Key, id: string, separator = false): MenuItem => ({
      label: t(label),
      separator,
      disabled: readOnly || !(operations[id]?.applicable() ?? false),
      run: () => void this.runAction(id),
    });
    const align = (label: Key, value: TableAlign, separator = false): MenuItem => ({
      label: t(label),
      separator,
      disabled: readOnly,
      run: () => this.#commit(setAlign(this.#data, this.#range().left, this.#range().right, value)),
    });
    const items: MenuItem[] = [
      { label: t("table.menu.cut"), hint: displayBinding("Mod-x"), disabled: readOnly, run: () => void this.#copyToClipboard(true) },
      { label: t("table.menu.copy"), hint: displayBinding("Mod-c"), run: () => void this.#copyToClipboard(false) },
      item("table.menu.row_above", "markdown.table.row.before", true),
      item("table.menu.row_below", "markdown.table.row.after"),
      item("table.menu.column_left", "markdown.table.column.before"),
      item("table.menu.column_right", "markdown.table.column.after"),
      item("table.menu.row_up", "markdown.table.row.up", true),
      item("table.menu.row_down", "markdown.table.row.down"),
      item("table.menu.column_move_left", "markdown.table.column.left"),
      item("table.menu.column_move_right", "markdown.table.column.right"),
      item("table.menu.delete_rows", "markdown.table.row.delete", true),
      item("table.menu.delete_columns", "markdown.table.column.delete"),
      item("table.menu.sort_ascending", "markdown.table.sort.ascending", true),
      item("table.menu.sort_descending", "markdown.table.sort.descending"),
      align("table.menu.align_left", "left", true),
      align("table.menu.align_center", "center"),
      align("table.menu.align_right", "right"),
      align("table.menu.align_default", null),
      {
        label: t("table.menu.clear"),
        separator: true,
        hint: displayBinding("Delete"),
        disabled: readOnly,
        run: () => void this.#commit(clearRange(this.#data, this.#range())),
      },
    ];
    showContextMenu(at, items);
  }

  // ── Appunti ────────────────────────────────────────────────────────────────

  #copy(event: ClipboardEvent, cut: boolean): void {
    if (this.#editing || !event.clipboardData) return;
    event.preventDefault();
    event.clipboardData.setData("text/plain", rangeTsv(this.#data, this.#range()));
    if (cut && !this.#host.readOnly()) this.#commit(clearRange(this.#data, this.#range()));
  }

  async #copyToClipboard(cut: boolean): Promise<void> {
    const text = rangeTsv(this.#data, this.#range());
    try {
      await writeClipboardText(text);
    } catch {
      return;
    }
    if (cut && !this.#host.readOnly()) this.#commit(clearRange(this.#data, this.#range()));
  }

  #paste(event: ClipboardEvent): void {
    if (this.#editing || !event.clipboardData) return;
    event.preventDefault();
    if (this.#host.readOnly()) return;
    const matrix = parseTsv(event.clipboardData.getData("text/plain"));
    if (matrix.length === 0) return;
    const at = { row: this.#range().top, col: this.#range().left };
    const height = matrix.length;
    const breadth = Math.max(...matrix.map((row) => row.length));
    this.#commit(pasteMatrix(this.#data, at, matrix), {
      anchor: at,
      focus: { row: at.row + height - 1, col: at.col + breadth - 1 },
    });
  }
}
