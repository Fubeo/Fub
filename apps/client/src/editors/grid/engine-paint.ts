// Il motore della griglia: il disegno (righe, celle, intestazioni, zone
// bloccate), il percorso caldo dello scorrimento. Metodi della classe
// `GridEngine`, montati sul suo prototipo da `engine.ts`
// (`editors/core/mix-methods.ts`).

import type { GridMerge } from "../../host/contract";
import { columnLabel, type GridPosition } from "./model";
import { cellA1, mergeAt, mergesIn, type GridRange } from "./merges";
import { commentDescription } from "./comment-card";
import { rectPieces, type Bands, type MarkPart, type Rect } from "./marks";
import { horizontalOf, iconOf, paintBorders, paintCell, spills } from "./paint";
import { morphChildren, placeInOrder, setAttributeIfChanged, syncAttributes } from "./dom-sync";
import { cellKey } from "./workbook";
import {
  axisLayout,
  commonSize,
  indexAt,
  marginWindow,
  previewSizes,
  samePosition,
  type AxisLayout,
} from "./engine-geometry";
import {
  DEFAULT_ROW_HEIGHT,
  DEFAULT_COLUMN_WIDTH,
  ROW_HEADER_WIDTH,
  COLUMN_HEADER_HEIGHT,
  GRID_FRAME_REFILLS,
  GRID_FRAME_NEW_ROWS,
  GRID_FRAME_BAND,
  MARK_BLEED,
  Drawing,
  PaperView,
  DrawnRow,
  isDataRow,
} from "./engine-parts";
import type { GridEngine } from "./engine";

export const paintMethods = {
  _rebuildLayout(this: GridEngine): void {
    const sheet = this._sheet();
    const view = this._sheetView();
    const zoom = view.zoom / 100;
    // Una misura tirata vale subito, finché il provider non risponde.
    const previews = this._sizePreviews.filter((preview) => preview.sheet === sheet.id);
    this._rows = axisLayout(previewSizes(sheet.rows, "height", previews.filter((preview) => preview.axis === "row")), DEFAULT_ROW_HEIGHT, "height", zoom);
    this._columns = axisLayout(previewSizes(sheet.columns, "width", previews.filter((preview) => preview.axis === "column")), DEFAULT_COLUMN_WIDTH, "width", zoom);
    const frozenRows = Math.min(view.frozen_rows, this._rows.sizes.length);
    const frozenColumns = Math.min(view.frozen_columns, this._columns.sizes.length);
    this._frame = {
      view,
      zoom,
      rowHeader: view.headings ? Math.round(ROW_HEADER_WIDTH * zoom) : 0,
      columnHeader: view.headings ? Math.round(COLUMN_HEADER_HEIGHT * zoom) : 0,
      frozenRows,
      frozenColumns,
      frozenHeight: this._rows.offsets[frozenRows] ?? 0,
      frozenWidth: this._columns.offsets[frozenColumns] ?? 0,
    };
    // La misura del piano e delle fasce ferme, per gli strati di `structure.css`.
    const plane = this._plane.style;
    const bands = this._bands();
    plane.setProperty("--grid-w", `${this._frame.rowHeader + this._columns.total}px`);
    plane.setProperty("--grid-h", `${this._frame.columnHeader + this._rows.total}px`);
    plane.setProperty("--grid-top-h", `${bands.top}px`);
    plane.setProperty("--grid-left-w", `${bands.left}px`);
    // La carta: l'altezza di serie delle righe su cui ripete i fili, e la
    // misura delle intestazioni, per la sua copia nelle fasce ferme.
    this._paperPeriod = commonSize(this._rows, Math.round(DEFAULT_ROW_HEIGHT * zoom));
    this._viewport.style.setProperty("--grid-row", `${this._paperPeriod}px`);
    this._paperPlaced = "";
    plane.setProperty("--grid-head-h", `${this._frame.columnHeader}px`);
    plane.setProperty("--grid-head-w", `${this._frame.rowHeader}px`);
    this._paperTop.hidden = bands.top === 0;
    this._paperLeft.hidden = bands.left === 0;
    (this._paperLeft.firstElementChild as HTMLElement).hidden = this._frame.rowHeader === 0;
    this._paperCorner.hidden = bands.top === 0 || bands.left === 0;
    plane.fontSize = zoom === 1 ? "" : `${(zoom * 100).toFixed(1)}%`;
    this._viewport.classList.toggle("no-gridlines", !view.gridlines);
    this._viewport.setAttribute("aria-rowcount", String(sheet.rows.length + 1));
    this._viewport.setAttribute("aria-colcount", String(sheet.columns.length + 1));
  },

  /// La famiglia di caratteri della griglia, letta una volta.
  _gridFont(this: GridEngine): string {
    this._fallbackFont ??= getComputedStyle(this._viewport).fontFamily ?? "";
    return this._fallbackFont;
  },

  /// Le righe (o le colonne) da disegnare: quelle bloccate, quelle dello
  /// schermo con un riquadro di margine prima e dopo, e quella della cella
  /// che si scrive.
  _renderedIndices(this: GridEngine, layout: AxisLayout, frozen: number, frozenSize: number, scroll: number, extent: number, editing: number | null): number[] {
    const window = marginWindow(layout, scroll + frozenSize, Math.max(0, extent - frozenSize));
    const out: number[] = [];
    for (let index = 0; index < frozen; index += 1) out.push(index);
    for (let index = Math.max(frozen, window.start); index <= window.end; index += 1) out.push(index);
    if (editing !== null && editing >= 0 && editing < layout.sizes.length && !out.includes(editing)) {
      out.push(editing);
      out.sort((left, right) => left - right);
    }
    return out;
  },

  /// La sinistra di una colonna nel piano. Una colonna bloccata la tiene
  /// ferma `sticky`, non lo scorrimento sommato qui.
  _columnLeft(this: GridEngine, column: number): number {
    return this._frame.rowHeader + this._columns.offsets[column];
  },

  /// La misura delle fasce ferme nel piano: l'altezza della testa e la
  /// larghezza della colonna ferma, ognuna col suo filo sull'ultimo pixel.
  _bands(this: GridEngine): Bands {
    const frame = this._frame;
    return { top: frame.columnHeader + frame.frozenHeight, left: frame.rowHeader + frame.frozenWidth };
  },

  /// Quanto una zona è scorsa: le fasce ferme non scorrono nel loro verso.
  _zoneScroll(this: GridEngine, frozenColumn: boolean, frozenRow: boolean): { left: number; top: number } {
    return { left: frozenColumn ? 0 : this._viewport.scrollLeft, top: frozenRow ? 0 : this._viewport.scrollTop };
  },

  /// Mette `element` nel disegno di `container`.
  _draw(this: GridEngine, drawing: Drawing, container: HTMLElement, element: HTMLElement): void {
    const list = drawing.get(container);
    if (list) list.push(element);
    else drawing.set(container, [element]);
  },

  /// Un segno a rettangolo (`box` nel piano): un pezzo per zona che tocca,
  /// tagliato da `marks.ts`, nel livello della sua zona.
  _rectMark(this: GridEngine, drawing: Drawing, className: string, box: { left: number; top: number; width: number; height: number }): void {
    const rect: Rect = { x: box.left, y: box.top, w: box.width, h: box.height };
    for (const piece of rectPieces(rect, this._bands(), { bleed: MARK_BLEED })) {
      const element = document.createElement("div");
      element.className = className;
      element.setAttribute("aria-hidden", "true");
      this._place(element, piece.rect.x, piece.rect.y, piece.rect.w, piece.rect.h);
      this._draw(drawing, this._layers[piece.zone], element);
    }
  },

  /// Il disegno intero: le righe (`rows`), poi i segni, la cella aperta e
  /// ciò che chi legge sente. Il fotogramma chiesto dallo scorrimento, che
  /// le righe le ha già disegnate nel suo gestore, non le rifà.
  ///
  /// `loaded` (una finestra arrivata, `_showView`): le righe con le misure
  /// lette dal gestore dello scorrimento, e la misura delle celle al
  /// fotogramma chiesto.
  _render(this: GridEngine, rows = true, loaded = false): void {
    if (!this._workbook) return;
    const range = this._selectedRange();
    if (rows && loaded) this._renderRows(range, true, this._scrollView, GRID_FRAME_REFILLS, GRID_FRAME_NEW_ROWS);
    else if (rows) this._renderRows(range);
    else if (this._rowsBehind) this._renderRows(range, true, this._scrollView, GRID_FRAME_REFILLS, GRID_FRAME_NEW_ROWS);
    if (loaded) this._scheduleRender();
    else this._fitPending();
    this._settleWritten();
    // I segni, ognuno nel livello della zona dove cade.
    const drawing: Drawing = new Map();
    this._objectElements(drawing);
    this._updateMarks(range);
    this._resizeMarks(drawing);
    this._moveMarks(drawing);
    this._referenceMarks(drawing);
    this._viewport.classList.toggle("filling", this._drag?.kind === "fill");
    this._viewport.classList.toggle("moving", this._drag?.kind === "move");

    // Ciò che non cambia resta: la cella sotto il puntatore riceve il clic e
    // il doppio clic. I pezzi dei segni che restano (`_marks`) non passano di
    // qui, né la cella aperta, che sta in fondo al suo livello «lift» e non
    // perde il fuoco: ciò che si disegna ci va prima.
    const host = this._cellEditorHost;
    for (const container of new Set([...Object.values(this._layers), ...Object.values(this._lifts), this._fixed])) {
      const drawn = [...container.children].filter((element) => !this._marks.owns(element) && element !== host) as HTMLElement[];
      this._reconcile(container, drawn, drawing.get(container) ?? [], host.parentElement === container ? host : null);
    }
    this._fitResizeLabel();
    const editing = this._editing?.owner === "cell" ? this._editing : null;
    if (editing) {
      const cell = this._findCell(editing.position);
      if (cell && this._isVisiblePosition(editing.position)) {
        this._mountCellEditor(editing.position, cell);
        this._positionEditor(editing.position);
      } else {
        this._editing = null;
        this._cellEditorHost.hidden = true;
        this._cellEditorHost.setAttribute("aria-hidden", "true");
        this._editorForReaders(null);
        this._plane.append(this._cellEditorHost);
        this._pendingChanged();
      }
    }
    const active = this._active();
    if (this._isVisiblePosition(active) && this._findCell(active)) {
      setAttributeIfChanged(this._viewport, "aria-activedescendant", this._cellId(active));
    } else {
      this._viewport.removeAttribute("aria-activedescendant");
    }
    const name = this._root.querySelector<HTMLElement>(".grid-cell-name");
    if (name) {
      const label = this._isVisiblePosition(active) ? cellA1(active) : "";
      if (name.textContent !== label) name.textContent = label;
    }
  },

  /// Le righe: quelle bloccate nella testa, le altre nel corpo, con un
  /// riquadro di margine sopra e sotto (e a sinistra e a destra per le
  /// colonne). Le righe che restano non si rifanno: uno scorrimento ne
  /// aggiunge e ne toglie solo ai bordi, un salto (o un altro foglio) le
  /// rifà tutte perché nessuna resta. Una cella cambia solo se cambia ciò che
  /// mostra, e si aggiorna sul posto (`_drawRow`).
  ///
  /// Le misure del riquadro si leggono tutte prima di scrivere, così il
  /// gestore dello scorrimento non obbliga il browser a impaginare a metà.
  /// Le celle da misurare (i numeri, quelle che si stringono) le misura
  /// `_fitPending`: subito, o con `deferFit` nel fotogramma chiesto, prima
  /// che il fotogramma si dipinga.
  _renderRows(this: GridEngine, range: GridRange, deferFit = false, known: PaperView | null = null, refills = Infinity, newRows = Infinity): void {
    const frame = this._frame;
    this._refills = refills;
    this._rowsBehind = false;
    const view = known ?? this._readView();
    const sheet = this._sheet().id;
    if (sheet !== this._drawnSheet) {
      this._drawnSheet = sheet;
      for (const parent of [this._head, this._body]) {
        for (const row of [...parent.children]) if (isDataRow(row)) row.remove();
      }
    }
    const editingPosition = this._editing?.owner === "cell" ? this._editing.position : null;
    const drawnIn = (parent: HTMLElement) => {
      const rows = new Map<number, HTMLElement>();
      for (const element of parent.children) if (isDataRow(element)) rows.set(Number(element.dataset.row), element);
      return rows;
    };
    const drawnHead = drawnIn(this._head);
    const drawnBody = drawnIn(this._body);
    const renderedRows = this._drawableRows(
      this._renderedIndices(
        this._rows, frame.frozenRows, frame.frozenHeight, view.scrollTop,
        view.height - frame.columnHeader, editingPosition?.row ?? null,
      ),
      view,
      (row) => drawnHead.has(row) || drawnBody.has(row) || row === editingPosition?.row,
      newRows,
    );
    const renderedColumns = this._renderedIndices(
      this._columns, frame.frozenColumns, frame.frozenWidth, view.scrollLeft,
      view.width - frame.rowHeader, editingPosition?.column ?? null,
    );
    const merges = this._merges();
    const firstRow = renderedRows[0] ?? 0;
    const lastRow = renderedRows[renderedRows.length - 1] ?? -1;
    const firstColumn = renderedColumns[0] ?? 0;
    const lastColumn = renderedColumns[renderedColumns.length - 1] ?? -1;
    // Le unioni sullo schermo: ognuna si disegna una volta, nella prima riga
    // disegnata che copre, e le celle che copre non si disegnano.
    const visibleMerges = mergesIn(merges, { rowStart: firstRow, rowEnd: lastRow, columnStart: firstColumn, columnEnd: lastColumn });
    const covered = new Set<number>();
    const anchorsByRow = new Map<number, GridMerge[]>();
    for (const merge of visibleMerges) {
      for (let row = Math.max(merge.row, firstRow); row <= Math.min(merge.row + merge.rows - 1, lastRow); row += 1) {
        for (let column = Math.max(merge.column, firstColumn); column <= Math.min(merge.column + merge.columns - 1, lastColumn); column += 1) {
          covered.add(cellKey({ row, column }));
        }
      }
      const host = renderedRows.find((row) => row >= merge.row && this._rows.sizes[row] > 0);
      if (host !== undefined && host < merge.row + merge.rows) {
        anchorsByRow.set(host, [...(anchorsByRow.get(host) ?? []), merge]);
      }
    }
    const measures: HTMLElement[] = [];
    const headRows: HTMLElement[] = [];
    const bodyRows: HTMLElement[] = [];
    for (const row of renderedRows) {
      if (this._rows.sizes[row] === 0) continue;
      const frozen = row < frame.frozenRows;
      const before = (frozen ? drawnHead : drawnBody).get(row);
      const element = this._drawRow(row, before, renderedColumns, covered, anchorsByRow.get(row) ?? [], range, measures);
      (frozen ? headRows : bodyRows).push(element);
    }

    // La riga delle intestazioni di colonna: ogni intestazione resta per
    // colonna e si aggiorna sul posto (una freccia cambia solo `selected`).
    const headerRow = [...this._head.children].find((element): element is HTMLElement =>
      element instanceof HTMLElement && element.classList.contains("grid-column-header-row")) ?? null;
    let header: HTMLElement | null = null;
    if (frame.columnHeader > 0) {
      const fresh = this._columnHeaders(renderedColumns, range);
      if (headerRow) {
        syncAttributes(headerRow, fresh);
        this._keepHeaders(headerRow, fresh);
        header = headerRow;
      } else {
        fresh.prepend(this._corner);
        header = fresh;
      }
    } else {
      headerRow?.remove();
    }
    const head = header ? [header, ...headRows] : headRows;
    // Le righe della testa stanno dopo la sua carta e prima dei suoi livelli.
    placeInOrder(this._head, head, this._layers.top, (element) => element.classList.contains("grid-row"));
    placeInOrder(this._body, bodyRows, null, (element) => element.classList.contains("grid-row"));
    // Un gruppo di righe vuoto non è un gruppo, per chi legge.
    // Solo quando cambia: a ogni passo dello scorrimento conta ogni scrittura.
    for (const [group, rows] of [[this._head, head], [this._body, bodyRows]] as const) {
      if (rows.length) setAttributeIfChanged(group, "role", "rowgroup");
      else group.removeAttribute("role");
    }
    this._placePaper(view);
    this._paperColumns(renderedColumns);
    this._pendingFits.push(...measures);
    if (!deferFit) this._fitPending();
    if (this._rowsBehind) this._scheduleRender();
  },

  /// Delle righe del margine (`rows`), quelle da disegnare in questo giro:
  /// le bloccate, quelle del riquadro e della fascia attorno a lui, quelle
  /// già disegnate (`kept`) e al più `budget` altre, le più vicine al
  /// riquadro prima. Se ne restano fuori, il disegno resta indietro
  /// (`_rowsBehind`) e le aggiunge il fotogramma dopo.
  _drawableRows(this: GridEngine, rows: readonly number[], view: PaperView, kept: (row: number) => boolean, budget: number): number[] {
    if (budget === Infinity) return [...rows];
    const frame = this._frame;
    const extent = Math.max(0, view.height - frame.columnHeader - frame.frozenHeight);
    const band = Math.round(extent * GRID_FRAME_BAND);
    const top = view.scrollTop + frame.frozenHeight;
    const first = indexAt(this._rows, Math.max(0, top - band));
    const last = indexAt(this._rows, top + extent + band);
    const distance = (row: number) => (row < first ? first - row : row - last);
    const waiting = rows.filter((row) => row >= frame.frozenRows && (row < first || row > last) && !kept(row));
    const chosen = new Set(waiting.sort((left, right) => distance(left) - distance(right)).slice(0, Math.max(0, budget)));
    if (chosen.size < waiting.length) this._rowsBehind = true;
    return rows.filter((row) => row < frame.frozenRows || (row >= first && row <= last) || kept(row) || chosen.has(row));
  },

  /// Le misure del riquadro, lette tutte insieme.
  _readView(this: GridEngine): PaperView {
    return {
      scrollTop: this._viewport.scrollTop,
      scrollLeft: this._viewport.scrollLeft,
      width: this._viewport.clientWidth,
      height: this._viewport.clientHeight,
    };
  },

  /// Misura le celle disegnate che aspettano (`_renderRows`): leggere la loro
  /// larghezza impagina, e nel gestore dello scorrimento lo fa il fotogramma.
  _fitPending(this: GridEngine): void {
    const cells = this._pendingFits.filter((cell) => cell.isConnected);
    this._pendingFits = [];
    if (cells.length) this._fitCells(cells);
  },

  /// La riga `row`: quella già disegnata (`before`) aggiornata, o una nuova.
  /// L'intestazione si rifà sul posto se cambia; ogni cella resta se la sua
  /// firma non cambia, e prende soltanto la selezione; se cambia, si rifà
  /// sul posto, nello stesso elemento; quelle uscite dal margine si tolgono.
  _drawRow(
    this: GridEngine,
    row: number,
    before: HTMLElement | undefined,
    columns: readonly number[],
    covered: ReadonlySet<number>,
    anchors: readonly GridMerge[],
    range: GridRange,
    measures: HTMLElement[],
  ): HTMLElement {
    const frame = this._frame;
    const frozen = row < frame.frozenRows;
    const known = before ? this._drawnRows.get(before) : undefined;
    const element = known ? before! : document.createElement("div");
    const state: DrawnRow = known ?? { place: "", header: null, headerKey: "", cells: new Map() };
    if (!known) {
      this._drawnRows.set(element, state);
      element.setAttribute("role", "row");
    }
    const className = frozen ? "grid-row frozen" : "grid-row";
    if (element.className !== className) element.className = className;
    if (element.dataset.row !== String(row)) element.dataset.row = String(row);
    if (element.getAttribute("aria-rowindex") !== String(row + 2)) element.setAttribute("aria-rowindex", String(row + 2));
    // Una riga bloccata sta nella testa, che è ferma da sé; le altre nel
    // corpo, che scorre. Tutte e due al loro posto nel piano.
    const top = frame.columnHeader + this._rows.offsets[row];
    const width = frame.rowHeader + this._columns.total;
    const place = `${top}|${width}|${this._rows.sizes[row]}`;
    if (state.place !== place) {
      this._place(element, 0, top, width, this._rows.sizes[row]);
      state.place = place;
    }

    const children: HTMLElement[] = [];
    if (frame.rowHeader > 0) {
      const selected = [range, ...this._others].some((area) => row >= area.rowStart && row <= area.rowEnd);
      const afterHidden = row > 0 && this._rows.sizes[row - 1] === 0;
      const headerKey = `${selected}|${afterHidden}|${frame.rowHeader}|${this._rows.sizes[row]}|${frame.zoom}`;
      if (!state.header || state.headerKey !== headerKey) {
        const header = document.createElement("div");
        header.className = "grid-header grid-row-header";
        if (selected) header.classList.add("selected");
        if (afterHidden) header.classList.add("after-hidden");
        header.setAttribute("role", "rowheader");
        header.setAttribute("aria-rowindex", String(row + 2));
        header.setAttribute("aria-colindex", "1");
        header.textContent = String(row + 1);
        header.style.pointerEvents = "none";
        if (frame.zoom !== 1) header.style.fontSize = `calc(var(--text-sm) * ${frame.zoom})`;
        this._stickLeft(header, 0, 0, frame.rowHeader, this._rows.sizes[row]);
        if (state.header) syncAttributes(state.header, header);
        else state.header = header;
        state.headerKey = headerKey;
      }
      children.push(state.header);
    } else if (state.header) {
      state.header.remove();
      state.header = null;
      state.headerKey = "";
    }

    const seen = new Set<string>();
    const borders: HTMLElement[] = [];
    const active = this._active();
    const visit = (position: GridPosition, merge: GridMerge | null, slot: string) => {
      const signed = this._cellSignature(position, merge, row);
      if (signed === null) return;
      const { place, signature } = signed;
      let drawn = state.cells.get(slot);
      // Una cella che resta dov'era e cambia soltanto ciò che mostra può
      // aspettare il fotogramma dopo, se questo disegno ha finito i suoi
      // rifacimenti (`_refills`): la si lascia com'è, e il disegno resta
      // indietro (`_rowsBehind`).
      if (drawn && drawn.signature !== signature && drawn.place === place && this._refills <= 0) {
        this._rowsBehind = true;
      } else if (!drawn || drawn.signature !== signature) {
        if (drawn) this._refills -= 1;
        const fresh = this._cellElement(position, merge, row);
        if (!fresh) return;
        if (!drawn) {
          drawn = { cell: fresh.cell, border: fresh.border, place, signature, html: null, base: fresh.cell.className };
          state.cells.set(slot, drawn);
          if (fresh.measure) measures.push(fresh.cell);
        } else {
          // La cella nuova com'è, prima di ogni selezione e misura: se è
          // uguale a quella disegnata, la disegnata resta com'è. Una cella
          // senza HTML (mai confrontata) si rifà: il risultato è lo stesso.
          const html = fresh.cell.outerHTML;
          if (drawn.html !== html) {
            this._refillCell(drawn.cell, fresh.cell);
            if (fresh.measure) measures.push(drawn.cell);
          }
          if (fresh.border && drawn.border) {
            syncAttributes(drawn.border, fresh.border);
          } else {
            drawn.border?.remove();
            drawn.border = fresh.border;
          }
          drawn.place = place;
          drawn.signature = signature;
          drawn.html = html;
          drawn.base = fresh.cell.className;
        }
      }
      seen.add(slot);
      const lastRow = merge ? merge.row + merge.rows - 1 : position.row;
      const lastColumn = merge ? merge.column + merge.columns - 1 : position.column;
      const selected = this._inSelection(range, position.row, position.column, lastRow, lastColumn);
      const classes = `${drawn.base}${selected ? " selected" : ""}${samePosition(position, active) ? " active" : ""}`;
      if (drawn.cell.className !== classes) drawn.cell.className = classes;
      if (drawn.cell.getAttribute("aria-selected") !== String(selected)) drawn.cell.setAttribute("aria-selected", String(selected));
      children.push(drawn.cell);
      if (drawn.border) borders.push(drawn.border);
    };
    for (const column of columns) {
      if (this._columns.sizes[column] === 0 || covered.has(cellKey({ row, column }))) continue;
      visit({ row, column }, null, String(column));
    }
    for (const merge of anchors) visit({ row: merge.row, column: merge.column }, merge, `merge:${merge.row}:${merge.column}`);
    for (const [slot, drawn] of state.cells) {
      if (seen.has(slot)) continue;
      drawn.cell.remove();
      drawn.border?.remove();
      state.cells.delete(slot);
    }
    // Prima l'intestazione e le celle, poi i bordi del file, sopra le celle.
    children.push(...borders);
    placeInOrder(element, children, null, () => true);
    return element;
  },

  /// Rifà sul posto la cella `target` com'è `fresh`: gli attributi e il
  /// contenuto, nello stesso elemento, così il clic e il doppio clic che ci
  /// stanno sopra arrivano. La cella aperta non ci sta dentro: sta nel
  /// livello «lift» della sua zona.
  _refillCell(this: GridEngine, target: HTMLElement, fresh: HTMLElement): void {
    syncAttributes(target, fresh);
    morphChildren(target, fresh, null);
  },

  /// Ciò che la cella in `position`, disegnata nella riga `hostRow`, mostra:
  /// gli oggetti letti (la cella della finestra, lo stile, la carta) per
  /// identità, e la misura, il posto, il debordare e i bordi di un'unione.
  /// Due firme uguali danno la stessa cella. `place` è la parte della firma
  /// che dice dove sta e quanto è grande. `null` se la cella non ha misura
  /// (una colonna o una riga nascosta).
  _cellSignature(this: GridEngine, position: GridPosition, merge: GridMerge | null, hostRow: number): { place: string; signature: string } | null {
    const { row, column } = position;
    const lastRow = merge ? merge.row + merge.rows - 1 : row;
    const lastColumn = merge ? merge.column + merge.columns - 1 : column;
    const width = this._columns.offsets[lastColumn + 1] - this._columns.offsets[column];
    const height = this._rows.offsets[lastRow + 1] - this._rows.offsets[row];
    if (width <= 0 || height <= 0) return null;
    const workbookCell = this._workbookCell(position);
    const bytes = workbookCell?.bytes;
    const style = workbookCell?.style;
    const reach = !merge && bytes && spills(style, bytes) ? this._spillReach(position, horizontalOf(style, bytes.value)) : 0;
    // Un'unione prende i bordi di destra e di sotto dalle celle che stanno lì.
    const edges = merge
      ? `${this._refId(this._workbookCell({ row, column: lastColumn })?.style)}:${this._refId(this._workbookCell({ row: lastRow, column })?.style)}`
      : "";
    const place = [
      merge ? `${merge.rows}x${merge.columns}` : "",
      width,
      height,
      this._columnLeft(column),
      this._rows.offsets[row] - this._rows.offsets[hostRow],
      column < this._frame.frozenColumns ? 1 : 0,
    ].join("|");
    const signature = [
      place,
      this._refId(bytes),
      this._refId(style),
      edges,
      reach,
      this._refId(this._paper),
      this._cellEpoch,
    ].join("|");
    return { place, signature };
  },

  /// Il numero di `value` per le firme delle celle: lo stesso oggetto dà lo
  /// stesso numero; niente dà zero.
  _refId(this: GridEngine, value: object | null | undefined): number {
    if (!value) return 0;
    let id = this._refIds.get(value);
    if (id === undefined) {
      id = this._nextRefId;
      this._nextRefId += 1;
      this._refIds.set(value, id);
    }
    return id;
  },

  /// La carta grande quanto il riquadro (non più del foglio, che non deve
  /// crescere per lei), e i suoi fili dove lo scorrimento li porta: la fase
  /// dei fili delle righe dalla prima riga che si vede, i fili delle colonne
  /// spostati di quanto si è scorso di lato. Lo scrive il gestore dello
  /// scorrimento: fra lo scorrimento e lui, dove una riga non c'è ancora, i
  /// fili sono quelli di un fotogramma prima. La carta sta nel flusso del
  /// riquadro, prima del piano: il margine sotto, negativo quanto lei, non le
  /// lascia occupare posto.
  _placePaper(this: GridEngine, view: PaperView): void {
    const frame = this._frame;
    const { scrollTop, scrollLeft } = view;
    const width = Math.max(0, Math.min(view.width, frame.rowHeader + this._columns.total));
    const height = Math.max(0, Math.min(view.height, frame.columnHeader + this._rows.total));
    const period = this._paperPeriod;
    const top = this._rows.sizes.length ? this._rows.offsets[indexAt(this._rows, scrollTop)] : 0;
    const phase = (((frame.columnHeader + top - scrollTop) % period) + period) % period;
    const placed = `${width}|${height}|${phase}|${scrollLeft}|${this._bands().left}`;
    if (placed === this._paperPlaced) return;
    this._paperPlaced = placed;
    const paper = this._sheetPaper.style;
    const write = (style: CSSStyleDeclaration, property: "width" | "height" | "marginBottom" | "backgroundPositionY", value: string) => {
      if (style[property] !== value) style[property] = value;
    };
    write(paper, "width", `${width}px`);
    write(paper, "height", `${height}px`);
    write(paper, "marginBottom", `${-height}px`);
    write(this._paperLeft.style, "width", `${Math.min(width, this._bands().left)}px`);
    write(this._paperLeft.style, "height", `${height}px`);
    for (const strip of this._paperStrips) write(strip.style, "backgroundPositionY", `${phase}px`);
    const shift = scrollLeft ? `translateX(${-scrollLeft}px)` : "";
    if (this._paperRulesHost.style.transform !== shift) this._paperRulesHost.style.transform = shift;
  },

  /// I fili delle colonne della carta, uno per colonna disegnata, sull'ultimo
  /// pixel della colonna: quelli delle colonne bloccate nella carta della
  /// colonna ferma, gli altri nella carta del corpo. Restano quelli che
  /// c'erano; si aggiungono e si tolgono ai bordi, come le celle.
  _paperColumns(this: GridEngine, columns: readonly number[]): void {
    const frame = this._frame;
    const wanted = new Set<number>();
    for (const column of columns) {
      if (this._columns.sizes[column] === 0) continue;
      wanted.add(column);
      const parent = column < frame.frozenColumns ? this._paperLeft : this._paperRulesHost;
      const left = frame.rowHeader + this._columns.offsets[column + 1] - 1;
      let rule = this._paperRules.get(column);
      if (rule && rule.element.parentElement !== parent) {
        rule.element.remove();
        rule = undefined;
      }
      if (!rule) {
        const element = document.createElement("div");
        element.className = "grid-rule-column";
        rule = { element, left: Number.NaN };
        this._paperRules.set(column, rule);
        parent.append(element);
      }
      if (rule.left !== left) {
        rule.element.style.left = `${left}px`;
        rule.left = left;
      }
    }
    for (const [column, rule] of this._paperRules) {
      if (wanted.has(column)) continue;
      rule.element.remove();
      this._paperRules.delete(column);
    }
  },

  /// Mette in `parent` gli elementi `fresh`, nell'ordine, al posto dei
  /// `drawn`. Un elemento disegnato uguale a quello nuovo, confrontato per
  /// intero, resta dov'è. Gli oggetti si rifanno sempre. Le righe di celle
  /// hanno il loro disegno (`_drawRow`); qui passano i segni e le
  /// intestazioni di colonna.
  _reconcile(this: GridEngine, parent: HTMLElement, drawn: readonly HTMLElement[], fresh: readonly HTMLElement[], end: ChildNode | null = null): void {
    const key = (element: HTMLElement): string | null =>
      element.classList.contains("grid-object") ? null : `html:${element.outerHTML}`;
    const old = new Map<string, HTMLElement>();
    for (const element of drawn) {
      const name = key(element);
      if (name !== null && !old.has(name)) old.set(name, element);
    }
    const kept = new Set<HTMLElement>();
    const placed = fresh.map((element) => {
      const name = key(element);
      const before = name === null ? undefined : old.get(name);
      if (!before) return element;
      old.delete(name!);
      kept.add(before);
      return before;
    });
    for (const element of drawn) if (!kept.has(element)) element.remove();
    // Dal fondo: un elemento già al suo posto non si muove.
    let next: ChildNode | null = end;
    for (let index = placed.length - 1; index >= 0; index -= 1) {
      const element = placed[index];
      if (element.parentNode !== parent || element.nextSibling !== next) parent.insertBefore(element, next);
      next = element;
    }
  },

  /// Porta la riga delle intestazioni `row` a essere come `fresh`: l'angolo
  /// in testa, poi un'intestazione per colonna, ritrovata per colonna e
  /// aggiornata sul posto. Entra solo la colonna che entra nel margine, ed
  /// esce solo quella che ne esce.
  _keepHeaders(this: GridEngine, row: HTMLElement, fresh: HTMLElement): void {
    const old = new Map<string, HTMLElement>();
    for (const child of row.children) {
      const column = child.getAttribute("aria-colindex");
      if (child !== this._corner && column !== null && child instanceof HTMLElement) old.set(column, child);
    }
    const placed: HTMLElement[] = [this._corner];
    for (const element of [...fresh.children] as HTMLElement[]) {
      const column = element.getAttribute("aria-colindex") ?? "";
      const before = old.get(column);
      if (!before) {
        placed.push(element);
        continue;
      }
      old.delete(column);
      syncAttributes(before, element);
      if (before.textContent !== element.textContent) before.textContent = element.textContent;
      placed.push(before);
    }
    const keep = new Set<Element>(placed);
    for (const child of [...row.children]) if (!keep.has(child)) child.remove();
    // Dal fondo: un'intestazione già al suo posto non si muove.
    let next: ChildNode | null = null;
    for (let index = placed.length - 1; index >= 0; index -= 1) {
      const element = placed[index];
      if (element.parentNode !== row || element.nextSibling !== next) row.insertBefore(element, next);
      next = element;
    }
  },

  /// La riga delle intestazioni di colonna, senza l'angolo: l'angolo è uno
  /// solo e resta dov'è (`_keepHeaders`); qui si aggiorna sul posto.
  _columnHeaders(this: GridEngine, columns: readonly number[], range: GridRange): HTMLElement {
    const frame = this._frame;
    const row = document.createElement("div");
    row.className = "grid-row grid-column-header-row";
    row.setAttribute("role", "row");
    row.setAttribute("aria-rowindex", "1");
    this._place(row, 0, 0, frame.rowHeader + this._columns.total, frame.columnHeader);
    if (this._corner.className !== "grid-corner") this._corner.className = "grid-corner";
    if (this._corner.getAttribute("role") !== "presentation") this._corner.setAttribute("role", "presentation");
    if (this._corner.firstChild) this._corner.textContent = "";
    this._corner.style.pointerEvents = "none";
    this._stickLeft(this._corner, 0, 0, frame.rowHeader, frame.columnHeader);
    for (const column of columns) {
      if (this._columns.sizes[column] === 0) continue;
      const header = document.createElement("div");
      header.className = column < frame.frozenColumns ? "grid-header grid-column-header frozen" : "grid-header grid-column-header";
      if ([range, ...this._others].some((area) => column >= area.columnStart && column <= area.columnEnd)) header.classList.add("selected");
      if (column > 0 && this._columns.sizes[column - 1] === 0) header.classList.add("after-hidden");
      header.setAttribute("role", "columnheader");
      header.setAttribute("aria-rowindex", "1");
      header.setAttribute("aria-colindex", String(column + 2));
      header.textContent = columnLabel(column);
      header.style.pointerEvents = "none";
      if (frame.zoom !== 1) header.style.fontSize = `calc(var(--text-sm) * ${frame.zoom})`;
      if (column < frame.frozenColumns) this._stickLeft(header, this._columnLeft(column), 0, this._columns.sizes[column], frame.columnHeader);
      else this._place(header, this._columnLeft(column), 0, this._columns.sizes[column], frame.columnHeader);
      row.append(header);
    }
    return row;
  },

  /// I fili sotto le righe bloccate e a destra delle colonne bloccate: pezzi
  /// fermi nei livelli della testa, della colonna ferma e dell'angolo, che
  /// stanno fermi con loro.
  _freezeParts(this: GridEngine): MarkPart[] {
    const frame = this._frame;
    const bands = this._bands();
    const width = frame.rowHeader + this._columns.total;
    const height = frame.columnHeader + this._rows.total;
    const out: MarkPart[] = [];
    if (frame.frozenRows > 0 && width > 0) {
      out.push({ name: "freeze-rows", kind: "freeze", dir: "h", rect: { x: 0, y: bands.top - 1, w: width, h: 1 }, zones: ["top", "corner"], band: true, glide: false });
    }
    if (frame.frozenColumns > 0 && height > frame.columnHeader) {
      out.push({ name: "freeze-columns", kind: "freeze", dir: "v", rect: { x: bands.left - 1, y: frame.columnHeader, w: 1, h: height - frame.columnHeader }, zones: ["left", "corner"], band: true, glide: false });
    }
    return out;
  },

  /// L'elemento della cella in `position`, disegnato nella riga `hostRow`
  /// (un'unione può cominciare sopra la prima riga disegnata), con i suoi
  /// bordi. `measure` chiede di misurarla dopo: si stringe, o è un numero
  /// che potrebbe non entrare.
  _cellElement(
    this: GridEngine,
    position: GridPosition,
    merge: GridMerge | null,
    hostRow: number,
  ): { cell: HTMLElement; border: HTMLElement | null; measure: boolean } | null {
    const { row, column } = position;
    const frame = this._frame;
    const workbookCell = this._workbookCell(position);
    const bytes = workbookCell?.bytes;
    const style = workbookCell?.style;
    const lastRow = merge ? merge.row + merge.rows - 1 : row;
    const lastColumn = merge ? merge.column + merge.columns - 1 : column;
    const width = this._columns.offsets[lastColumn + 1] - this._columns.offsets[column];
    const height = this._rows.offsets[lastRow + 1] - this._rows.offsets[row];
    if (width <= 0 || height <= 0) return null;
    const frozenColumn = column < frame.frozenColumns;
    const element = document.createElement("div");
    element.className = frozenColumn ? "grid-cell frozen" : "grid-cell";
    element.dataset.row = String(row);
    element.dataset.column = String(column);
    element.id = this._cellId(position);
    element.setAttribute("role", "gridcell");
    element.setAttribute("aria-rowindex", String(row + 2));
    element.setAttribute("aria-colindex", String(column + 2));
    const owner = this._editorOwner?.position;
    if (owner && owner.row === row && owner.column === column) element.setAttribute("aria-owns", this._cellEditorHost.id);
    if (merge) {
      element.classList.add("merged");
      element.setAttribute("aria-rowspan", String(merge.rows));
      element.setAttribute("aria-colspan", String(merge.columns));
    }
    const text = document.createElement("span");
    text.className = "grid-cell-text";
    text.textContent = workbookCell?.cell.input ?? "";
    paintCell(element, text, style, bytes, this._gridFont(), this._paper);
    if (bytes?.data_bar) {
      const bar = document.createElement("div");
      bar.className = "grid-data-bar";
      bar.setAttribute("aria-hidden", "true");
      bar.style.width = `calc((100% - 4px) * ${bytes.data_bar.fraction})`;
      bar.style.background = bytes.data_bar.gradient
        ? `linear-gradient(to right, ${bytes.data_bar.color}, color-mix(in srgb, ${bytes.data_bar.color} 15%, white))`
        : bytes.data_bar.color;
      element.append(bar);
    }
    if (bytes?.icon) {
      const icon = iconOf(bytes.icon);
      if (icon) {
        const mark = document.createElement("span");
        mark.className = "grid-icon";
        mark.setAttribute("aria-hidden", "true");
        mark.textContent = icon.glyph;
        mark.style.color = icon.color;
        element.append(mark);
        if (horizontalOf(style, bytes.value) === "start") element.style.paddingInlineStart = "calc(0.45rem + 1.3em)";
      }
    }
    element.append(text);
    if (bytes?.comment) {
      // Il thread lo mostra la scheda al passaggio (`comment-card.ts`), e a
      // chi non vede lo dice la cella quando diventa attiva.
      const mark = document.createElement("span");
      mark.className = bytes.comment.threaded ? "grid-comment-mark threaded" : "grid-comment-mark";
      if (bytes.comment.threaded && bytes.comment.resolved) mark.classList.add("resolved");
      mark.setAttribute("aria-hidden", "true");
      element.append(mark);
      element.dataset.comment = bytes.comment.threaded ? "thread" : "note";
      element.setAttribute("aria-description", commentDescription(bytes.comment));
    } else if (bytes?.link) {
      element.title = bytes.link.tooltip ?? bytes.link.target;
    }
    if (bytes?.stale) element.classList.add("stale");
    if (bytes && this._pendingCells.has(bytes)) element.classList.add("pending");
    if (bytes?.conflict) {
      element.classList.add("conflict");
      element.setAttribute("aria-invalid", "true");
    }
    if (bytes?.lock) element.setAttribute("aria-readonly", "true");
    // Un testo che non va a capo passa nelle celle vuote accanto, fino alla
    // prima che ha un valore.
    if (style?.shrink) element.dataset.shrink = "true";
    let measure = Boolean(style?.shrink) || bytes?.value.kind === "number";
    if (!merge && bytes && spills(style, bytes)) {
      const reach = this._spillReach(position, horizontalOf(style, bytes.value));
      if (reach > 0) {
        const align = horizontalOf(style, bytes.value);
        element.classList.add("spill");
        text.style.maxWidth = `calc(${width + reach}px - 0.9rem)`;
        text.style.justifySelf = align === "end" ? "unsafe end" : align === "center" ? "unsafe center" : "start";
        measure = false;
      }
    }
    // Una cella di una colonna bloccata sta ferma a sinistra da sé
    // (`_stickLeft`); le altre scorrono con la riga.
    const top = this._rows.offsets[row] - this._rows.offsets[hostRow];
    const put = frozenColumn
      ? (target: HTMLElement, left: number, y: number, w: number, h: number) => this._stickLeft(target, left, y, w, h)
      : (target: HTMLElement, left: number, y: number, w: number, h: number) => this._place(target, left, y, w, h);
    put(element, this._columnLeft(column), top, width, height);
    let border: HTMLElement | null = null;
    const borders = this._cellBorders(position, lastRow, lastColumn);
    if (borders) {
      border = document.createElement("div");
      border.className = frozenColumn ? "grid-border frozen" : "grid-border";
      border.setAttribute("aria-hidden", "true");
      paintBorders(border, borders);
      put(border, this._columnLeft(column) - 1, top - 1, width + 1, height + 1);
    }
    return { cell: element, border, measure };
  },

  /// Quanti pixel accanto il testo di `position` può prendere: le celle
  /// vuote verso dove si allinea, fino alla prima con un valore, a
  /// un'unione o al bordo delle colonne disegnabili.
  _spillReach(this: GridEngine, position: GridPosition, align: "start" | "center" | "end" | "justify"): number {
    const free = (step: 1 | -1): number => {
      let reach = 0;
      for (let column = position.column + step, seen = 0; column >= 0 && column < this._columns.sizes.length && seen < 64; column += step, seen += 1) {
        if (column < this._frame.frozenColumns !== position.column < this._frame.frozenColumns) break;
        const at = { row: position.row, column };
        if (this._workbookCell(at)?.cell.input || mergeAt(this._merges(), at)) break;
        reach += this._columns.sizes[column];
      }
      return reach;
    };
    switch (align) {
      case "start": return free(1);
      case "end": return free(-1);
      case "center": return 2 * Math.min(free(1), free(-1));
      default: return 0;
    }
  },

  /// Misura le celle che si stringono e i numeri: un testo che si stringe
  /// cala il carattere finché entra, un numero che non entra si mostra con
  /// i cancelletti, come in Excel. Prima si legge tutto, poi si scrive.
  _fitCells(this: GridEngine, cells: readonly HTMLElement[]): void {
    const fits: { text: HTMLElement; shrink: boolean; ratio: number }[] = [];
    // Il margine interno è lo stesso per le celle che non ne hanno uno loro
    // (un rientro o un'icona lo allargano): si legge una volta per quelle.
    let shared: number | null = null;
    for (const cell of cells) {
      const text = cell.querySelector<HTMLElement>(".grid-cell-text");
      if (!text) continue;
      let padding: number;
      if (!cell.style.paddingInlineStart && !cell.style.paddingInlineEnd && shared !== null) {
        padding = shared;
      } else {
        const computed = getComputedStyle(cell);
        padding = (parseFloat(computed.paddingLeft) || 0) + (parseFloat(computed.paddingRight) || 0);
        if (!cell.style.paddingInlineStart && !cell.style.paddingInlineEnd) shared = padding;
      }
      const room = cell.clientWidth - padding;
      const needed = text.scrollWidth;
      if (room > 0 && needed > room) fits.push({ text, shrink: cell.style.whiteSpace !== "pre-wrap" && cell.dataset.shrink === "true", ratio: room / needed });
    }
    for (const { text, shrink, ratio } of fits) {
      if (shrink) {
        text.style.fontSize = `${Math.max(0.3, ratio).toFixed(3)}em`;
      } else {
        const length = text.textContent?.length ?? 0;
        text.textContent = "#".repeat(Math.max(1, Math.floor(length * ratio)));
      }
    }
  },

  /// Un elemento che sta fermo a sinistra dentro la sua riga, a `left` dal
  /// bordo del riquadro: un'intestazione di riga, l'angolo, una cella o
  /// un'intestazione di una colonna bloccata. È nel flusso della riga senza
  /// occuparvi posto (i margini ne annullano la larghezza), con la posizione
  /// naturale all'inizio della riga, e `sticky` lo tiene a `left`: lo fa il
  /// compositore, nello stesso fotogramma dello scorrimento. `top` è dalla
  /// cima della riga (un'unione può cominciare sopra di lei).
  _stickLeft(this: GridEngine, element: HTMLElement, left: number, top: number, width: number, height: number): void {
    const before = Math.min(0, left);
    element.style.position = "sticky";
    element.style.left = `${left}px`;
    element.style.top = "";
    element.style.width = `${width}px`;
    element.style.height = `${height}px`;
    element.style.marginTop = top ? `${top}px` : "";
    element.style.marginLeft = before ? `${before}px` : "";
    element.style.marginRight = `${-(width + before)}px`;
  },

  _place(this: GridEngine, element: HTMLElement, left: number, top: number, width: number, height: number): void {
    element.style.position = "absolute";
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
    element.style.width = `${width}px`;
    element.style.height = `${height}px`;
  },
};
export type PaintMethods = typeof paintMethods;
