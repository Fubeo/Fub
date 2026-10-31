// La griglia delle tabelle dentro CodeMirror: il widget che la Live posa al
// posto di ogni tabella, e l'host che traduce i gesti della griglia in
// transazioni dell'editor.
//
// Una tabella nella Live resta griglia anche col cursore dentro: la sorgente
// con le pipe è della modalità Sorgente. Le modifiche passano dalla stessa
// `dispatch` della tastiera (`userEvent: "input"`), quindi entrano nella
// cronologia locale della superficie e nella sessione del documento come ogni
// battuta; annulla e ripeti sono quelli nativi dell'editor.
import { Prec, type Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, WidgetType, keymap, type ViewUpdate } from "@codemirror/view";
import { redo, undo } from "@codemirror/commands";
import { isAllowedLink } from "../../../../ui/sanitize";
import { mountMathBlocks } from "./math";
import type { MarkdownBlock } from "./render-types";
import {
  cellAtOffset,
  cellContentStart,
  parseTable,
  tableChanges,
  type GridPosition,
  type ParsedTable,
  type TableData,
} from "./table-model";
import { TableGrid, type TableGridActions } from "./table-grid";

/// Ciò che chi monta l'editor vuole sapere della griglia attiva: la barra di
/// formattazione le chiede lo stato delle azioni e gliele fa eseguire.
export interface TableGridCallbacks {
  /// La griglia che ha il fuoco in questa vista, o `null` quando torna al testo.
  active(grid: TableGridActions | null): void;
  /// Selezione o contenuto della griglia attiva sono cambiati.
  changed(): void;
}

export interface TableWidgetCallbacks {
  openWikilink(page: string, heading: string | null, block: string | null): void;
  searchTag(tag: string): void;
  readonly tableGrid?: TableGridCallbacks;
}

type GridSelection = { anchor: GridPosition; focus: GridPosition };

/// La griglia montata di ogni widget, per elemento.
const controllers = new WeakMap<HTMLElement, TableController>();
/// La griglia che ha avuto il fuoco per ultima, per vista: resta attiva
/// mentre si apre un menu della barra, finché il fuoco non torna al testo.
const activeGrids = new WeakMap<EditorView, TableGrid>();
/// La selezione da rimettere se una scrittura fa ridisegnare la griglia da
/// capo invece di aggiornarla.
const pending = new WeakMap<EditorView, { from: number; selection: GridSelection; focused: boolean }>();

/// Le griglie montate di una vista.
function mounted(view: EditorView): TableController[] {
  const found: TableController[] = [];
  for (const element of view.contentDOM.querySelectorAll<HTMLElement>(".tb-frame")) {
    const controller = controllers.get(element);
    if (controller) found.push(controller);
  }
  return found;
}

class TableController {
  readonly grid: TableGrid;
  readonly #view: EditorView;
  #widget: TableWidget;
  #parsed: ParsedTable;
  readonly #observer: ResizeObserver | null = null;

  constructor(view: EditorView, widget: TableWidget, parsed: ParsedTable) {
    this.#view = view;
    this.#widget = widget;
    this.#parsed = parsed;
    this.grid = new TableGrid({
      write: (next, select) => this.#write(next, select),
      readOnly: () => this.#view.state.readOnly || this.#widget.readOnly,
      undo: () => void undo({ state: this.#view.state, dispatch: (tr) => this.#view.dispatch(tr) }),
      redo: () => void redo({ state: this.#view.state, dispatch: (tr) => this.#view.dispatch(tr) }),
      leave: (where) => this.#leave(where),
      cellHtml: (row, col) => this.#cellHtml(row, col),
      hydrate: (container) => mountMathBlocks(container),
      activate: (event) => this.#activate(event),
      focused: () => {
        activeGrids.set(this.#view, this.grid);
        this.#widget.callbacks.tableGrid?.active(this.grid);
      },
      changed: () => {
        if (activeGrids.get(this.#view) === this.grid) this.#widget.callbacks.tableGrid?.changed();
      },
    }, parsed);
    if (typeof ResizeObserver !== "undefined") {
      this.#observer = new ResizeObserver(() => this.#view.requestMeasure());
      this.#observer.observe(this.grid.element);
    }
  }

  /// Un widget nuovo per la stessa tabella: la griglia si aggiorna sul posto.
  setWidget(widget: TableWidget, parsed: ParsedTable): void {
    this.#widget = widget;
    this.#parsed = parsed;
    this.grid.update(parsed);
  }

  /// Dove sta adesso la tabella, e la sua sorgente se è ancora quella che la
  /// griglia mostra: una scrittura su una tabella cambiata sotto non si fa.
  locate(): { from: number; to: number; parsed: ParsedTable } | null {
    let start: number;
    try {
      start = this.#view.posAtDOM(this.grid.element) + this.#widget.offset;
    } catch {
      return null;
    }
    const source = this.#parsed.source;
    if (this.#view.state.sliceDoc(start, start + source.length) !== source) return null;
    return { from: start, to: start + source.length, parsed: this.#parsed };
  }

  destroy(): void {
    this.#observer?.disconnect();
    if (activeGrids.get(this.#view) === this.grid) {
      activeGrids.delete(this.#view);
      this.#widget.callbacks.tableGrid?.active(null);
    }
    this.grid.destroy();
  }

  #write(next: TableData, selection: GridSelection): boolean {
    const view = this.#view;
    const located = this.locate();
    if (!located || view.state.readOnly) return false;
    const changes = tableChanges(located.parsed, next).map((change) => ({
      from: located.from + change.from,
      to: located.from + change.to,
      insert: change.insert,
    }));
    if (changes.length === 0) return true;
    pending.set(view, { from: located.from, selection, focused: this.grid.hasFocus() });
    view.dispatch({ changes, userEvent: "input" });
    // La stessa griglia è stata aggiornata sul posto: niente da rimettere.
    if (controllers.get(this.grid.element) === this && this.grid.element.isConnected) pending.delete(view);
    return true;
  }

  /// Rimette il cursore nel testo prima o dopo la tabella. Una tabella in
  /// cima o in fondo al documento guadagna una riga su cui scrivere.
  #leave(where: "before" | "after"): void {
    const view = this.#view;
    const located = this.locate();
    if (!located) {
      view.focus();
      return;
    }
    const doc = view.state.doc;
    const writable = !view.state.readOnly;
    if (where === "before") {
      const first = doc.lineAt(located.from);
      if (first.number > 1) view.dispatch({ selection: { anchor: doc.line(first.number - 1).to }, scrollIntoView: true });
      else if (writable) view.dispatch({ changes: { from: first.from, insert: "\n" }, selection: { anchor: first.from }, userEvent: "input" });
    } else {
      const last = doc.lineAt(located.to);
      if (last.number < doc.lines) view.dispatch({ selection: { anchor: doc.line(last.number + 1).from }, scrollIntoView: true });
      else if (writable) {
        view.dispatch({ changes: { from: doc.length, insert: "\n" }, selection: { anchor: doc.length + 1 }, userEvent: "input" });
      }
    }
    view.focus();
  }

  #cellHtml(row: number, col: number): string | null {
    const start = cellContentStart(this.#parsed, row, col);
    if (start === null) return null;
    return this.#widget.block.cells?.get(start) ?? null;
  }

  /// Mod+clic su ciò che una cella rende: un link a una nota, un tag, un
  /// indirizzo esterno che il sanificatore lascia passare.
  #activate(event: MouseEvent): boolean {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return false;
    const callbacks = this.#widget.callbacks;
    const wiki = target.closest<HTMLElement>("[data-wikilink-page]");
    if (wiki) {
      callbacks.openWikilink(
        wiki.dataset.wikilinkPage ?? "",
        wiki.dataset.wikilinkHeading ?? null,
        wiki.dataset.wikilinkBlock ?? null,
      );
      return true;
    }
    const tag = target.closest<HTMLElement>(".tag[data-tag]");
    if (tag) {
      callbacks.searchTag(tag.dataset.tag ?? "");
      return true;
    }
    const anchor = target.closest<HTMLAnchorElement>("a[href]");
    const href = anchor?.getAttribute("href") ?? "";
    if (anchor && /^[a-z][\w+.-]*:/i.test(href) && isAllowedLink(href)) {
      window.open(href, "_blank", "noopener,noreferrer");
      return true;
    }
    return false;
  }
}

/// La tabella di un blocco, se la griglia la sa leggere.
export function tableOfBlock(block: MarkdownBlock): ParsedTable | null {
  return block.kind === "table" ? parseTable(block.source) : null;
}

export class TableWidget extends WidgetType {
  /// Quanto la tabella comincia dopo l'inizio della riga su cui il widget è
  /// posato (il rientro prima della prima pipe).
  readonly offset: number;

  constructor(
    readonly block: MarkdownBlock,
    rangeFrom: number,
    readonly dependencies: string,
    readonly readOnly: boolean,
    readonly callbacks: TableWidgetCallbacks,
  ) {
    super();
    this.offset = block.from - rangeFrom;
  }

  get estimatedHeight(): number {
    return (this.block.source.split("\n").length + 1) * 34 + 24;
  }

  eq(other: TableWidget): boolean {
    return other.block.source === this.block.source && other.dependencies === this.dependencies
      && other.readOnly === this.readOnly && other.offset === this.offset;
  }

  toDOM(view: EditorView): HTMLElement {
    const parsed = parseTable(this.block.source)!;
    const controller = new TableController(view, this, parsed);
    const root = controller.grid.element;
    controllers.set(root, controller);
    // Ridisegnata da capo dopo una scrittura: la selezione torna dov'era.
    queueMicrotask(() => {
      const saved = pending.get(view);
      if (!saved || !root.isConnected) return;
      if (controller.locate()?.from !== saved.from) return;
      pending.delete(view);
      controller.grid.restore(saved.selection, saved.focused);
    });
    return root;
  }

  updateDOM(dom: HTMLElement): boolean {
    const controller = controllers.get(dom);
    const parsed = parseTable(this.block.source);
    if (!controller || !parsed) return false;
    controller.setWidget(this, parsed);
    return true;
  }

  destroy(dom: HTMLElement): void {
    controllers.get(dom)?.destroy();
    controllers.delete(dom);
  }

  /// Ogni evento dentro la griglia è suo: l'editor non sposta il cursore né
  /// legge la tastiera là dentro.
  ignoreEvent(): boolean {
    return true;
  }
}

/// Dal testo alla griglia con le frecce: giù dalla riga sopra una tabella
/// entra nella prima riga, su dalla riga sotto nell'ultima. Una riga che va a
/// capo si percorre prima tutta, come sempre.
function enter(view: EditorView, direction: 1 | -1): boolean {
  const { selection, doc } = view.state;
  const main = selection.main;
  if (!main.empty || selection.ranges.length > 1) return false;
  const line = doc.lineAt(main.head);
  const moved = view.moveVertically(main, direction > 0);
  if (doc.lineAt(moved.head).number === line.number && moved.head !== main.head) return false;
  for (const controller of mounted(view)) {
    const located = controller.locate();
    if (!located) continue;
    if (direction > 0 && doc.lineAt(located.from).number === line.number + 1) {
      controller.grid.focus("first");
      return true;
    }
    if (direction < 0 && doc.lineAt(located.to).number === line.number - 1) {
      controller.grid.focus("last");
      return true;
    }
  }
  return false;
}

const theme = EditorView.baseTheme({
  ".tb-frame": { position: "relative", padding: "0.2em 0 0.4em" },
  ".tb-grid": { position: "relative", overflowX: "auto", outline: "none", padding: "2px" },
  ".tb-grid table": { borderCollapse: "collapse", margin: "0" },
  // Le testate a riposo sono trasparenti, non nascoste: la riga delle lettere
  // resta una riga di intestazioni anche per chi legge con la sintesi.
  ".tb-grid .tb-corner, .tb-grid .tb-letter, .tb-grid .tb-rowhead": {
    opacity: "0",
    border: "none",
    background: "transparent",
    padding: "0 0.4em",
    color: "var(--doc-gutter-fg, var(--muted, #888))",
    fontSize: "0.72em",
    fontWeight: "500",
    textAlign: "center",
    userSelect: "none",
    cursor: "pointer",
  },
  ".tb-grid:focus-within .tb-letter, .tb-grid:focus-within .tb-rowhead, .tb-grid:focus-within .tb-corner, .tb-grid:hover .tb-letter, .tb-grid:hover .tb-rowhead": {
    opacity: "1",
  },
  ".tb-grid .tb-letter.is-selected, .tb-grid .tb-rowhead.is-selected": {
    color: "var(--accent, #4a7dff)",
    fontWeight: "700",
  },
  ".tb-cell": { position: "relative", minWidth: "4em", cursor: "cell" },
  ".tb-grid:focus-within .tb-cell.is-selected": {
    background: "var(--doc-selection, rgba(74, 125, 255, 0.18))",
  },
  ".tb-grid:focus-within .tb-cell.is-active": {
    boxShadow: "inset 0 0 0 2px var(--accent, #4a7dff)",
  },
  ".tb-grid:focus-within .tb-cell.is-fill": {
    boxShadow: "inset 0 0 0 1px var(--accent, #4a7dff)",
  },
  ".tb-fill": {
    position: "absolute",
    width: "7px",
    height: "7px",
    margin: "-4px 0 0 -4px",
    boxSizing: "border-box",
    background: "var(--accent, #4a7dff)",
    border: "1px solid var(--doc-bg, #fff)",
    cursor: "crosshair",
  },
  ".tb-fill[hidden]": { display: "none" },
  ".tb-content": { minHeight: "1.4em" },
  ".tb-input": {
    boxSizing: "border-box",
    width: "100%",
    minWidth: "6em",
    margin: "0",
    padding: "0",
    border: "none",
    outline: "none",
    background: "transparent",
    color: "inherit",
    font: "inherit",
  },
  ".tb-adders": { display: "flex", gap: "0.5em", paddingLeft: "2.4em", minHeight: "1.6em" },
  ".tb-add": {
    visibility: "hidden",
    border: "none",
    background: "transparent",
    font: "inherit",
    fontSize: "0.8em",
    padding: "0.1em 0.4em",
    borderRadius: "var(--radius-xs, 3px)",
    cursor: "pointer",
  },
  ".tb-frame:hover .tb-add, .tb-frame:focus-within .tb-add": { visibility: "visible" },
  ".tb-add[hidden]": { display: "none" },
});

/// La parte della Live che conosce le griglie: la tastiera per entrarci, la
/// griglia attiva che si spegne quando il fuoco torna al testo, e la
/// selezione portata in una tabella da fuori che vi entra sulla cella giusta.
export function tableGrids(callbacks: TableWidgetCallbacks): Extension {
  const plugin = ViewPlugin.fromClass(class {
    update(update: ViewUpdate): void {
      const view = update.view;
      if (update.focusChanged && view.hasFocus && activeGrids.has(view)) {
        activeGrids.delete(view);
        callbacks.tableGrid?.active(null);
      }
      if (!(update.selectionSet || update.focusChanged) || !view.hasFocus) return;
      // Un cursore o una selezione tutta dentro una tabella — un rimando, una
      // ricerca, la tabella appena inserita dalla barra con l'intestazione
      // selezionata — entra nella griglia sulla cella di chi l'ha portata lì.
      // Vale anche per il fuoco che torna al testo con la selezione ancora lì:
      // scrivere nella sorgente nascosta di una tabella non è un gesto possibile.
      const main = view.state.selection.main;
      if (view.state.selection.ranges.length > 1) return;
      for (const controller of mounted(view)) {
        const located = controller.locate();
        if (!located || main.from <= located.from || main.to >= located.to) continue;
        const cell = cellAtOffset(located.parsed, main.head - located.from);
        if (cell) queueMicrotask(() => controller.grid.focus(cell));
        return;
      }
    }
  });
  return [
    theme,
    plugin,
    Prec.high(keymap.of([
      { key: "ArrowDown", run: (view) => enter(view, 1) },
      { key: "ArrowUp", run: (view) => enter(view, -1) },
    ])),
  ];
}
