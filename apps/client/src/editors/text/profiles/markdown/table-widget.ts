// La griglia delle tabelle dentro CodeMirror: il widget che la Live posa al
// posto di ogni tabella, e l'host che traduce i gesti della griglia in
// transazioni dell'editor.
//
// Una tabella nella Live resta griglia anche col cursore dentro: la sorgente
// con le pipe è della modalità Sorgente. Le modifiche passano dalla stessa
// `dispatch` della tastiera (`userEvent: "input"`), quindi entrano nella
// cronologia locale della superficie e nella sessione del documento come ogni
// battuta; annulla e ripeti sono quelli nativi dell'editor.
import { Prec, type EditorState, type Extension, type Transaction, type TransactionSpec } from "@codemirror/state";
import { EditorView, ViewPlugin, WidgetType, keymap, type ViewUpdate } from "@codemirror/view";
import { redo, undo, undoDepth } from "@codemirror/commands";
import { resolvedLanguage } from "../../../../i18n/strings";
import { isAllowedLink } from "../../../../ui/sanitize";
import { notify } from "../../../../ui/notify";
import { withLineBreaks } from "../../line-breaks";
import { followPath, followWikilink, textLinkGesture, type WikilinkFollow } from "./link-gesture";
import { routeHref } from "./link-syntax";
import { mountMathBlocks } from "./math";
import { frontmatterLanguage } from "./proof";
import type { MarkdownBlock } from "./render-types";
import {
  cellAtOffset,
  cellContentStart,
  parseTable,
  tableChanges,
  tableChangesSince,
  tableWidth,
  type GridPosition,
  type ParsedTable,
  type TableData,
} from "./table-model";
import { generatedChartAfter, tableChart } from "./table-chart";
import { proposesSheet, sheetCells, type TableSheetPort } from "./table-sheet";
import { TableGrid, type TableChartAction, type TableGridActions } from "./table-grid";
import { liveStrings } from "./strings";

/// Ciò che chi monta l'editor vuole sapere della griglia attiva: la barra di
/// formattazione le chiede lo stato delle azioni e gliele fa eseguire.
export interface TableGridCallbacks {
  /// La griglia che ha il fuoco in questa vista, o `null` quando torna al testo.
  active(grid: TableGridActions | null): void;
  /// Selezione o contenuto della griglia attiva sono cambiati.
  changed(): void;
}

/// «Trasforma in foglio» (T52): la nota aperta e chi scrive il foglio.
export interface TableSheetHost {
  doc(): string;
  readonly port: TableSheetPort;
}

export interface TableWidgetCallbacks extends WikilinkFollow {
  openWikilink(page: string, heading: string | null, block: string | null): void;
  searchTag(tag: string): void;
  readonly tableGrid?: TableGridCallbacks;
  readonly tableSheet?: TableSheetHost;
}

type GridSelection = { anchor: GridPosition; focus: GridPosition };

/// Le battute della cella aperta già scritte nel testo (IMP-6100): `base` è
/// la tabella prima della prima battuta, `last` com'è dopo l'ultima. Ogni
/// battuta è un passo della cronologia, `steps` in tutto sopra i `depth`
/// passi che c'erano prima; la scrittura di conferma li annulla e scrive la
/// cella in un passo solo.
type CellTyping = { readonly base: string; readonly last: string; readonly depth: number; readonly steps: number };

/// Quanto testo sotto la tabella si guarda per ritrovare il grafico scritto
/// da «Grafico da questa tabella» (T54).
const CHART_LOOKAHEAD = 64 * 1024;

/// Le viste a cui una tabella grande ha già proposto il foglio (T52): una
/// volta per nota aperta, non a ogni ridisegno.
const proposed = new WeakSet<EditorView>();

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
  #typing: CellTyping | null = null;

  constructor(view: EditorView, widget: TableWidget, parsed: ParsedTable) {
    this.#view = view;
    this.#widget = widget;
    this.#parsed = parsed;
    this.grid = new TableGrid({
      write: (next, select) => this.#write(next, select),
      draft: (next, select) => this.#draft(next, select),
      readOnly: () => this.#view.state.readOnly || this.#widget.readOnly,
      undo: () => void undo({ state: this.#view.state, dispatch: (tr) => this.#view.dispatch(tr) }),
      redo: () => void redo({ state: this.#view.state, dispatch: (tr) => this.#view.dispatch(tr) }),
      leave: (where) => this.#leave(where),
      cellHtml: (row, col) => this.#cellHtml(row, col),
      hydrate: (container) => mountMathBlocks(container),
      activate: (event) => this.#activate(event),
      language: () => frontmatterLanguage(this.#view.state),
      focused: () => {
        activeGrids.set(this.#view, this.grid);
        this.#widget.callbacks.tableGrid?.active(this.grid);
      },
      changed: () => {
        if (activeGrids.get(this.#view) === this.grid) this.#widget.callbacks.tableGrid?.changed();
      },
      chart: () => this.#chart(),
      sheet: () => this.#sheet(),
    }, parsed);
    if (typeof ResizeObserver !== "undefined") {
      this.#observer = new ResizeObserver(() => this.#view.requestMeasure());
      this.#observer.observe(this.grid.element);
    }
    this.#propose(parsed);
  }

  /// Un widget nuovo per la stessa tabella: la griglia si aggiorna sul posto.
  setWidget(widget: TableWidget, parsed: ParsedTable): void {
    this.#widget = widget;
    this.#parsed = parsed;
    this.grid.update(parsed);
    this.#propose(parsed);
  }

  /// Una tabella oltre le 200 righe o le 30 colonne si legge meglio in un
  /// foglio: la nota lo propone una volta, con la voce che lo fa.
  #propose(parsed: ParsedTable): void {
    const view = this.#view;
    if (proposed.has(view) || !proposesSheet(parsed.rows.length - 1, tableWidth(parsed))) return;
    // Dopo il disegno: il widget si costruisce dentro un aggiornamento della
    // vista, e la tabella si ritrova nel testo solo quando è montata.
    queueMicrotask(() => {
      if (proposed.has(view) || this.#sheet() === null) return;
      proposed.add(view);
      notify(liveStrings.t("table_sheet.propose"), "info", {
        label: liveStrings.t("table_sheet.menu"),
        run: () => this.#sheet()?.(),
      });
    });
  }

  /// «Trasforma in foglio» (T52): la voce c'è se chi monta l'editor sa
  /// scrivere il foglio e la nota si scrive.
  #sheet(): (() => void) | null {
    const host = this.#widget.callbacks.tableSheet;
    if (!host || this.#view.state.readOnly || this.#widget.readOnly || this.locate() === null) return null;
    return () => void this.#turnIntoSheet(host);
  }

  async #turnIntoSheet(host: TableSheetHost): Promise<void> {
    const view = this.#view;
    // La tabella di adesso: il testo può essere cambiato da quando il menu
    // si è aperto.
    const located = this.locate();
    if (!located) {
      notify(liveStrings.t("table_sheet.failed"), "info");
      return;
    }
    const locale = frontmatterLanguage(view.state) ?? resolvedLanguage();
    const cells = sheetCells(located.parsed.rows, tableWidth(located.parsed), locale);
    // I byte UTF-8 del file com'è sul disco: `sliceDoc` rende gli a capo del
    // file, anche i `\r`.
    const encoder = new TextEncoder();
    const start = encoder.encode(view.state.sliceDoc(0, located.from)).length;
    const text = view.state.sliceDoc(located.from, located.to);
    const failed = await host.port.turn({ doc: host.doc(), at: [start, start + encoder.encode(text).length], text, cells });
    if (failed !== null) notify(failed, "guasto");
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
    // La sorgente va a capo con "\n", come `doc.sliceString`: la sua lunghezza
    // è in posizioni anche in una nota CRLF.
    const source = this.#parsed.source;
    if (this.#view.state.doc.sliceString(start, start + source.length) !== source) return null;
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
    const typing = this.#typing;
    this.#typing = null;
    // Le battute della cella sono già nel testo, ognuna un passo della
    // cronologia: si annullano e si scrive la cella nuova nello stesso
    // aggiornamento della vista. La cronologia tiene un passo solo, da prima
    // della cella a dopo, e i passi di prima restano interi: chi annulla poi
    // l'inserimento della tabella la toglie tutta (IMP-6105). Battute tolte
    // da fuori dalla cronologia non vanno: ogni passo di prima le
    // attraverserebbe, e il suo annulla lascerebbe il testo che hanno messo.
    // Se intanto la tabella o la cronologia sono cambiate da un'altra parte,
    // le battute restano passi come sono e si scrive soltanto la differenza.
    const undone = typing !== null && typing.last === located.parsed.source ? this.#undoTyping(typing, located.from) : null;
    if (undone !== null) {
      const transactions = undone.transactions;
      const spec = this.#changes(undone.state, located.from, undone.base, next);
      if (spec !== null) transactions.push(undone.state.update(spec));
      pending.set(view, { from: located.from, selection, focused: this.grid.hasFocus() });
      view.dispatch(transactions);
      if (controllers.get(this.grid.element) === this && this.grid.element.isConnected) pending.delete(view);
      return true;
    }
    const spec = this.#changes(view.state, located.from, located.parsed, next);
    if (spec === null) return true;
    pending.set(view, { from: located.from, selection, focused: this.grid.hasFocus() });
    view.dispatch(spec);
    // La stessa griglia è stata aggiornata sul posto: niente da rimettere.
    if (controllers.get(this.grid.element) === this && this.grid.element.isConnected) pending.delete(view);
    return true;
  }

  /// Gli annulla delle battute di `typing`, ancora da mandare alla vista, e
  /// la tabella di prima che rimettono a `from`. `null` se la cronologia non
  /// è più quella delle battute (un altro passo in mezzo, passi vecchi
  /// lasciati cadere dal limite) o se gli annulla non rimettono la tabella.
  #undoTyping(typing: CellTyping, from: number): { transactions: Transaction[]; state: EditorState; base: ParsedTable } | null {
    let state = this.#view.state;
    if (undoDepth(state) !== typing.depth + typing.steps) return null;
    const base = parseTable(typing.base);
    if (!base) return null;
    const transactions: Transaction[] = [];
    const target = {
      get state() { return state; },
      dispatch: (tr: Transaction) => {
        transactions.push(tr);
        state = tr.state;
      },
    };
    for (let step = 0; step < typing.steps; step++) {
      if (!undo(target)) return null;
    }
    if (undoDepth(state) !== typing.depth || state.doc.sliceString(from, from + typing.base.length) !== typing.base) return null;
    return { transactions, state, base };
  }

  /// La battuta che porta la tabella `from`, letta come `parsed`, a `next`;
  /// `null` se sono uguali.
  #changes(state: EditorView["state"], from: number, parsed: ParsedTable, next: TableData): TransactionSpec | null {
    const changes = tableChanges(parsed, next).map((change) => ({
      from: from + change.from,
      to: from + change.to,
      insert: withLineBreaks(state, change.insert),
    }));
    return changes.length === 0 ? null : { changes, userEvent: "input" };
  }

  /// Una battuta nella cella aperta: entra nel testo subito, come ogni
  /// battuta (sessione, bozza, salvataggio), e come un passo della cronologia
  /// che la conferma raccoglie con gli altri della cella (`#write`).
  #draft(next: TableData, selection: GridSelection): boolean {
    const view = this.#view;
    const located = this.locate();
    if (!located || view.state.readOnly) return false;
    // Una tabella cambiata sotto (un altro riquadro, un annulla) o un altro
    // passo in mezzo chiudono la serie: da qui si riparte dalla tabella di
    // adesso, e le battute di prima restano passi a sé.
    const depth = undoDepth(view.state);
    const typing = this.#typing !== null && this.#typing.last === located.parsed.source &&
        depth === this.#typing.depth + this.#typing.steps
      ? this.#typing
      : null;
    const base = typing?.base ?? located.parsed.source;
    const parsedBase = typing ? parseTable(base) : located.parsed;
    if (!parsedBase) return false;
    const changes = tableChangesSince(parsedBase, located.parsed.source, next).map((change) => ({
      from: located.from + change.from,
      to: located.from + change.to,
      insert: withLineBreaks(view.state, change.insert),
    }));
    if (changes.length === 0) return true;
    const spec: TransactionSpec = { changes, userEvent: "input" };
    pending.set(view, { from: located.from, selection, focused: this.grid.hasFocus() });
    view.dispatch(spec);
    if (controllers.get(this.grid.element) === this && this.grid.element.isConnected) pending.delete(view);
    const after = this.locate();
    // Un passo che non si è aggiunto da solo (unito a un altro, il limite
    // della cronologia) non si sa annullare a parte: la serie si ferma qui.
    const steps = (typing?.steps ?? 0) + 1;
    const startDepth = typing?.depth ?? depth;
    this.#typing = after && undoDepth(view.state) === startDepth + steps
      ? { base, last: after.parsed.source, depth: startDepth, steps }
      : null;
    return true;
  }

  /// «Grafico da questa tabella» (T54): il recinto coi valori di adesso, se la
  /// tabella ne ha uno, e se sotto c'è già quello da rigenerare.
  #chartPlan(): { readonly from: number; readonly to: number; readonly insert: string; readonly regenerate: boolean } | null {
    const view = this.#view;
    const located = this.locate();
    if (!located || view.state.readOnly || this.#widget.readOnly) return null;
    const locale = frontmatterLanguage(view.state) ?? resolvedLanguage();
    const date = new Intl.DateTimeFormat(resolvedLanguage(), { dateStyle: "medium" }).format(new Date());
    const fence = tableChart(located.parsed, locale, liveStrings.t("table_chart.note", { date }));
    if (fence === null) return null;
    const doc = view.state.doc;
    // Il grafico di prima sta subito sotto: basta guardare fin dove arriva un
    // recinto ragionevole.
    const after = doc.sliceString(located.to, Math.min(doc.length, located.to + CHART_LOOKAHEAD));
    const existing = generatedChartAfter(after);
    if (existing) {
      return { from: located.to + existing.from, to: located.to + existing.to, insert: fence, regenerate: true };
    }
    // Sotto la tabella, con una riga vuota prima e, se il testo continua
    // subito, una dopo. La tabella può finire col suo a capo o subito prima.
    const endsLine = located.to > 0 && doc.sliceString(located.to - 1, located.to) === "\n";
    let lead: string;
    let tail: string;
    if (endsLine) {
      lead = "\n";
      tail = after === "" || /^[ \t]*(?:\n|$)/u.test(after) ? "\n" : "\n\n";
    } else {
      lead = "\n\n";
      tail = /^\n[ \t]*\S/u.test(after) ? "\n" : "";
    }
    return { from: located.to, to: located.to, insert: `${lead}${fence}${tail}`, regenerate: false };
  }

  #chart(): TableChartAction | null {
    const plan = this.#chartPlan();
    if (plan === null) return null;
    return {
      regenerate: plan.regenerate,
      run: () => {
        // Il testo può essere cambiato da quando il menu si è aperto: si
        // rifà il conto su quello di adesso.
        const now = this.#chartPlan();
        if (now === null) {
          notify(liveStrings.t("table_chart.failed"), "info");
          return;
        }
        const view = this.#view;
        view.dispatch({
          changes: { from: now.from, to: now.to, insert: withLineBreaks(view.state, now.insert) },
          userEvent: "input",
          scrollIntoView: true,
        });
        notify(liveStrings.t(now.regenerate ? "table_chart.rewritten" : "table_chart.written"), "info");
      },
    };
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
      else if (writable) view.dispatch({ changes: { from: first.from, insert: view.state.lineBreak }, selection: { anchor: first.from }, userEvent: "input" });
    } else {
      const last = doc.lineAt(located.to);
      if (last.number < doc.lines) view.dispatch({ selection: { anchor: doc.line(last.number + 1).from }, scrollIntoView: true });
      else if (writable) {
        view.dispatch({ changes: { from: doc.length, insert: view.state.lineBreak }, selection: { anchor: doc.length + 1 }, userEvent: "input" });
      }
    }
    view.focus();
  }

  #cellHtml(row: number, col: number): string | null {
    const start = cellContentStart(this.#parsed, row, col);
    if (start === null) return null;
    return this.#widget.block.cells?.get(start) ?? null;
  }

  /// Il clic su ciò che una cella rende, con la regola del testo che si
  /// scrive (`link-gesture.ts`: la cella si scrive, il clic semplice la
  /// sceglie): Mod col clic (Cmd sul Mac) segue un link a una nota come dice
  /// `editor.link-click`, un tag, un indirizzo esterno che il sanificatore
  /// lascia passare; Alt col clic sbircia un link a una nota.
  #activate(event: MouseEvent): boolean {
    const target = event.target instanceof Element ? event.target : null;
    const gesture = textLinkGesture(event);
    if (!target || !gesture) return false;
    const callbacks = this.#widget.callbacks;
    const wiki = target.closest<HTMLElement>("[data-wikilink-page]");
    if (wiki) {
      void followWikilink(
        callbacks,
        wiki.dataset.wikilinkPage ?? "",
        wiki.dataset.wikilinkHeading ?? null,
        wiki.dataset.wikilinkBlock ?? null,
        gesture,
      );
      return true;
    }
    const anchor = target.closest<HTMLAnchorElement>("a[href]");
    const href = anchor?.getAttribute("href") ?? "";
    if (anchor && href !== "" && isAllowedLink(href) && callbacks.openPath) {
      const route = routeHref(href);
      if (route.kind === "path" && route.path !== "") {
        void followPath(callbacks, route.path, gesture);
        return true;
      }
    }
    if (gesture === "peek") return false;
    const tag = target.closest<HTMLElement>(".tag[data-tag]");
    if (tag) {
      callbacks.searchTag(tag.dataset.tag ?? "");
      return true;
    }
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

// La forma della tabella. Gli inchiostri delle testate, la scelta, la cella
// attiva, il quadratino del riempimento e l'angolo di «+» sono della pelle
// (`theme/scrittoio/skin/tabella.css`, issue #242).
const theme = EditorView.baseTheme({
  ".tb-frame": { position: "relative", padding: "0.2em 0 0.4em" },
  ".tb-grid": { position: "relative", overflowX: "auto", outline: "none", padding: "2px" },
  // Bordi separati: solo così la cornice della tabella arrotonda gli angoli.
  ".tb-grid table": { borderCollapse: "separate", borderSpacing: "0", margin: "0" },
  // Le testate a riposo sono trasparenti, non nascoste: la riga delle lettere
  // resta una riga di intestazioni anche per chi legge con la sintesi.
  // Compaiono col fuoco nella tabella, come nel prototipo (`.gr-let`).
  ".tb-grid .tb-corner, .tb-grid .tb-letter, .tb-grid .tb-rowhead": {
    opacity: "0",
    border: "none",
    background: "transparent",
    padding: "0 0.4em",
    fontSize: "0.72em",
    fontWeight: "500",
    textAlign: "center",
    userSelect: "none",
    cursor: "pointer",
  },
  ".tb-grid:focus-within .tb-letter, .tb-grid:focus-within .tb-rowhead, .tb-grid:focus-within .tb-corner": {
    opacity: "1",
  },
  ".tb-grid .tb-letter.is-selected, .tb-grid .tb-rowhead.is-selected": {
    fontWeight: "700",
  },
  ".tb-cell": { position: "relative", minWidth: "4em", cursor: "cell" },
  ".tb-fill": {
    position: "absolute",
    width: "7px",
    height: "7px",
    margin: "-4px 0 0 -4px",
    boxSizing: "border-box",
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
    cursor: "pointer",
  },
  ".tb-frame:hover .tb-add, .tb-frame:focus-within .tb-add": { visibility: "visible" },
  ".tb-add[hidden]": { display: "none" },
});

/// La selezione tutta dentro una tabella montata entra nella sua griglia,
/// sulla cella dove sta: `true` se una tabella l'ha presa.
function enterSelectedGrid(view: EditorView): boolean {
  const main = view.state.selection.main;
  if (view.state.selection.ranges.length > 1) return false;
  for (const controller of mounted(view)) {
    const located = controller.locate();
    if (!located || main.from <= located.from || main.to >= located.to) continue;
    const cell = cellAtOffset(located.parsed, main.head - located.from);
    if (cell) queueMicrotask(() => controller.grid.focus(cell));
    return true;
  }
  return false;
}

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
      if (view.state.selection.ranges.length > 1) return;
      // La griglia di una tabella appena scritta (il «/», la barra) nasce col
      // disegno, che viene dopo i plugin: si cerca anche lì, prima della
      // battuta che segue, perché il testo vada nella cella e non accanto
      // alla tabella.
      if (!enterSelectedGrid(view)) queueMicrotask(() => { if (view.hasFocus) enterSelectedGrid(view); });
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
