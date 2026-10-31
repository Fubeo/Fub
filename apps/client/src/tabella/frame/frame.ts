// La cornice della Tabella per una tabella nel flusso del testo: la griglia
// con le lettere delle colonne e i numeri delle righe, la cella attiva, la
// selezione, la maniglia di riempimento e i «+» per allargarla. La disegna e
// la fa funzionare la Tabella; la tabella vera è dell'adattatore, che riceve
// ogni gesto come un `TableEdit` e ridà la tabella com'è dopo (`update`).
//
// # I gesti
//
// Come in un foglio di calcolo: le frecce muovono la cella attiva, Maiusc
// allarga la selezione, Ctrl va al bordo; Tab va avanti riga per riga e
// dall'ultima cella aggiunge una riga; Invio o F2 aprono la cella, un
// carattere la riscrive; Canc la svuota; Ctrl+C, X e V passano TSV e una
// tabella HTML. Dentro la cella Invio conferma e scende, Tab conferma e
// avanza, Esc annulla. Tirare la maniglia nell'angolo della selezione
// riempie la serie.

import { t } from "../../i18n/strings";
import { openLifetime, type Lifetime } from "../../ui/lifetime";
import type { TableAlign, TableCaps, TableClipboard, TableEdit, TableMenuEntry, TableSize } from "../adapter";
import { clipboardData, clipboardRows, pasteTargets } from "../clipboard";
import { TABLE_ALIGNS, TABLE_COMMANDS, tableCommand, type TableCommandContext, type TableTarget } from "../commands";
import { editingIntent, sheetIntent, type TableFormat } from "../keys";
import type { Cell, Range } from "../navigation";
import { fillRange, rangeBetween } from "../selection";
import { fillSeries } from "../series";

/// Ciò che la cornice chiede a chi ospita la tabella.
export interface TableFrameHost {
  size(): TableSize;
  caps(): TableCaps;
  /// Il testo di una cella, com'è scritto: quello che si modifica e si copia.
  cellText(row: number, column: number): string;
  /// Mette in `into` la resa di una cella; senza, il testo nudo.
  renderCell?(row: number, column: number, into: HTMLElement): void;
  /// Monta ciò che la resa delle celle chiede; ridà lo smontaggio.
  hydrate?(container: HTMLElement): () => void;
  align?(column: number): TableAlign;
  readOnly(): boolean;
  /// Fa il cambio. `select` è dove sta la selezione dopo, anche se la
  /// tabella si ridisegna da capo. `false` se adesso non si può.
  apply(edit: TableEdit, select: TableTarget): boolean;
  undo(): void;
  redo(): void;
  /// Esce dalla tabella, prima o dopo.
  leave(where: "before" | "after"): void;
  /// Un clic con Ctrl su un link o un tag in una cella: `true` se l'ha seguito.
  activate?(event: MouseEvent): boolean;
  /// Un'enfasi sulle celle scelte; `false` se il formato non l'ha.
  format?(which: TableFormat): boolean;
  /// La stessa enfasi sul testo scelto nel campo della cella aperta.
  formatInput?(which: TableFormat, input: HTMLInputElement): void;
  /// Il menu col tasto destro, come dati: lo disegna l'ospite.
  openMenu(entries: readonly TableMenuEntry[], at: { readonly x: number; readonly y: number }): void;
  /// Le voci dell'ospite in fondo al menu (il link di una cella).
  extraMenu?(): readonly TableMenuEntry[];
  writeClipboard(data: TableClipboard): Promise<void>;
  focused?(): void;
  changed?(): void;
  /// `false` se la griglia non è una fermata del Tab: una tabella dentro un
  /// testo si raggiunge con le frecce, come il testo attorno, e il Tab
  /// dall'ultima cella che aggiunge una riga non trattiene chi scorre la
  /// pagina. Senza, la griglia è una fermata.
  readonly tabStop?: boolean;
}

interface Editing {
  readonly row: number;
  readonly column: number;
  readonly input: HTMLInputElement;
  /// `replace`: aperta da un carattere, le frecce laterali confermano.
  /// `edit`: aperta con Invio, F2 o il doppio clic.
  readonly mode: "replace" | "edit";
  readonly original: string;
  /// Gli ascoltatori del campo, chiusi con la modifica.
  readonly life: Lifetime;
}

/// Il prefisso delle classi della Tabella.
const C = "tb";
let serial = 0;

export class TableFrame {
  readonly element: HTMLElement;
  readonly #host: TableFrameHost;
  readonly #life: Lifetime;
  readonly #grid: HTMLElement;
  readonly #fillHandle: HTMLElement;
  readonly #id = `tb-${++serial}`;
  #anchor: Cell = { row: 0, column: 0 };
  #focus: Cell = { row: 0, column: 0 };
  #editing: Editing | null = null;
  #cells: HTMLElement[][] = [];
  #letters: HTMLElement[] = [];
  #rowHeads: HTMLElement[] = [];
  #shape = "";
  #adders: HTMLButtonElement[] = [];
  #drag: Lifetime | null = null;
  #hydrated: (() => void) | null = null;
  /// Dove arriverebbe il riempimento mentre si tira la maniglia.
  #fillTo: Range | null = null;

  constructor(host: TableFrameHost, className = "") {
    this.#host = host;
    this.#life = openLifetime();
    this.element = document.createElement("div");
    this.element.className = `${C}-frame ${className}`.trim();
    this.element.contentEditable = "false";
    this.#grid = document.createElement("div");
    this.#grid.className = `${C}-grid`;
    this.#grid.tabIndex = host.tabStop === false ? -1 : 0;
    this.#grid.setAttribute("role", "grid");
    this.#grid.setAttribute("aria-multiselectable", "true");
    this.#fillHandle = document.createElement("div");
    this.#fillHandle.className = `${C}-fill`;
    this.#fillHandle.setAttribute("aria-hidden", "true");
    this.#fillHandle.title = t("table.menu.fill");
    this.element.append(this.#grid, this.#drawAdders());
    this.#life.listen(this.#grid, "keydown", (event) => this.#keydown(event));
    this.#life.listen(this.#grid, "mousedown", (event) => this.#mousedown(event));
    this.#life.listen(this.#grid, "dblclick", (event) => this.#dblclick(event));
    this.#life.listen(this.#grid, "contextmenu", (event) => this.#contextmenu(event));
    this.#life.listen(this.#grid, "focusin", () => {
      this.#host.focused?.();
      this.#placeFill();
    });
    this.#life.listen(this.#grid, "focusout", () => queueMicrotask(() => this.#placeFill()));
    this.#life.listen(this.#grid, "copy", (event) => this.#copy(event, false));
    this.#life.listen(this.#grid, "cut", (event) => this.#copy(event, true));
    this.#life.listen(this.#grid, "paste", (event) => this.#paste(event));
    this.#life.listen(this.#fillHandle, "mousedown", (event) => this.#fillDrag(event));
    this.#render();
  }

  // ── Stato pubblico ─────────────────────────────────────────────────────────

  get selection(): { anchor: Cell; focus: Cell } {
    return { anchor: this.#anchor, focus: this.#focus };
  }

  get range(): Range {
    return rangeBetween(this.#anchor, this.#focus);
  }

  get editing(): boolean {
    return this.#editing !== null;
  }

  /// La tabella è cambiata (una modifica, un annulla, un altro riquadro): si
  /// ridisegna, e la selezione resta dov'era finché c'è.
  update(): void {
    this.#anchor = this.#clamp(this.#anchor);
    this.#focus = this.#clamp(this.#focus);
    this.#render();
  }

  /// Porta il fuoco nella tabella: sulla prima o sull'ultima riga (entrando
  /// con le frecce dal testo), o su una cella.
  focus(at: "first" | "last" | Cell = this.#focus): void {
    const position = at === "first" ? { row: 0, column: 0 } : at === "last" ? { row: this.#host.size().rows - 1, column: 0 } : at;
    this.#select(this.#clamp(position), false);
    this.#grid.focus({ preventScroll: true });
    this.#scrollToFocus();
  }

  /// Rimette una selezione salvata, per una tabella ridisegnata da capo.
  restore(selection: { anchor: Cell; focus: Cell }, focused: boolean): void {
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

  /// Si smonta dentro un aggiornamento di chi la ospita, dove scrivere non
  /// si può: la cella aperta non si conferma qui. La conferma è già avvenuta
  /// all'uscita del fuoco dal campo.
  destroy(): void {
    this.#editing?.life.close();
    this.#editing = null;
    this.#drag?.close();
    this.#hydrated?.();
    this.#life.close();
  }

  // ── Comandi ────────────────────────────────────────────────────────────────

  #context(): TableCommandContext {
    return { range: this.range, active: this.#focus, size: this.#host.size(), caps: this.#host.caps() };
  }

  /// Se il comando del catalogo `id` c'è in questa tabella, e se adesso vale.
  commandState(id: string): { readonly known: boolean; readonly enabled: boolean } {
    const command = tableCommand(id, this.#host.caps());
    if (!command) return { known: false, enabled: false };
    return { known: true, enabled: !this.#host.readOnly() && command.applicable(this.#context()) };
  }

  /// Esegue il comando del catalogo `id`; `false` se non c'è o non vale.
  runCommand(id: string): boolean {
    if (this.#host.readOnly()) return false;
    const command = tableCommand(id, this.#host.caps());
    const context = this.#context();
    if (!command || !command.applicable(context)) return false;
    const { edit, select } = command.edit(context);
    return this.apply(edit, select);
  }

  /// Fa un cambio, e sposta la selezione dove il gesto l'ha lasciata.
  apply(edit: TableEdit, select?: TableTarget): boolean {
    const target = select ?? { anchor: this.#anchor, focus: this.#focus };
    if (!this.#host.apply(edit, target)) return false;
    this.#anchor = this.#clamp(target.anchor);
    this.#focus = this.#clamp(target.focus);
    this.#paintSelection();
    this.#scrollToFocus();
    this.#host.changed?.();
    return true;
  }

  // ── Disegno ────────────────────────────────────────────────────────────────

  #clamp(position: Cell): Cell {
    const { rows, columns } = this.#host.size();
    return {
      row: Math.max(0, Math.min(rows - 1, position.row)),
      column: Math.max(0, Math.min(columns - 1, position.column)),
    };
  }

  #cellId(row: number, column: number): string {
    return `${this.#id}-r${row}c${column}`;
  }

  #render(): void {
    const { rows, columns } = this.#host.size();
    const shape = `${rows}x${columns}`;
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
    const { rows, columns } = this.#host.size();
    const headerRows = this.#host.caps().headerRows;
    // Le righe e le celle sono della griglia: la tabella HTML dà soltanto la
    // disposizione (e la pelle delle tabelle rese), non una seconda struttura.
    const table = document.createElement("table");
    table.setAttribute("role", "presentation");
    const head = document.createElement("thead");
    const letters = document.createElement("tr");
    letters.setAttribute("role", "row");
    letters.className = `${C}-letters`;
    const corner = document.createElement("td");
    corner.className = `${C}-corner`;
    corner.setAttribute("role", "presentation");
    letters.append(corner);
    this.#letters = [];
    for (let column = 0; column < columns; column++) {
      const letter = document.createElement("td");
      letter.className = `${C}-letter`;
      letter.setAttribute("role", "columnheader");
      letter.dataset.col = String(column);
      letter.textContent = columnName(column);
      this.#letters.push(letter);
      letters.append(letter);
    }
    head.append(letters);
    const body = document.createElement("tbody");
    this.#cells = [];
    this.#rowHeads = [];
    for (let r = 0; r < rows; r++) {
      const line = document.createElement("tr");
      line.setAttribute("role", "row");
      const number = document.createElement("td");
      number.className = `${C}-rowhead`;
      number.setAttribute("role", "rowheader");
      number.dataset.row = String(r);
      number.textContent = String(r + 1);
      this.#rowHeads.push(number);
      line.append(number);
      const cells: HTMLElement[] = [];
      for (let c = 0; c < columns; c++) {
        const header = r < headerRows;
        const cell = document.createElement(header ? "th" : "td");
        cell.className = header ? `${C}-cell ${C}-head` : `${C}-cell`;
        cell.id = this.#cellId(r, c);
        cell.setAttribute("role", "gridcell");
        cell.dataset.row = String(r);
        cell.dataset.col = String(c);
        cells.push(cell);
        line.append(cell);
      }
      this.#cells.push(cells);
      body.append(line);
    }
    table.append(head, body);
    this.#grid.replaceChildren(table, this.#fillHandle);
    this.#grid.setAttribute("aria-rowcount", String(rows));
    this.#grid.setAttribute("aria-colcount", String(columns));
  }

  /// Il contenuto delle celle, resa compresa. La cella aperta resta com'è:
  /// il suo testo è di chi sta scrivendo.
  #fill(): void {
    this.#grid.setAttribute("aria-label", t("table.grid.label"));
    const [addRow, addColumn] = this.#adders;
    if (addRow) addRow.textContent = `+ ${t("table.grid.add_row")}`;
    if (addColumn) addColumn.textContent = `+ ${t("table.grid.add_column")}`;
    const caps = this.#host.caps();
    if (addRow) addRow.hidden = this.#host.readOnly() || !caps.insertRows;
    if (addColumn) addColumn.hidden = this.#host.readOnly() || !caps.insertColumns;
    this.#cells.forEach((cells, r) => cells.forEach((cell, c) => {
      if (this.#editing?.row === r && this.#editing.column === c) return;
      cell.style.textAlign = this.#host.align?.(c) ?? "";
      const text = this.#host.cellText(r, c);
      const content = document.createElement("div");
      content.className = `${C}-content`;
      if (text !== "" && this.#host.renderCell) this.#host.renderCell(r, c, content);
      else content.textContent = text;
      const key = `${text}\u0000${content.innerHTML}`;
      if (cell.dataset.shown === key) return;
      cell.dataset.shown = key;
      cell.replaceChildren(content);
    }));
    this.#hydrated?.();
    this.#hydrated = this.#host.hydrate?.(this.#grid) ?? null;
  }

  #paintSelection(): void {
    const range = this.range;
    const fill = this.#fillTo;
    this.#cells.forEach((cells, r) => cells.forEach((cell, c) => {
      const selected = inside(range, r, c);
      cell.classList.toggle("is-selected", selected);
      cell.classList.toggle("is-active", r === this.#focus.row && c === this.#focus.column);
      cell.classList.toggle("is-fill", fill !== null && !selected && inside(fill, r, c));
      cell.setAttribute("aria-selected", String(selected));
    }));
    this.#letters.forEach((letter, c) => letter.classList.toggle("is-selected", c >= range.c0 && c <= range.c1));
    this.#rowHeads.forEach((head, r) => head.classList.toggle("is-selected", r >= range.r0 && r <= range.r1));
    this.#grid.setAttribute("aria-activedescendant", this.#cellId(this.#focus.row, this.#focus.column));
    this.#placeFill();
  }

  /// La maniglia nell'angolo in basso a destra della selezione, mentre la
  /// tabella ha il fuoco e si può scrivere.
  #placeFill(): void {
    const range = this.range;
    const corner = this.#cells[range.r1]?.[range.c1];
    const shown = corner !== undefined && this.hasFocus() && this.#editing === null && !this.#host.readOnly();
    this.#fillHandle.hidden = !shown;
    if (!shown) return;
    const box = this.#grid.getBoundingClientRect();
    const cell = corner.getBoundingClientRect();
    this.#fillHandle.style.left = `${cell.right - box.left + this.#grid.scrollLeft}px`;
    this.#fillHandle.style.top = `${cell.bottom - box.top + this.#grid.scrollTop}px`;
  }

  #scrollToFocus(): void {
    this.#cells[this.#focus.row]?.[this.#focus.column]?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }

  #drawAdders(): HTMLElement {
    const bar = document.createElement("div");
    bar.className = `${C}-adders`;
    const row = document.createElement("button");
    row.type = "button";
    row.className = `${C}-add`;
    row.dataset.add = "row";
    row.setAttribute("aria-label", t("table.grid.add_row_here"));
    const column = document.createElement("button");
    column.type = "button";
    column.className = `${C}-add`;
    column.dataset.add = "column";
    column.setAttribute("aria-label", t("table.grid.add_column_here"));
    this.#adders = [row, column];
    for (const button of [row, column]) {
      button.tabIndex = -1;
      this.#life.listen(button, "mousedown", (event) => event.preventDefault());
      this.#life.listen(button, "click", () => {
        if (this.#host.readOnly()) return;
        const { rows, columns } = this.#host.size();
        if (button === row) this.apply({ kind: "insert-rows", at: rows, count: 1 }, one(rows, 0));
        else this.apply({ kind: "insert-columns", at: columns, count: 1 }, one(0, columns));
        this.#grid.focus({ preventScroll: true });
      });
    }
    bar.append(row, column);
    return bar;
  }

  // ── Selezione ──────────────────────────────────────────────────────────────

  #select(position: Cell, extend: boolean): void {
    this.#focus = this.#clamp(position);
    if (!extend) this.#anchor = this.#focus;
    this.#paintSelection();
    this.#scrollToFocus();
    this.#host.changed?.();
  }

  #move(rows: number, columns: number, extend: boolean): void {
    this.#select({ row: this.#focus.row + rows, column: this.#focus.column + columns }, extend);
  }

  /// Tab e Maiusc+Tab: avanti e indietro lungo le righe. Dall'ultima cella
  /// Tab aggiunge una riga, come quando si compila una tabella.
  #tab(step: 1 | -1): void {
    const { rows, columns } = this.#host.size();
    const index = this.#focus.row * columns + this.#focus.column + step;
    if (index >= rows * columns) {
      if (this.#host.readOnly() || !this.#host.caps().insertRows) return;
      this.apply({ kind: "insert-rows", at: rows, count: 1 }, one(rows, 0));
      return;
    }
    if (index < 0) return;
    this.#select({ row: Math.floor(index / columns), column: index % columns }, false);
  }

  #selectAll(): void {
    const { rows, columns } = this.#host.size();
    this.#anchor = { row: 0, column: 0 };
    this.#focus = { row: rows - 1, column: columns - 1 };
    this.#paintSelection();
    this.#host.changed?.();
  }

  // ── Tastiera ───────────────────────────────────────────────────────────────

  #keydown(event: KeyboardEvent): void {
    if (event.defaultPrevented) return;
    if (this.#editing && event.target === this.#editing.input) {
      this.#editingKey(event);
      return;
    }
    if (event.isComposing) return;
    const intent = sheetIntent(event);
    if (!intent) return;
    const { rows, columns } = this.#host.size();
    const last = rows - 1;
    switch (intent.kind) {
      case "undo": this.#host.undo(); break;
      case "redo": this.#host.redo(); break;
      case "select-all": this.#selectAll(); break;
      case "format":
        if (this.#host.readOnly() || !this.#host.format?.(intent.which)) return;
        break;
      case "edge": {
        const row = intent.row === "first" ? 0 : intent.row === "last" ? last : this.#focus.row;
        const column = intent.column === "first" ? 0 : intent.column === "last" ? columns - 1 : this.#focus.column;
        this.#select({ row, column }, intent.extend);
        break;
      }
      case "move":
        if (intent.rows < 0 && this.#focus.row === 0 && !intent.extend) this.#host.leave("before");
        else if (intent.rows > 0 && this.#focus.row === last && !intent.extend) this.#host.leave("after");
        else this.#move(intent.rows, intent.columns, intent.extend);
        break;
      case "page": this.#move(intent.direction * 10, 0, intent.extend); break;
      case "tab": this.#tab(intent.step); break;
      case "enter": this.#move(intent.step, 0, false); break;
      case "edit": this.#beginEditing(this.#focus, "edit"); break;
      case "clear":
        if (!this.#host.readOnly()) this.apply({ kind: "clear", range: this.range });
        break;
      case "leave": this.#host.leave("after"); break;
      case "menu": this.#openMenu(null); break;
      case "type":
        if (this.#host.readOnly()) return;
        this.#beginEditing(this.#focus, "replace", intent.text);
        break;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  #editingKey(event: KeyboardEvent): void {
    const editing = this.#editing!;
    if (event.isComposing) return;
    const intent = editingIntent(event, editing.mode);
    if (!intent) {
      // Il resto è del campo: annulla, copia e incolla del testo compresi.
      // Non sale oltre la tabella, così nessuna scorciatoia dell'app scatta
      // mentre si scrive in una cella.
      event.stopPropagation();
      return;
    }
    switch (intent.kind) {
      case "format": this.#host.formatInput?.(intent.which, editing.input); break;
      case "commit":
        this.#finishEditing(true);
        this.#move(intent.rows, intent.columns, false);
        break;
      case "commit-tab":
        this.#finishEditing(true);
        this.#tab(intent.step);
        break;
      case "cancel": this.#finishEditing(false); break;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  /// Apre una cella; `initial` è il testo con cui comincia, `caret` dove sta
  /// il cursore.
  beginEditing(position: Cell, initial?: string, caret?: number): void {
    this.#beginEditing(position, "edit", initial, caret);
  }

  #beginEditing(position: Cell, mode: "replace" | "edit", initial?: string, caret?: number): void {
    if (this.#host.readOnly()) return;
    this.#finishEditing(true);
    const { row, column } = this.#clamp(position);
    const cell = this.#cells[row]?.[column];
    if (!cell) return;
    this.#select({ row, column }, false);
    const original = this.#host.cellText(row, column);
    const input = document.createElement("input");
    input.type = "text";
    input.className = `${C}-input`;
    input.spellcheck = true;
    input.value = initial ?? original;
    input.setAttribute("aria-label", t("table.grid.cell", { cell: `${columnName(column)}${row + 1}` }));
    cell.replaceChildren(input);
    delete cell.dataset.shown;
    const life = openLifetime();
    this.#editing = { row, column, input, mode, original, life };
    this.#placeFill();
    input.focus({ preventScroll: true });
    const at = caret ?? input.value.length;
    input.setSelectionRange(at, at);
    // Il fuoco che esce dalla tabella conferma: un clic nel testo non butta
    // ciò che si era scritto.
    life.listen(input, "blur", () => {
      queueMicrotask(() => {
        if (this.#editing?.input === input && !this.#grid.contains(this.#grid.ownerDocument.activeElement)) {
          this.#finishEditing(true, false);
        }
      });
    });
  }

  /// Chiude la modifica: `commit` scrive il testo, altrimenti si torna a
  /// quello di prima. Il fuoco torna alla tabella se era nel campo.
  #finishEditing(commit: boolean, refocus = true): void {
    const editing = this.#editing;
    if (!editing) return;
    this.#editing = null;
    editing.life.close();
    const hadFocus = editing.input.ownerDocument.activeElement === editing.input;
    const value = editing.input.value.replace(/\r?\n/g, " ");
    const cell = this.#cells[editing.row]?.[editing.column];
    if (cell) delete cell.dataset.shown;
    if (commit && value !== editing.original) {
      this.apply({ kind: "set", blocks: [{ row: editing.row, column: editing.column, rows: [[value]] }] });
    }
    this.#fill();
    this.#paintSelection();
    if (hadFocus && refocus) this.#grid.focus({ preventScroll: true });
  }

  // ── Puntatore ──────────────────────────────────────────────────────────────

  #positionOf(target: EventTarget | null): { kind: "cell" | "row" | "col" | "corner"; row: number; column: number } | null {
    const element = target instanceof Element ? target.closest<HTMLElement>("td, th") : null;
    if (!element || !this.#grid.contains(element)) return null;
    if (element.classList.contains(`${C}-corner`)) return { kind: "corner", row: 0, column: 0 };
    const row = Number(element.dataset.row ?? -1);
    const column = Number(element.dataset.col ?? -1);
    if (element.classList.contains(`${C}-letter`)) return { kind: "col", row: -1, column };
    if (element.classList.contains(`${C}-rowhead`)) return { kind: "row", row, column: -1 };
    if (row < 0 || column < 0) return null;
    return { kind: "cell", row, column };
  }

  #mousedown(event: MouseEvent): void {
    if (this.#editing && event.target instanceof Node && this.#editing.input.contains(event.target)) return;
    if (event.target === this.#fillHandle) return;
    if (event.button === 0 && (event.ctrlKey || event.metaKey) && this.#host.activate?.(event)) {
      event.preventDefault();
      return;
    }
    const hit = this.#positionOf(event.target);
    if (!hit) return;
    if (event.button !== 0) {
      // Il tasto destro tiene la selezione se il clic ci cade dentro.
      if (hit.kind === "cell" && !inside(this.range, hit.row, hit.column)) this.#select(hit, false);
      return;
    }
    event.preventDefault();
    this.#finishEditing(true, false);
    this.#grid.focus({ preventScroll: true });
    const { rows, columns } = this.#host.size();
    if (hit.kind === "corner") {
      this.#selectAll();
      return;
    }
    if (hit.kind === "col") {
      const from = event.shiftKey ? this.#anchor.column : hit.column;
      this.#anchor = { row: 0, column: from };
      this.#focus = { row: rows - 1, column: hit.column };
      this.#paintSelection();
      this.#host.changed?.();
      return;
    }
    if (hit.kind === "row") {
      const from = event.shiftKey ? this.#anchor.row : hit.row;
      this.#anchor = { row: from, column: 0 };
      this.#focus = { row: hit.row, column: columns - 1 };
      this.#paintSelection();
      this.#host.changed?.();
      return;
    }
    this.#select(hit, event.shiftKey);
    // Trascinare allarga la selezione fino alla cella sotto il puntatore.
    this.#follow((over) => {
      if (over.row !== this.#focus.row || over.column !== this.#focus.column) this.#select(over, true);
    }, () => {});
  }

  /// Segue il puntatore fino al rilascio, cella per cella.
  #follow(over: (cell: Cell) => void, done: () => void): void {
    this.#drag?.close();
    const drag = openLifetime();
    this.#drag = drag;
    const doc = this.#grid.ownerDocument;
    drag.listen(doc, "mousemove", (move) => {
      const under = doc.elementFromPoint?.(move.clientX, move.clientY) ?? null;
      const hit = this.#positionOf(under);
      if (hit?.kind === "cell") over(hit);
    });
    drag.listen(doc, "mouseup", () => {
      drag.close();
      if (this.#drag === drag) this.#drag = null;
      done();
    });
  }

  /// La maniglia di riempimento: tirata in giù o a destra (o in su, a
  /// sinistra), allarga la selezione nella direzione più lunga, e al rilascio
  /// scrive la serie.
  #fillDrag(event: MouseEvent): void {
    if (event.button !== 0 || this.#host.readOnly()) return;
    event.preventDefault();
    event.stopPropagation();
    const source = this.range;
    this.#follow((over) => {
      this.#fillTo = fillRange(source, over);
      this.#paintSelection();
    }, () => {
      const target = this.#fillTo;
      this.#fillTo = null;
      if (target === null) {
        this.#paintSelection();
        return;
      }
      this.fill(source, target);
    });
  }

  /// Riempie `target` a partire da `source`, che vi sta dentro a un capo:
  /// ogni riga (o colonna) continua la sua serie.
  fill(source: Range, target: Range): boolean {
    const down = target.r1 > source.r1;
    const up = target.r0 < source.r0;
    const right = target.c1 > source.c1;
    const left = target.c0 < source.c0;
    const blocks: { row: number; column: number; rows: string[][] }[] = [];
    if (down || up) {
      const count = down ? target.r1 - source.r1 : source.r0 - target.r0;
      const top = down ? source.r1 + 1 : target.r0;
      const rows: string[][] = Array.from({ length: count }, () => []);
      for (let c = source.c0; c <= source.c1; c++) {
        const seed: string[] = [];
        for (let r = source.r0; r <= source.r1; r++) seed.push(this.#host.cellText(r, c));
        const values = fillSeries(seed, count, up);
        values.forEach((value, i) => rows[up ? count - 1 - i : i]!.push(value));
      }
      blocks.push({ row: top, column: source.c0, rows });
    } else if (right || left) {
      const count = right ? target.c1 - source.c1 : source.c0 - target.c0;
      const first = right ? source.c1 + 1 : target.c0;
      const rows: string[][] = [];
      for (let r = source.r0; r <= source.r1; r++) {
        const seed: string[] = [];
        for (let c = source.c0; c <= source.c1; c++) seed.push(this.#host.cellText(r, c));
        const values = fillSeries(seed, count, left);
        rows.push(left ? values.reverse() : values);
      }
      blocks.push({ row: source.r0, column: first, rows });
    } else {
      this.#paintSelection();
      return false;
    }
    return this.apply({ kind: "set", blocks }, { anchor: { row: target.r0, column: target.c0 }, focus: { row: target.r1, column: target.c1 } });
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
    if (hit.kind === "cell" && !inside(this.range, hit.row, hit.column)) this.#select(hit, false);
    this.#openMenu(event);
  }

  // ── Menu ───────────────────────────────────────────────────────────────────

  /// Le voci del menu col tasto destro, come dati.
  menu(): TableMenuEntry[] {
    const readOnly = this.#host.readOnly();
    const caps = this.#host.caps();
    const context = this.#context();
    const entries: TableMenuEntry[] = [
      { id: "table.cut", label: t("table.menu.cut"), keys: "Mod-x", separator: false, disabled: readOnly, run: () => void this.#copyToClipboard(true) },
      { id: "table.copy", label: t("table.menu.copy"), keys: "Mod-c", separator: false, disabled: false, run: () => void this.#copyToClipboard(false) },
    ];
    for (const command of TABLE_COMMANDS) {
      if (!caps[command.needs]) continue;
      entries.push({
        id: command.id,
        label: t(command.label),
        separator: command.group === true,
        disabled: readOnly || !command.applicable(context),
        run: () => void this.runCommand(command.id),
      });
    }
    if (caps.align) {
      TABLE_ALIGNS.forEach(({ label, align }, index) => entries.push({
        id: `table.align.${align ?? "default"}`,
        label: t(label),
        separator: index === 0,
        disabled: readOnly,
        run: () => void this.apply({ kind: "align", from: this.range.c0, to: this.range.c1, align }),
      }));
    }
    entries.push({
      id: "table.clear",
      label: t("table.menu.clear"),
      keys: "Delete",
      separator: true,
      disabled: readOnly,
      run: () => void this.apply({ kind: "clear", range: this.range }),
    });
    return [...entries, ...(this.#host.extraMenu?.() ?? [])];
  }

  #openMenu(event: MouseEvent | null): void {
    const cell = this.#cells[this.#focus.row]?.[this.#focus.column];
    const box = cell?.getBoundingClientRect();
    const at = event ? { x: event.clientX, y: event.clientY } : { x: box?.left ?? 0, y: box?.bottom ?? 0 };
    this.#host.openMenu(this.menu(), at);
  }

  // ── Appunti ────────────────────────────────────────────────────────────────

  #clipboard(range: Range): TableClipboard {
    const rows = [];
    for (let r = range.r0; r <= range.r1; r++) {
      const cells = [];
      for (let c = range.c0; c <= range.c1; c++) {
        const text = this.#host.cellText(r, c);
        cells.push({ input: text, shown: this.#cells[r]?.[c]?.textContent ?? text });
      }
      rows.push(cells);
    }
    return clipboardData(rows);
  }

  #copy(event: ClipboardEvent, cut: boolean): void {
    if (this.#editing || !event.clipboardData) return;
    event.preventDefault();
    const data = this.#clipboard(this.range);
    event.clipboardData.setData("text/plain", data.text);
    event.clipboardData.setData("text/html", data.html);
    if (cut && !this.#host.readOnly()) this.apply({ kind: "clear", range: this.range });
  }

  /// Copia e taglio dal menu: gli appunti rispondono dopo, e intanto la
  /// selezione può spostarsi o la tabella cambiare. Il taglio svuota le celle
  /// copiate soltanto se il loro testo è ancora quello copiato.
  async #copyToClipboard(cut: boolean): Promise<void> {
    const range = this.range;
    const data = this.#clipboard(range);
    try {
      await this.#host.writeClipboard(data);
    } catch {
      return;
    }
    if (!cut || this.#life.closed || this.#host.readOnly()) return;
    if (this.#clipboard(range).text !== data.text) return;
    this.apply({ kind: "clear", range });
  }

  #paste(event: ClipboardEvent): void {
    if (this.#editing || !event.clipboardData) return;
    event.preventDefault();
    this.pasteData(event.clipboardData.getData("text/plain"), event.clipboardData.getData("text/html"));
  }

  /// Incolla il testo (e l'HTML, se c'è) degli appunti sulla selezione, come
  /// Mod-v: dal menu, dove gli appunti si leggono dopo il gesto. `false` se
  /// non c'era niente da scrivere.
  pasteData(text: string, html: string): boolean {
    if (this.#editing || this.#host.readOnly()) return false;
    const rows = clipboardRows(text, html);
    if (rows.length === 0) return false;
    const block = { rows: rows.length, columns: Math.max(...rows.map((row) => row.length)) };
    const targets = pasteTargets(this.range, block);
    if (targets.length === 0) return false;
    const first = targets[0]!;
    const end = targets[targets.length - 1]!;
    return this.apply(
      { kind: "set", blocks: targets.map((range) => ({ row: range.r0, column: range.c0, rows })) },
      { anchor: { row: first.r0, column: first.c0 }, focus: { row: end.r1, column: end.c1 } },
    );
  }
}

const one = (row: number, column: number): TableTarget => ({ anchor: { row, column }, focus: { row, column } });

function inside(range: Range, row: number, column: number): boolean {
  return row >= range.r0 && row <= range.r1 && column >= range.c0 && column <= range.c1;
}

/// Il nome di una colonna come nei fogli di calcolo: A … Z, AA, AB, …
export function columnName(index: number): string {
  let name = "";
  let n = index + 1;
  while (n > 0) {
    const rest = (n - 1) % 26;
    name = String.fromCharCode(65 + rest) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}
