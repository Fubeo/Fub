// La cornice della Tabella per una tabella nel flusso del testo: la griglia
// con le lettere delle colonne e i numeri delle righe, la cella attiva, la
// selezione, la maniglia di riempimento e i «+» per allargarla. La disegna e
// la fa funzionare la Tabella; la tabella vera è dell'adattatore, che riceve
// ogni gesto come un `TableEdit` e ridà la tabella com'è dopo (`update`).
//
// # I gesti
//
// Come in un foglio di calcolo: le frecce muovono la cella attiva, Maiusc
// allarga la selezione, Ctrl va al bordo dei dati; Maiusc+Spazio sceglie la
// riga, Ctrl+Spazio la colonna, tutti e due la tabella; Tab va avanti riga per
// riga e dall'ultima cella aggiunge una riga; Invio o F2 aprono la cella, un
// carattere la riscrive; con più celle scelte Invio e Tab girano dentro la
// selezione; Canc la svuota; Ctrl+C, X e V passano TSV e una tabella HTML, e
// le celle tagliate restano tratteggiate finché non si incolla (Esc rinuncia).
// Ctrl+D riempie in giù, Ctrl+R a destra; Ctrl+«+» e Ctrl+«−» inseriscono e
// tolgono righe o colonne secondo ciò che è scelto; Maiusc+F8 e Ctrl+clic
// aggiungono un intervallo agli altri. Dentro la cella Invio conferma e
// scende, Tab conferma e avanza, Esc annulla. Tirare la maniglia nell'angolo
// della selezione riempie la serie.
//
// # Il moto
//
// La selezione, la cella attiva e il segno del taglio sono tre riquadri sopra
// le celle, che scivolano (la pelle dà il tempo); muoversi con le frecce non
// ridisegna la tabella. Un cambio della tabella si anima con `motion.ts`.
//
// # Al tocco
//
// Un tocco sceglie una cella; le due maniglie agli angoli della selezione si
// tirano per allargarla; un tocco lungo apre il menu.

import { t } from "../../i18n/strings";
import { openLifetime, type Lifetime } from "../../ui/lifetime";
import type { TableAlign, TableBlock, TableCaps, TableClipboard, TableEdit, TableMenuEntry, TableSize } from "../adapter";
import { clipboardData, clipboardRows, cutDestination, cutMoves, pasteTargets, type CutMark } from "../clipboard";
import { structureEdit, TABLE_ALIGNS, TABLE_COMMANDS, tableCommand, type TableCommandContext, type TableTarget } from "../commands";
import { editingIntent, sheetIntent, type TableFormat } from "../keys";
import { dataEdge, isMultiCell, nextInRange, type Cell, type Move, type Range, type Shape } from "../navigation";
import { fillCopy, fillRange, rangeBetween, wholeRange, withRange } from "../selection";
import { fillSeries } from "../series";
import { motionAllowed, offsetWithin, playChange, snapshotChange, type ChangeSnapshot } from "./motion";

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
  /// Un avviso breve per chi scrive (un gesto che con più intervalli non si
  /// fa). Senza, il gesto rifiutato tace.
  notice?(text: string): void;
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
/// Quanto dura un tocco lungo prima di aprire il menu (ms), e quanto il dito
/// può muoversi intanto (px).
const LONG_PRESS_MS = 500;
const LONG_PRESS_SLOP = 8;
let serial = 0;

export class TableFrame {
  readonly element: HTMLElement;
  readonly #host: TableFrameHost;
  readonly #life: Lifetime;
  readonly #grid: HTMLElement;
  readonly #fillHandle: HTMLElement;
  /// I riquadri sopra le celle: la selezione, la cella attiva, il taglio.
  readonly #selectionBox: HTMLElement;
  readonly #activeBox: HTMLElement;
  readonly #cutBox: HTMLElement;
  /// Le maniglie del tocco agli angoli della selezione.
  readonly #handles: readonly [HTMLElement, HTMLElement];
  readonly #id = `tb-${++serial}`;
  #anchor: Cell = { row: 0, column: 0 };
  #focus: Cell = { row: 0, column: 0 };
  /// La cella attiva quando Invio o Tab la portano dentro una selezione di
  /// più celle senza cambiarla; `null` vale `#focus`.
  #active: Cell | null = null;
  /// Gli altri intervalli della selezione (Maiusc+F8, Ctrl+clic); quello in
  /// cui si lavora è `range`.
  #others: Range[] = [];
  #otherBoxes: HTMLElement[] = [];
  /// Maiusc+F8 acceso: muoversi tiene gli intervalli già scelti.
  #adding = false;
  #cut: CutMark | null = null;
  #editing: Editing | null = null;
  #cells: HTMLElement[][] = [];
  /// I testi che le celle mostrano adesso: il moto li confronta coi nuovi.
  #texts: string[][] = [];
  #letters: HTMLElement[] = [];
  #rowHeads: HTMLElement[] = [];
  #shape = "";
  #adders: HTMLButtonElement[] = [];
  #drag: Lifetime | null = null;
  #hydrated: (() => void) | null = null;
  /// Dove arriverebbe il riempimento mentre si tira la maniglia.
  #fillTo: Range | null = null;
  /// Il tocco lungo in attesa, e dove è cominciato.
  #press: ReturnType<typeof setTimeout> | null = null;
  #pressAt: { readonly x: number; readonly y: number } | null = null;
  /// Il tocco lungo ha aperto il menu: il `contextmenu` che il sistema manda
  /// dopo non lo riapre.
  #pressed = false;

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
    this.#selectionBox = overlay(`${C}-sel`);
    this.#activeBox = overlay(`${C}-act`);
    this.#cutBox = overlay(`${C}-cut`);
    this.#handles = [overlay(`${C}-handle`), overlay(`${C}-handle`)];
    this.#handles[0].dataset.end = "start";
    this.#handles[1].dataset.end = "end";
    this.element.append(this.#grid, this.#drawAdders());
    this.#life.listen(this.#grid, "keydown", (event) => this.#keydown(event));
    this.#life.listen(this.#grid, "mousedown", (event) => this.#mousedown(event));
    this.#life.listen(this.#grid, "dblclick", (event) => this.#dblclick(event));
    this.#life.listen(this.#grid, "contextmenu", (event) => this.#contextmenu(event));
    this.#life.listen(this.#grid, "pointerdown", (event) => this.#pointerdown(event));
    this.#life.listen(this.#grid, "pointermove", (event) => this.#pointermove(event));
    this.#life.listen(this.#grid, "pointerup", () => this.#cancelPress());
    this.#life.listen(this.#grid, "pointercancel", () => this.#cancelPress());
    this.#life.listen(this.#grid, "focusin", () => {
      this.#host.focused?.();
      this.#placeOverlays();
    });
    this.#life.listen(this.#grid, "focusout", () => queueMicrotask(() => this.#placeOverlays()));
    this.#life.listen(this.#grid, "copy", (event) => this.#copy(event, false));
    this.#life.listen(this.#grid, "cut", (event) => this.#copy(event, true));
    this.#life.listen(this.#grid, "paste", (event) => this.#paste(event));
    this.#life.listen(this.#fillHandle, "mousedown", (event) => this.#fillDrag(event));
    for (const handle of this.#handles) this.#life.listen(handle, "pointerdown", (event) => this.#handleDrag(event, handle));
    this.#life.add(() => this.#cancelPress());
    this.#render();
  }

  // ── Stato pubblico ─────────────────────────────────────────────────────────

  get selection(): { anchor: Cell; focus: Cell } {
    return { anchor: this.#anchor, focus: this.#focus };
  }

  /// La cella attiva: dove si scrive, e da dove partono Invio e Tab. Come
  /// nei fogli di calcolo è l'àncora, finché Invio o Tab non la fanno girare
  /// dentro la selezione.
  get active(): Cell {
    return this.#active ?? this.#anchor;
  }

  get range(): Range {
    return rangeBetween(this.#anchor, this.#focus);
  }

  /// Tutti gli intervalli scelti; l'ultimo è quello in cui si lavora.
  get ranges(): Range[] {
    return [...this.#others, this.range];
  }

  /// Le celle tagliate in attesa di un incolla, o `null`.
  get cutRange(): Range | null {
    return this.#cut?.range ?? null;
  }

  get editing(): boolean {
    return this.#editing !== null;
  }

  /// La tabella è cambiata (una modifica, un annulla, un altro riquadro): si
  /// ridisegna, e la selezione resta dov'era finché c'è. Il cambio si vede:
  /// le celle scivolano dal posto di prima.
  update(): void {
    const snapshot = this.#snapshot();
    this.#anchor = this.#clamp(this.#anchor);
    this.#focus = this.#clamp(this.#focus);
    if (this.#active) this.#active = this.#clamp(this.#active);
    this.#others = this.#others.map((range) => this.#clampRange(range));
    this.#render();
    if (snapshot) playChange(snapshot, this.#grid, this.#cells, this.#texts, this.element);
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
    this.#active = null;
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
    return { range: this.range, active: this.active, size: this.#host.size(), caps: this.#host.caps() };
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

  /// Fa un cambio, e sposta la selezione dove il gesto l'ha lasciata. Ogni
  /// cambio toglie il segno del taglio, come nei fogli di calcolo.
  apply(edit: TableEdit, select?: TableTarget): boolean {
    const target = select ?? { anchor: this.#anchor, focus: this.#focus };
    const keepActive = select === undefined ? this.#active : null;
    if (!this.#host.apply(edit, target)) return false;
    this.#cut = null;
    this.#anchor = this.#clamp(target.anchor);
    this.#focus = this.#clamp(target.focus);
    this.#active = keepActive ? this.#clamp(keepActive) : null;
    if (select !== undefined) this.#others = [];
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

  #clampRange(range: Range): Range {
    return rangeBetween(this.#clamp({ row: range.r0, column: range.c0 }), this.#clamp({ row: range.r1, column: range.c1 }));
  }

  /// La tabella intera: la prima e l'ultima riga e colonna.
  #bounds(): Range {
    const { rows, columns } = this.#host.size();
    return { r0: 0, c0: 0, r1: rows - 1, c1: columns - 1 };
  }

  #cellId(row: number, column: number): string {
    return `${this.#id}-r${row}c${column}`;
  }

  /// Se la tabella si muove adesso: non oltre seicento celle, mai col moto
  /// ridotto.
  #moves(): boolean {
    const { rows, columns } = this.#host.size();
    return motionAllowed(rows * columns);
  }

  /// La tabella di prima, se il cambio che arriva si deve vedere: la forma o
  /// un testo sono diversi, la cornice è nel documento e il moto è acceso.
  #snapshot(): ChangeSnapshot | null {
    if (!this.element.isConnected || this.#cells.length === 0 || !this.#moves()) return null;
    const { rows, columns } = this.#host.size();
    const next = Array.from({ length: rows }, (_, r) => Array.from({ length: columns }, (_, c) => this.#host.cellText(r, c)));
    const same = next.length === this.#texts.length && next.every((row, r) => {
      const old = this.#texts[r]!;
      return row.length === old.length && row.every((text, c) => text === old[c]);
    });
    if (same) return null;
    return snapshotChange(this.#grid, this.#cells, this.#texts, next);
  }

  #render(): void {
    const { rows, columns } = this.#host.size();
    const shape = `${rows}x${columns}`;
    if (shape !== this.#shape) {
      this.#finishEditing(false);
      this.#build();
      this.#shape = shape;
    }
    this.#grid.classList.toggle("is-still", !this.#moves());
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
    this.#texts = [];
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
    this.#otherBoxes = [];
    this.#grid.replaceChildren(table, this.#selectionBox, this.#cutBox, this.#activeBox, this.#fillHandle, ...this.#handles);
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
    this.#texts = this.#cells.map((cells, r) => cells.map((cell, c) => {
      const text = this.#host.cellText(r, c);
      if (this.#editing?.row === r && this.#editing.column === c) return text;
      cell.style.textAlign = this.#host.align?.(c) ?? "";
      const content = document.createElement("div");
      content.className = `${C}-content`;
      if (text !== "" && this.#host.renderCell) this.#host.renderCell(r, c, content);
      else content.textContent = text;
      const key = `${text}\u0000${content.innerHTML}`;
      if (cell.dataset.shown === key) return text;
      cell.dataset.shown = key;
      cell.replaceChildren(content);
      return text;
    }));
    this.#hydrated?.();
    this.#hydrated = this.#host.hydrate?.(this.#grid) ?? null;
  }

  #paintSelection(): void {
    const range = this.range;
    const others = this.#others;
    const fill = this.#fillTo;
    const cut = this.#cut?.range ?? null;
    const active = this.active;
    this.#cells.forEach((cells, r) => cells.forEach((cell, c) => {
      const selected = inside(range, r, c) || others.some((other) => inside(other, r, c));
      cell.classList.toggle("is-selected", selected);
      cell.classList.toggle("is-active", r === active.row && c === active.column);
      cell.classList.toggle("is-fill", fill !== null && !selected && inside(fill, r, c));
      cell.classList.toggle("is-cut", cut !== null && inside(cut, r, c));
      cell.setAttribute("aria-selected", String(selected));
    }));
    const all = [range, ...others];
    this.#letters.forEach((letter, c) => letter.classList.toggle("is-selected", all.some((area) => c >= area.c0 && c <= area.c1)));
    this.#rowHeads.forEach((head, r) => head.classList.toggle("is-selected", all.some((area) => r >= area.r0 && r <= area.r1)));
    this.#grid.setAttribute("aria-activedescendant", this.#cellId(active.row, active.column));
    this.#placeOverlays();
  }

  /// Il rettangolo di `range` nella griglia, dall'impaginazione: le corse in
  /// volo delle celle non lo spostano.
  #box(range: Range): { left: number; top: number; width: number; height: number } | null {
    const first = this.#cells[range.r0]?.[range.c0];
    const last = this.#cells[range.r1]?.[range.c1];
    if (!first || !last) return null;
    const a = offsetWithin(first, this.#grid);
    const b = offsetWithin(last, this.#grid);
    return { left: a.left, top: a.top, width: b.left + last.offsetWidth - a.left, height: b.top + last.offsetHeight - a.top };
  }

  /// Posa un riquadro su `range` (o lo nasconde): la prima volta senza
  /// scivolare, poi scivola dal posto di prima.
  #place(element: HTMLElement, range: Range | null): void {
    const box = range ? this.#box(range) : null;
    if (!box) {
      element.hidden = true;
      return;
    }
    const first = element.hidden;
    if (first) element.style.transition = "none";
    element.style.transform = `translate(${box.left}px, ${box.top}px)`;
    element.style.width = `${box.width}px`;
    element.style.height = `${box.height}px`;
    element.hidden = false;
    if (first) {
      void element.offsetWidth;
      element.style.transition = "";
    }
  }

  /// I riquadri della selezione, della cella attiva e del taglio, la
  /// maniglia di riempimento e quelle del tocco. Le maniglie compaiono mentre
  /// la tabella ha il fuoco e si può scrivere.
  #placeOverlays(): void {
    const range = this.range;
    const active = this.active;
    this.#place(this.#selectionBox, range);
    this.#selectionBox.classList.toggle("is-multi", isMultiCell(range) || this.#others.length > 0);
    this.#place(this.#activeBox, { r0: active.row, c0: active.column, r1: active.row, c1: active.column });
    this.#place(this.#cutBox, this.#cut?.range ?? null);
    while (this.#otherBoxes.length < this.#others.length) {
      const box = overlay(`${C}-sel`);
      box.classList.add("is-multi", "is-other");
      this.#grid.insertBefore(box, this.#selectionBox);
      this.#otherBoxes.push(box);
    }
    while (this.#otherBoxes.length > this.#others.length) this.#otherBoxes.pop()!.remove();
    this.#otherBoxes.forEach((box, index) => this.#place(box, this.#others[index]!));
    const writable = this.hasFocus() && this.#editing === null && !this.#host.readOnly();
    const corner = this.#box({ r0: range.r1, c0: range.c1, r1: range.r1, c1: range.c1 });
    this.#fillHandle.hidden = !writable || corner === null;
    if (corner && writable) {
      this.#fillHandle.style.transform = `translate(${corner.left + corner.width}px, ${corner.top + corner.height}px)`;
    }
    const whole = this.#box(range);
    const [start, end] = this.#handles;
    start.hidden = end.hidden = !writable || whole === null;
    if (whole && writable) {
      start.style.transform = `translate(${whole.left}px, ${whole.top}px)`;
      end.style.transform = `translate(${whole.left + whole.width}px, ${whole.top + whole.height}px)`;
    }
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
    this.#active = null;
    if (!extend && !this.#adding) this.#others = [];
    this.#paintSelection();
    this.#scrollToFocus();
    this.#host.changed?.();
  }

  /// Sceglie `range` tenendo, se ci sta dentro, la cella attiva.
  #selectRange(range: Range): void {
    const active = this.active;
    this.#anchor = { row: range.r0, column: range.c0 };
    this.#focus = { row: range.r1, column: range.c1 };
    this.#active = inside(range, active.row, active.column) ? active : null;
    if (!this.#adding) this.#others = [];
    this.#paintSelection();
    this.#host.changed?.();
  }

  #move(rows: number, columns: number, extend: boolean): void {
    const from = extend ? this.#focus : this.active;
    this.#select({ row: from.row + rows, column: from.column + columns }, extend);
  }

  #geometry(): Shape {
    const { rows, columns } = this.#host.size();
    return {
      step: (axis, from, step) => {
        const next = from + step;
        return next >= 0 && next < (axis === "row" ? rows : columns) ? next : from;
      },
      visible: () => true,
    };
  }

  /// Ctrl con una freccia: fino al bordo dei dati.
  #jump(rows: -1 | 0 | 1, columns: -1 | 0 | 1, extend: boolean): void {
    const from = extend ? this.#focus : this.active;
    const shape = this.#geometry();
    const axis = rows !== 0 ? "row" : "column";
    const step = (rows || columns) as -1 | 1;
    const at = (index: number): Cell => (axis === "row" ? { row: index, column: from.column } : { row: from.row, column: index });
    const index = dataEdge(
      axis === "row" ? from.row : from.column,
      (current) => shape.step(axis, current, step),
      (current) => {
        const cell = at(current);
        return this.#host.cellText(cell.row, cell.column) !== "";
      },
    );
    this.#select(at(index), extend);
  }

  /// Invio e Tab dentro una selezione di più celle: la cella attiva gira, la
  /// selezione resta. `false` se la selezione è di una cella sola.
  #cycle(move: Move): boolean {
    const range = this.range;
    if (!isMultiCell(range)) return false;
    this.#active = nextInRange(range, this.active, move, this.#geometry());
    this.#paintSelection();
    this.#host.changed?.();
    return true;
  }

  /// Tab e Maiusc+Tab: avanti e indietro lungo le righe. Dall'ultima cella
  /// Tab aggiunge una riga, come quando si compila una tabella.
  #tab(step: 1 | -1): void {
    if (this.#cycle(step > 0 ? "right" : "left")) return;
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
    this.#selectRange(this.#bounds());
  }

  /// Maiusc+F8: acceso, l'intervallo di adesso resta scelto e ci si sposta per
  /// sceglierne un altro; di nuovo, o Esc, smette.
  #toggleAdding(): void {
    this.#adding = !this.#adding;
    if (this.#adding) this.#others = withRange(this.#others, this.range);
    this.#paintSelection();
  }

  /// Un gesto che con più intervalli non si fa: lo si dice, e niente cambia.
  #refuseMany(): boolean {
    if (this.#others.length === 0) return false;
    this.#host.notice?.(t("grid.multi.refused"));
    return true;
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
      case "whole": this.#selectRange(wholeRange(this.range, intent.which, this.#bounds())); break;
      case "format":
        if (this.#host.readOnly() || !this.#host.format?.(intent.which)) return;
        break;
      case "edge": {
        const from = intent.extend ? this.#focus : this.active;
        const row = intent.row === "first" ? 0 : intent.row === "last" ? last : from.row;
        const column = intent.column === "first" ? 0 : intent.column === "last" ? columns - 1 : from.column;
        this.#select({ row, column }, intent.extend);
        break;
      }
      case "jump": this.#jump(intent.rows, intent.columns, intent.extend); break;
      case "move": {
        const from = intent.extend ? this.#focus : this.active;
        if (intent.rows < 0 && from.row === 0 && !intent.extend) this.#host.leave("before");
        else if (intent.rows > 0 && from.row === last && !intent.extend) this.#host.leave("after");
        else this.#move(intent.rows, intent.columns, intent.extend);
        break;
      }
      case "page": this.#move(intent.direction * 10, 0, intent.extend); break;
      case "tab": this.#tab(intent.step); break;
      case "enter":
        if (this.#cycle(intent.step > 0 ? "down" : "up")) break;
        if (intent.step > 0) this.#beginEditing(this.active, "edit");
        else this.#move(-1, 0, false);
        break;
      case "edit": this.#beginEditing(this.active, "edit"); break;
      case "clear": this.#clear(); break;
      case "fill":
        if (this.#host.readOnly() || this.#refuseMany()) break;
        this.#fillCopy(intent.direction);
        break;
      case "structure": {
        if (this.#host.readOnly() || this.#refuseMany()) break;
        const change = structureEdit(this.#context(), intent.change);
        if (change) this.apply(change.edit, change.select);
        break;
      }
      case "add-ranges": this.#toggleAdding(); break;
      case "leave": this.#escape(); break;
      case "menu": this.#openMenu(null); break;
      case "type":
        if (this.#host.readOnly()) return;
        this.#beginEditing(this.active, "replace", intent.text);
        break;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  /// Esc, un passo per volta: rinuncia al taglio, poi chiude gli altri
  /// intervalli, poi riduce la selezione alla cella attiva, poi esce.
  #escape(): void {
    if (this.#cut) {
      this.#cut = null;
      this.#paintSelection();
      return;
    }
    if (this.#adding || this.#others.length > 0) {
      this.#adding = false;
      this.#others = [];
      this.#paintSelection();
      return;
    }
    if (isMultiCell(this.range)) {
      this.#select(this.active, false);
      return;
    }
    this.#host.leave("after");
  }

  /// Canc: svuota ogni intervallo scelto, in un passo solo.
  #clear(): void {
    if (this.#host.readOnly()) return;
    if (this.#others.length === 0) {
      this.apply({ kind: "clear", range: this.range });
      return;
    }
    this.apply({ kind: "set", blocks: this.ranges.map((range) => blank(range)) });
  }

  /// Ctrl+D e Ctrl+R: la prima riga (o colonna) scelta nelle altre, o quella
  /// sopra (a sinistra) nella sola scelta. L'intestazione non scende nel
  /// corpo.
  #fillCopy(direction: "down" | "right"): void {
    const copy = fillCopy(this.range, direction, this.#host.caps().headerRows);
    if (!copy) return;
    const { source, target } = copy;
    const rows: string[][] = [];
    for (let r = target.r0; r <= target.r1; r++) {
      const line: string[] = [];
      for (let c = target.c0; c <= target.c1; c++) {
        line.push(direction === "down" ? this.#host.cellText(source.r0, c) : this.#host.cellText(r, source.c0));
      }
      rows.push(line);
    }
    this.apply({ kind: "set", blocks: [{ row: target.r0, column: target.c0, rows }] });
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
        // Dentro una selezione di più celle Invio gira, e la selezione resta.
        if (event.key !== "Enter" || !this.#cycle(intent.rows > 0 ? "down" : "up")) this.#move(intent.rows, intent.columns, false);
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
    // Dentro una selezione di più celle la selezione resta, e la cella aperta
    // diventa quella attiva: Invio e Tab poi girano lì dentro.
    if (isMultiCell(this.range) && inside(this.range, row, column)) {
      this.#active = { row, column };
      this.#paintSelection();
    } else {
      this.#select({ row, column }, false);
    }
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
    this.#placeOverlays();
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
    if (event.target === this.#fillHandle || this.#handles.some((handle) => handle === event.target)) return;
    if (event.button === 0 && (event.ctrlKey || event.metaKey) && this.#host.activate?.(event)) {
      event.preventDefault();
      return;
    }
    const hit = this.#positionOf(event.target);
    if (!hit) return;
    if (event.button !== 0) {
      // Il tasto destro tiene la selezione se il clic ci cade dentro.
      if (hit.kind === "cell" && !this.ranges.some((range) => inside(range, hit.row, hit.column))) this.#select(hit, false);
      return;
    }
    event.preventDefault();
    this.#finishEditing(true, false);
    this.#grid.focus({ preventScroll: true });
    // Ctrl+clic aggiunge un intervallo agli altri, come nei fogli di calcolo.
    const adding = (event.ctrlKey || event.metaKey) && !event.shiftKey;
    if (adding) this.#others = withRange(this.#others, this.range);
    const keep = adding || this.#adding;
    const { rows, columns } = this.#host.size();
    if (hit.kind === "corner") {
      this.#selectAll();
      return;
    }
    if (hit.kind === "col" || hit.kind === "row") {
      const others = keep ? this.#others : [];
      if (hit.kind === "col") {
        const from = event.shiftKey ? this.#anchor.column : hit.column;
        this.#anchor = { row: 0, column: from };
        this.#focus = { row: rows - 1, column: hit.column };
      } else {
        const from = event.shiftKey ? this.#anchor.row : hit.row;
        this.#anchor = { row: from, column: 0 };
        this.#focus = { row: hit.row, column: columns - 1 };
      }
      this.#active = null;
      this.#others = others;
      this.#paintSelection();
      this.#host.changed?.();
      return;
    }
    if (keep && !event.shiftKey) {
      this.#focus = this.#anchor = this.#clamp(hit);
      this.#active = null;
      this.#paintSelection();
      this.#host.changed?.();
    } else {
      this.#select(hit, event.shiftKey);
    }
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
    if (this.#pressed) {
      this.#pressed = false;
      return;
    }
    if (hit.kind === "cell" && !this.ranges.some((range) => inside(range, hit.row, hit.column))) this.#select(hit, false);
    this.#openMenu(event);
  }

  // ── Tocco ──────────────────────────────────────────────────────────────────

  /// Un tocco lungo su una cella apre il menu, come il tasto destro.
  #pointerdown(event: PointerEvent): void {
    this.#pressed = false;
    if (event.pointerType !== "touch") return;
    if (this.#handles.some((handle) => handle === event.target)) return;
    const hit = this.#positionOf(event.target);
    if (hit?.kind !== "cell") return;
    this.#cancelPress();
    this.#pressAt = { x: event.clientX, y: event.clientY };
    const at = { x: event.clientX, y: event.clientY };
    this.#press = setTimeout(() => {
      this.#press = null;
      this.#pressAt = null;
      if (this.#life.closed) return;
      this.#pressed = true;
      if (!this.ranges.some((range) => inside(range, hit.row, hit.column))) this.#select(hit, false);
      this.#host.openMenu(this.menu(), at);
    }, LONG_PRESS_MS);
  }

  #pointermove(event: PointerEvent): void {
    const start = this.#pressAt;
    if (!start) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > LONG_PRESS_SLOP) this.#cancelPress();
  }

  #cancelPress(): void {
    if (this.#press !== null) clearTimeout(this.#press);
    this.#press = null;
    this.#pressAt = null;
  }

  /// Una maniglia del tocco tirata: l'angolo opposto resta, quello tirato
  /// segue il dito cella per cella.
  #handleDrag(event: PointerEvent, handle: HTMLElement): void {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const range = this.range;
    const fixed = handle.dataset.end === "start" ? { row: range.r1, column: range.c1 } : { row: range.r0, column: range.c0 };
    this.#drag?.close();
    const drag = openLifetime();
    this.#drag = drag;
    handle.setPointerCapture?.(event.pointerId);
    const doc = this.#grid.ownerDocument;
    drag.listen(handle, "pointermove", (move) => {
      const hit = this.#positionOf(doc.elementFromPoint?.(move.clientX, move.clientY) ?? null);
      if (hit?.kind !== "cell") return;
      this.#anchor = fixed;
      this.#focus = this.#clamp(hit);
      this.#active = null;
      this.#paintSelection();
      this.#host.changed?.();
    });
    const end = () => {
      drag.close();
      if (this.#drag === drag) this.#drag = null;
    };
    drag.listen(handle, "pointerup", end);
    drag.listen(handle, "pointercancel", end);
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
      run: () => this.#clear(),
    });
    return [...entries, ...(this.#host.extraMenu?.() ?? [])];
  }

  #openMenu(event: MouseEvent | null): void {
    const active = this.active;
    const cell = this.#cells[active.row]?.[active.column];
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

  /// Taglia non svuota: segna le celle, e l'incolla che segue le sposta.
  #markCut(range: Range, text: string): void {
    this.#cut = { range, text };
    this.#paintSelection();
  }

  #copy(event: ClipboardEvent, cut: boolean): void {
    if (this.#editing || !event.clipboardData) return;
    event.preventDefault();
    // Come nei fogli di calcolo: più intervalli non si copiano insieme.
    if (this.#refuseMany()) return;
    const data = this.#clipboard(this.range);
    event.clipboardData.setData("text/plain", data.text);
    event.clipboardData.setData("text/html", data.html);
    if (cut && !this.#host.readOnly()) this.#markCut(this.range, data.text);
    else if (this.#cut) {
      this.#cut = null;
      this.#paintSelection();
    }
  }

  /// Copia e taglio dal menu: gli appunti rispondono dopo, e intanto la
  /// selezione può spostarsi o la tabella cambiare. Il taglio segna le celle
  /// copiate soltanto se il loro testo è ancora quello copiato.
  async #copyToClipboard(cut: boolean): Promise<void> {
    if (this.#refuseMany()) return;
    const range = this.range;
    const data = this.#clipboard(range);
    try {
      await this.#host.writeClipboard(data);
    } catch {
      return;
    }
    if (this.#life.closed) return;
    if (!cut || this.#host.readOnly()) {
      if (this.#cut) {
        this.#cut = null;
        this.#paintSelection();
      }
      return;
    }
    if (this.#clipboard(range).text !== data.text) return;
    this.#markCut(range, data.text);
  }

  #paste(event: ClipboardEvent): void {
    if (this.#editing || !event.clipboardData) return;
    event.preventDefault();
    this.pasteData(event.clipboardData.getData("text/plain"), event.clipboardData.getData("text/html"));
  }

  /// Incolla il testo (e l'HTML, se c'è) degli appunti sulla selezione, come
  /// Mod-v: dal menu, dove gli appunti si leggono dopo il gesto. Dopo un
  /// taglio di questa tabella, sposta le celle tagliate in un passo solo.
  /// `false` se non c'era niente da scrivere.
  pasteData(text: string, html: string): boolean {
    if (this.#editing || this.#host.readOnly()) return false;
    if (this.#refuseMany()) return false;
    const mark = this.#cut;
    if (mark && cutMoves(mark, text, this.#clipboard(mark.range).text)) return this.#pasteCut(mark);
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

  /// L'incolla dopo un taglio: le celle tagliate si svuotano e il loro testo
  /// va all'angolo della selezione, in un cambio solo.
  #pasteCut(mark: CutMark): boolean {
    const destination = cutDestination(mark.range, this.range);
    const rows: string[][] = [];
    for (let r = mark.range.r0; r <= mark.range.r1; r++) {
      const line: string[] = [];
      for (let c = mark.range.c0; c <= mark.range.c1; c++) line.push(this.#host.cellText(r, c));
      rows.push(line);
    }
    return this.apply(
      { kind: "set", blocks: [blank(mark.range), { row: destination.r0, column: destination.c0, rows }] },
      { anchor: { row: destination.r0, column: destination.c0 }, focus: { row: destination.r1, column: destination.c1 } },
    );
  }
}

const one = (row: number, column: number): TableTarget => ({ anchor: { row, column }, focus: { row, column } });

/// Un blocco di celle vuote grande come `range`.
function blank(range: Range): TableBlock {
  return {
    row: range.r0,
    column: range.c0,
    rows: Array.from({ length: range.r1 - range.r0 + 1 }, () => Array.from({ length: range.c1 - range.c0 + 1 }, () => "")),
  };
}

/// Un riquadro sopra le celle, nascosto finché non lo si posa.
function overlay(className: string): HTMLElement {
  const element = document.createElement("div");
  element.className = className;
  element.setAttribute("aria-hidden", "true");
  element.hidden = true;
  return element;
}

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
