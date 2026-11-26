// Il motore della griglia: il puntatore e il dito. Metodi della\n// classe `GridEngine`, montati sul suo prototipo da `engine.ts`\n// (`editors/core/mix-methods.ts`).

import { withRange } from "../../tabella/selection";
import { type GridPosition, type GridSelection } from "./model";
import { rangeA1, type GridRange } from "./merges";
import { cornerSeen } from "./marks";
import {
  DRAG_SCROLL_MAX,
  DRAG_SCROLL_MS,
  fillTarget,
  indexAt,
  samePosition,
  sameRange,
  tableRange,
  type AxisLayout,
  type CellDrag,
} from "./engine-geometry";
import { TAP_MOVE, LONG_PRESS_MS, DOUBLE_TAP_MS, GRIP_R, TouchPress } from "./engine-parts";
import type { GridEngine } from "./engine";

export const pointerMethods = {
  _pointerDown(this: GridEngine, event: PointerEvent): void {
    // Solo il tasto principale; un evento senza tasto vale come quello.
    if (event.button > 0) return;
    // Una formula aperta che aspetta un operando prende il riferimento.
    if (this._editing && this._pointerReference(event)) return;
    // La cella aperta si conferma prima di scegliere altro, come in un foglio
    // di calcolo; il disegno che segue tiene la cella sotto il puntatore.
    if (this._editing?.owner === "cell") this._finishEditing(true, "input", false);
    const object = event.target instanceof Element ? event.target.closest<HTMLElement>(".grid-object") : null;
    if (object && this._objectPointerDown(event, object)) return;
    // Col dito trascinare scorre e basta: la griglia sceglie solo al tocco.
    if (event.pointerType === "touch") {
      this._touchDown(event);
      return;
    }
    // Il mouse e la penna fanno ciò che fanno sempre; tolgono le maniglie del
    // tocco e rimettono il quadratino.
    if (this._touchLast || this._grips) {
      this._touchLast = false;
      this._grips = false;
      this._lastTap = null;
      this._render();
    }
    const edge = this._resizeEdge(event.clientX, event.clientY);
    if (edge) {
      event.preventDefault();
      const size = (edge.axis === "column" ? this._columns : this._rows).sizes[edge.index];
      this._resize = { ...edge, from: edge.axis === "column" ? event.clientX : event.clientY, size, now: size };
      this._viewport.setPointerCapture?.(event.pointerId);
      this._viewport.focus();
      this._render();
      return;
    }
    if (this._onSelectionEdge(event.clientX, event.clientY)) {
      const hit = this._hit(event.clientX, event.clientY, true);
      if (hit && hit.row !== null && hit.column !== null) {
        event.preventDefault();
        const source = this._selectedRange();
        // La cella presa dentro la selezione, più vicina al punto.
        const grab = {
          row: Math.min(source.rowEnd, Math.max(source.rowStart, hit.row)) - source.rowStart,
          column: Math.min(source.columnEnd, Math.max(source.columnStart, hit.column)) - source.columnStart,
        };
        this._drag = { kind: "move", source, grab, target: source, x: event.clientX, y: event.clientY };
        this._viewport.setPointerCapture?.(event.pointerId);
        this._viewport.focus();
        this._render();
        return;
      }
    }
    if (this._onFillHandle(event.clientX, event.clientY)) {
      event.preventDefault();
      const source = this._selectedRange();
      this._drag = { kind: "fill", source, target: source, x: event.clientX, y: event.clientY };
      this._viewport.setPointerCapture?.(event.pointerId);
      this._viewport.focus();
      this._render();
      return;
    }
    // Su una cella vale la cella; fuori (le intestazioni non prendono il
    // puntatore) vale il punto.
    const cell = this._eventPosition(event);
    const hit = cell ?? this._hit(event.clientX, event.clientY, false);
    if (!hit) return;
    event.preventDefault();
    if (this._selectedObject !== null) this._selectObject(null);
    const sheet = this._sheet();
    const lastRow = Math.max(0, sheet.rows.length - 1);
    const lastColumn = Math.max(0, sheet.columns.length - 1);
    // Sull'intestazione di una colonna si prende la colonna intera, su quella
    // di una riga la riga, sull'angolo il foglio, come in Excel.
    const kind = hit.row === null && hit.column === null ? "all" : hit.row === null ? "columns" : hit.column === null ? "rows" : "cells";
    // Ctrl+clic (e Ctrl+trascina) aggiunge un intervallo a quelli scelti;
    // Maiuscolo estende l'ultimo; un clic semplice ricomincia.
    const adding = (event.ctrlKey || event.metaKey) && !event.shiftKey && kind !== "all";
    if (adding) this._others = this._rangesOf(withRange(this._others.map(tableRange), tableRange(this._selectedRange())));
    else if (!event.shiftKey && !this._adding) this._others = [];
    if (kind === "all") {
      this._others = [];
      this._selection = {
        anchor: { row: lastRow, column: lastColumn },
        focus: { row: 0, column: 0 },
        active: { row: this._edgeVisible("row", false), column: this._edgeVisible("column", false) },
      };
    } else {
      const position = this._anchorOf({ row: hit.row ?? 0, column: hit.column ?? 0 });
      const anchor = event.shiftKey ? this._selection.anchor : position;
      this._tabStart = null;
      this._drag = { kind, anchor, x: event.clientX, y: event.clientY };
      this._dragSeen = this._viewportAt();
      this._selection = this._dragSelection(kind, anchor, position);
    }
    this._viewport.setPointerCapture?.(event.pointerId);
    this._viewport.focus();
    this._syncFormulaBar();
    this._render();
    this._selectionChanged();
  },

  /// Un dito giù sulla griglia (B4). Sulla presa di una maniglia del tocco
  /// lungo comincia a tirarla; altrove aspetta: alzato entro `TAP_MOVE` è un
  /// tocco (`_tap`), fermo per `LONG_PRESS_MS` un tocco lungo, e oltre
  /// `TAP_MOVE` scorre, col browser, senza scegliere niente. Non chiama
  /// `preventDefault`, che fermerebbe lo scorrimento.
  _touchDown(this: GridEngine, event: PointerEvent): void {
    this._cancelTouch();
    this._touchLast = true;
    const grip = this._gripAt(event.clientX, event.clientY);
    if (grip) {
      event.preventDefault();
      const range = this._selectedRange();
      const fixed = grip === "b"
        ? { row: range.rowStart, column: range.columnStart }
        : { row: range.rowEnd, column: range.columnEnd };
      this._drag = { kind: "handle", fixed, x: event.clientX, y: event.clientY };
      this._dragSeen = this._viewportAt();
      this._viewport.setPointerCapture?.(event.pointerId);
      this._viewport.focus({ preventScroll: true });
      return;
    }
    const cell = this._eventPosition(event);
    const hit = cell ?? this._hit(event.clientX, event.clientY, false);
    if (!hit) return;
    const touch: TouchPress = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, hit, timer: null, long: false };
    touch.timer = setTimeout(() => this._longPress(touch), LONG_PRESS_MS);
    this._touch = touch;
  },

  /// Il tocco lungo su una cella: la sceglie, se non è già nella selezione,
  /// e mette le due maniglie agli angoli della selezione.
  _longPress(this: GridEngine, touch: TouchPress): void {
    if (this._touch !== touch) return;
    touch.timer = null;
    touch.long = true;
    const { row, column } = touch.hit;
    if (row === null || column === null) return;
    const position = this._anchorOf({ row, column });
    const range = this._selectedRange();
    const inside = position.row >= range.rowStart && position.row <= range.rowEnd
      && position.column >= range.columnStart && position.column <= range.columnEnd;
    if (!inside) {
      this._others = [];
      this._tabStart = null;
      this._selection = { anchor: position, focus: position };
      this._syncFormulaBar();
    }
    if (this._selectedObject !== null) this._selectObject(null);
    this._grips = true;
    this._lastTap = null;
    this._viewport.focus({ preventScroll: true });
    this._render();
    if (!inside) this._selectionChanged();
  },

  /// Il dito si alza (`commit`) o il browser se lo prende per scorrere.
  _endTouch(this: GridEngine, event: PointerEvent, commit: boolean): void {
    const touch = this._touch;
    if (!touch || event.pointerId !== touch.pointerId) return;
    this._cancelTouch();
    if (commit && !touch.long) this._tap(touch.hit);
  },

  _cancelTouch(this: GridEngine): void {
    const touch = this._touch;
    if (!touch) return;
    if (touch.timer !== null) clearTimeout(touch.timer);
    touch.timer = null;
    this._touch = null;
  },

  /// Un tocco: sceglie la cella, la colonna, la riga o il foglio, come un
  /// clic, e toglie le maniglie; un secondo tocco sulla stessa cella entro
  /// `DOUBLE_TAP_MS` la apre.
  _tap(this: GridEngine, hit: { readonly row: number | null; readonly column: number | null }): void {
    this._grips = false;
    if (this._selectedObject !== null) this._selectObject(null);
    const sheet = this._sheet();
    const lastRow = Math.max(0, sheet.rows.length - 1);
    const lastColumn = Math.max(0, sheet.columns.length - 1);
    const kind = hit.row === null && hit.column === null ? "all" : hit.row === null ? "columns" : hit.column === null ? "rows" : "cells";
    const position = this._anchorOf({ row: hit.row ?? 0, column: hit.column ?? 0 });
    if (kind === "cells") {
      const now = performance.now();
      const last = this._lastTap;
      if (last && now - last.at < DOUBLE_TAP_MS && samePosition(last.position, position)) {
        this._lastTap = null;
        this._beginEditing("cell", position, undefined, "edit");
        return;
      }
      this._lastTap = { at: now, position };
    } else {
      this._lastTap = null;
    }
    this._others = [];
    this._tabStart = null;
    this._selection = kind === "all"
      ? {
          anchor: { row: lastRow, column: lastColumn },
          focus: { row: 0, column: 0 },
          active: { row: this._edgeVisible("row", false), column: this._edgeVisible("column", false) },
        }
      : this._dragSelection(kind, position, position);
    this._viewport.focus({ preventScroll: true });
    this._syncFormulaBar();
    this._render();
    this._selectionChanged();
  },

  /// La maniglia del tocco sotto il punto (dello schermo): `"a"` all'inizio
  /// della selezione, `"b"` alla fine, o `null`. La presa è un cerchio di
  /// `GRIP_R` attorno al suo angolo, come si vede adesso, anche dove una
  /// fascia ferma copre metà maniglia; non quando l'angolo stesso è passato
  /// sotto la fascia. Le maniglie non prendono il puntatore: decide questa
  /// prova.
  _gripAt(this: GridEngine, x: number, y: number): "a" | "b" | null {
    if (!this._grips) return null;
    const geometry = this._marks.shown() ?? this._markGeometry(this._selectedRange());
    if (!geometry) return null;
    const rect = this._viewport.getBoundingClientRect();
    const px = x - rect.left - this._viewport.clientLeft;
    const py = y - rect.top - this._viewport.clientTop;
    const bands = this._bands();
    const scroll = { left: this._viewport.scrollLeft, top: this._viewport.scrollTop };
    const corners: readonly (readonly ["a" | "b", number, number, boolean])[] = [
      ["b", geometry[2], geometry[3], false],
      ["a", geometry[0], geometry[1], true],
    ];
    for (const [grip, cx, cy, start] of corners) {
      const seen = cornerSeen(cx, cy, start, bands, scroll);
      if (seen && Math.hypot(px - (seen.x - 1), py - (seen.y - 1)) <= GRIP_R) return grip;
    }
    return null;
  },

  /// La cella attiva di una selezione da `anchor` a `focus` tirata con una
  /// maniglia: resta dov'era se ci sta dentro, sennò va al primo angolo.
  _activeWithin(this: GridEngine, anchor: GridPosition, focus: GridPosition): GridPosition {
    const active = this._active();
    const rowStart = Math.min(anchor.row, focus.row);
    const rowEnd = Math.max(anchor.row, focus.row);
    const columnStart = Math.min(anchor.column, focus.column);
    const columnEnd = Math.max(anchor.column, focus.column);
    const inside = active.row >= rowStart && active.row <= rowEnd && active.column >= columnStart && active.column <= columnEnd;
    return inside ? active : { row: rowStart, column: columnStart };
  },

  _pointerMove(this: GridEngine, event: PointerEvent): void {
    const touch = this._touch;
    if (touch && event.pointerId === touch.pointerId) {
      // Oltre `TAP_MOVE` il dito scorre il foglio (lo fa il browser): non è
      // più un tocco. Dopo un tocco lungo il dito non sceglie altro.
      if (!touch.long && Math.hypot(event.clientX - touch.x, event.clientY - touch.y) > TAP_MOVE) this._cancelTouch();
      return;
    }
    if (this._objectGesture) {
      this._objectPointerMove(event, this._objectGesture);
      return;
    }
    const resize = this._resize;
    if (resize) {
      if (event.buttons === 0) {
        this._endResize(false);
        return;
      }
      const point = resize.axis === "column" ? event.clientX : event.clientY;
      // Fino a zero, che nasconde, come in Excel.
      resize.now = Math.max(0, resize.size + point - resize.from);
      this._render();
      return;
    }
    const drag = this._drag;
    if (!drag) {
      const edge = this._resizeEdge(event.clientX, event.clientY);
      this._viewport.classList.toggle("resize-column", edge?.axis === "column");
      this._viewport.classList.toggle("resize-row", edge?.axis === "row");
      const fill = !edge && this._onFillHandle(event.clientX, event.clientY);
      this._viewport.classList.toggle("fill-handle", fill);
      this._viewport.classList.toggle("move-selection", !edge && !fill && this._onSelectionEdge(event.clientX, event.clientY));
      return;
    }
    if (event.buttons === 0) {
      this._endDrag(false, false);
      return;
    }
    drag.x = event.clientX;
    drag.y = event.clientY;
    this._dragTo(drag);
    this._dragScrollIfOutside(drag);
  },

  /// Porta il gesto al punto `drag.x`, `drag.y`: fuori dalla griglia vale il
  /// bordo, perché il gesto continua mentre la griglia scorre.
  _dragTo(this: GridEngine, drag: CellDrag): void {
    const hit = this._hit(drag.x, drag.y, true);
    if (!hit) return;
    this._dragSeen = this._viewportAt();
    const position = { row: hit.row ?? 0, column: hit.column ?? 0 };
    if (drag.kind === "point") {
      const pointing = this._pointing;
      if (!pointing || samePosition(pointing.focus, position)) return;
      this._writeReference({ from: pointing.from, to: pointing.to }, drag.anchor, position);
      return;
    }
    if (drag.kind === "move") {
      const sheet = this._sheet();
      const rows = drag.source.rowEnd - drag.source.rowStart;
      const columns = drag.source.columnEnd - drag.source.columnStart;
      const rowStart = Math.max(0, Math.min(Math.max(0, sheet.rows.length - 1 - rows), position.row - drag.grab.row));
      const columnStart = Math.max(0, Math.min(Math.max(0, sheet.columns.length - 1 - columns), position.column - drag.grab.column));
      const target = { rowStart, columnStart, rowEnd: rowStart + rows, columnEnd: columnStart + columns };
      if (sameRange(target, drag.target)) return;
      drag.target = target;
      this._render();
      return;
    }
    if (drag.kind === "fill") {
      const target = fillTarget(drag.source, position);
      if (sameRange(target, drag.target)) return;
      drag.target = target;
      this._render();
      return;
    }
    if (drag.kind === "handle") {
      if (samePosition(position, this._selection.focus) && samePosition(drag.fixed, this._selection.anchor)) return;
      this._selection = { anchor: drag.fixed, focus: position, active: this._activeWithin(drag.fixed, position) };
      this._syncFormulaBar();
      this._render();
      this._selectionChanged();
      return;
    }
    const next = this._dragSelection(drag.kind, drag.anchor, position);
    if (samePosition(next.focus, this._selection.focus) && samePosition(next.anchor, this._selection.anchor)) return;
    this._selection = next;
    this._syncFormulaBar();
    this._render();
    this._selectionChanged();
  },

  /// La selezione di un gesto da `anchor` a `position`: righe e colonne
  /// intere vanno da un capo all'altro del foglio, con la cella attiva (il
  /// fuoco) sulla prima colonna o sulla prima riga, come in Excel.
  _dragSelection(this: GridEngine, kind: "cells" | "rows" | "columns", anchor: GridPosition, position: GridPosition): GridSelection {
    const sheet = this._sheet();
    const lastRow = Math.max(0, sheet.rows.length - 1);
    const lastColumn = Math.max(0, sheet.columns.length - 1);
    // Righe e colonne intere: la cella attiva è la prima visibile di quella
    // da cui si è partiti.
    if (kind === "rows") {
      return {
        anchor: { row: anchor.row, column: lastColumn },
        focus: { row: position.row, column: 0 },
        active: { row: anchor.row, column: this._edgeVisible("column", false) },
      };
    }
    if (kind === "columns") {
      return {
        anchor: { row: lastRow, column: anchor.column },
        focus: { row: 0, column: position.column },
        active: { row: this._edgeVisible("row", false), column: anchor.column },
      };
    }
    return { anchor, focus: position };
  },

  /// Fuori dal bordo la griglia scorre da sé verso il puntatore, più svelta
  /// quanto più è lontano, finché il gesto finisce o il puntatore rientra.
  _dragScrollIfOutside(this: GridEngine, drag: CellDrag): void {
    const step = this._dragScrollStep(drag);
    if (!step) {
      this._stopDragScroll();
      return;
    }
    if (this._dragScroll !== null) return;
    this._dragScroll = setInterval(() => {
      const current = this._drag;
      const next = current ? this._dragScrollStep(current) : null;
      if (!current || !next) {
        this._stopDragScroll();
        return;
      }
      this._viewport.scrollBy(next.x, next.y);
      this._dragTo(current);
    }, DRAG_SCROLL_MS);
  },

  _dragScrollStep(this: GridEngine, drag: CellDrag): { x: number; y: number } | null {
    const rect = this._viewport.getBoundingClientRect();
    const frame = this._frame;
    const left = rect.left + this._viewport.clientLeft + frame.rowHeader;
    const top = rect.top + this._viewport.clientTop + frame.columnHeader;
    const right = rect.left + this._viewport.clientLeft + this._viewport.clientWidth;
    const bottom = rect.top + this._viewport.clientTop + this._viewport.clientHeight;
    const speed = (distance: number) => Math.min(DRAG_SCROLL_MAX, Math.max(4, Math.round(distance / 2)));
    // Righe intere non scorrono di lato, colonne intere non scorrono in giù.
    const x = drag.kind === "rows" ? 0 : drag.x > right ? speed(drag.x - right) : drag.x < left ? -speed(left - drag.x) : 0;
    const y = drag.kind === "columns" ? 0 : drag.y > bottom ? speed(drag.y - bottom) : drag.y < top ? -speed(top - drag.y) : 0;
    return x === 0 && y === 0 ? null : { x, y };
  },

  _stopDragScroll(this: GridEngine): void {
    if (this._dragScroll === null) return;
    clearInterval(this._dragScroll);
    this._dragScroll = null;
  },

  /// Chiude il gesto. Il riempimento tirato fuori dalla sorgente dà
  /// `edit.autoFill`; con Ctrl tirato, il modo alternato di Excel (un numero
  /// solo conta, una serie si copia).
  ///
  /// Il rilascio in `point` conta come l'ultimo spostamento: la selezione
  /// finisce sulla cella sotto il punto dove il puntatore si è alzato.
  _endDrag(this: GridEngine, commit: boolean, alternate: boolean, point?: { readonly x: number; readonly y: number }): void {
    const drag = this._drag;
    this._stopDragScroll();
    if (!drag) return;
    // Solo se il punto è nuovo, o se sotto il punto fermo è passata un'altra
    // cella: un rilascio dove si è premuto non sposta.
    if (commit && point && (point.x !== drag.x || point.y !== drag.y || this._shiftedUnder(drag))) {
      drag.x = point.x;
      drag.y = point.y;
      this._dragTo(drag);
    }
    this._drag = null;
    this._dragSeen = null;
    if (drag.kind === "move") {
      if (commit && !sameRange(drag.source, drag.target)) this._moveRange(drag.source, drag.target, alternate);
      else this._render();
      return;
    }
    if (drag.kind !== "fill") return;
    if (commit && !sameRange(drag.source, drag.target)) this._autoFill(drag.source, drag.target, alternate);
    else this._render();
  },

  /// Se sotto il punto fermo di una selezione col puntatore sta un'altra
  /// cella da quella che il gesto ha preso: ciò che sta sopra la griglia ha
  /// cambiato misura e l'ha spostata, senza che scorresse. Il riempimento e lo
  /// spostamento non si rifanno: un rilascio dove si è premuto non li avvia.
  _shiftedUnder(this: GridEngine, drag: CellDrag): boolean {
    if (drag.kind !== "cells" && drag.kind !== "rows" && drag.kind !== "columns") return false;
    const seen = this._dragSeen;
    const now = this._viewportAt();
    if (!seen || (seen.left === now.left && seen.top === now.top)) return false;
    const hit = this._hit(drag.x, drag.y, true);
    if (!hit) return false;
    const focus = this._selection.focus;
    if (drag.kind === "rows") return (hit.row ?? 0) !== focus.row;
    if (drag.kind === "columns") return (hit.column ?? 0) !== focus.column;
    // Su un'unione conta l'unione: un clic dentro non sposta il fuoco.
    return !samePosition(this._anchorOf({ row: hit.row ?? 0, column: hit.column ?? 0 }), this._anchorOf(focus));
  },

  _viewportAt(this: GridEngine): { readonly left: number; readonly top: number } {
    const rect = this._viewport.getBoundingClientRect();
    return { left: rect.left, top: rect.top };
  },

  /// Il riempimento tirato fino a `target` (griglia T6): il contorno resta
  /// con le formiche in cammino finché il foglio non risponde (`_beginFill`),
  /// e la selezione resta sulla sorgente; il provider la mette sul
  /// riempimento, la cella attiva al primo angolo, e i segni ci scivolano.
  _autoFill(this: GridEngine, source: GridRange, target: GridRange, alternate: boolean): void {
    const params: Record<string, string> = { source: rangeA1(source), target: rangeA1(target) };
    if (alternate) params.mode = "alternate";
    this.command("edit.autoFill", JSON.stringify(params));
    this._render();
  },

  /// Il doppio clic sul quadratino, come in Excel: riempie in giù fin dove
  /// arriva la colonna accanto (quella a sinistra, o se è vuota quella a
  /// destra), nelle righe che la griglia ha letto.
  _fillToNeighbour(this: GridEngine): void {
    if (!this._fillServed()) return;
    const source = this._selectedRange();
    const filled = (column: number, row: number) => column >= 0 && (this._workbookCell({ row, column })?.cell.input ?? "") !== "";
    const reach = (column: number): number => {
      let row = source.rowEnd;
      while (row + 1 < this._sheet().rows.length && filled(column, row + 1)) row += 1;
      return row;
    };
    const last = Math.max(reach(source.columnStart - 1), reach(source.columnEnd + 1));
    if (last <= source.rowEnd) return;
    this._autoFill(source, { ...source, rowEnd: last }, false);
  },

  /// Se il quadratino di riempimento si può tirare: una sessione a comandi che
  /// serve `edit.autoFill`, nessuna cella aperta, nessun oggetto scelto.
  /// Mentre un riempimento aspetta il foglio, il quadratino non c'è.
  _fillServed(this: GridEngine): boolean {
    const waiting = this._waiting?.kind === "fill" && this._waiting.sheet === this._sheet().id;
    return this.commandable() && this._serves("edit.autoFill") && !this._editing && this._selectedObject === null && !this._others.length && !waiting;
  },

  /// La riga e la colonna sotto il punto `x`, `y` dello schermo; `null` dove
  /// c'è un'intestazione (la riga sull'intestazione delle colonne, la colonna
  /// su quella delle righe). Fuori dalla griglia, o sulle sue barre di
  /// scorrimento, niente; con `clampToGrid` vale il bordo più vicino, e le
  /// intestazioni contano come la prima riga o colonna che si vede.
  _hit(this: GridEngine, x: number, y: number, clampToGrid: boolean): { row: number | null; column: number | null } | null {
    const frame = this._frame;
    const rect = this._viewport.getBoundingClientRect();
    let px = x - rect.left - this._viewport.clientLeft;
    let py = y - rect.top - this._viewport.clientTop;
    const width = this._viewport.clientWidth;
    const height = this._viewport.clientHeight;
    if (clampToGrid) {
      px = Math.min(Math.max(px, frame.rowHeader), width - 1);
      py = Math.min(Math.max(py, frame.columnHeader), height - 1);
    } else if (px < 0 || py < 0 || px >= width || py >= height) {
      return null;
    }
    const axis = (point: number, header: number, frozen: number, scroll: number, layout: AxisLayout): number | null => {
      if (point < header) return null;
      const inside = point - header;
      const offset = inside < frozen ? inside : inside + scroll;
      if (!layout.sizes.length || offset >= layout.total) return clampToGrid ? Math.max(0, layout.sizes.length - 1) : null;
      return indexAt(layout, offset);
    };
    const column = axis(px, frame.rowHeader, frame.frozenWidth, this._viewport.scrollLeft, this._columns);
    const row = axis(py, frame.columnHeader, frame.frozenHeight, this._viewport.scrollTop, this._rows);
    // Oltre l'ultima riga o colonna del foglio non c'è niente da prendere.
    if (!clampToGrid && ((px >= frame.rowHeader && column === null) || (py >= frame.columnHeader && row === null))) return null;
    return { row, column };
  },

  /// La cella sotto il punto `x`, `y`, a partire dall'elemento premuto. Un
  /// testo che deborda (`.spill`) sta sopra le celle vuote accanto, e il
  /// browser gli dà il puntatore anche lì: per lui vale il punto, non la
  /// cella del testo, o il clic sceglierebbe la cella sbagliata (IMP-512).
  _pressedCell(this: GridEngine, element: EventTarget | null, x: number, y: number): GridPosition | null {
    const target = element instanceof Element ? element.closest<HTMLElement>(".grid-cell") : null;
    if (!target) return null;
    // Un evento senza punto (uno sintetico, da tastiera) vale per la cella.
    if (target.classList.contains("spill") && Number.isFinite(x) && Number.isFinite(y)) {
      const hit = this._hit(x, y, false);
      if (hit && hit.row !== null && hit.column !== null) return { row: hit.row, column: hit.column };
    }
    return this._positionOf(target);
  },

  _eventPosition(this: GridEngine, event: MouseEvent): GridPosition | null {
    return this._pressedCell(event.target, event.clientX, event.clientY);
  },
};
export type PointerMethods = typeof pointerMethods;
