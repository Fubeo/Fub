// Il motore della griglia: la selezione, la vista che la segue, la barra
// della formula. Metodi della classe `GridEngine`, montati sul suo prototipo
// da `engine.ts` (`editors/core/mix-methods.ts`).

import { dataEdge } from "../../tabella/navigation";
import { touches } from "../../tabella/selection";
import { normalizedSelection, type GridPosition, type GridSelection } from "./model";
import { expandToMerges, mergeAt, type GridRange } from "./merges";
import { localInput } from "./workbook";
import { clamp, tableRange } from "./engine-geometry";
import type { GridEngine } from "./engine";

export const selectionMethods = {
  _selectionChanged(this: GridEngine): void {
    this._options.onSelectionChange();
    void this._loadCommands();
  },

  _syncFormulaBar(this: GridEngine): void {
    if (!this._workbook) return;
    const bytes = this._workbookCell(this._active())?.bytes;
    this._formulaEditor.setReadOnly(this._readOnly || Boolean(bytes?.lock));
    this._formulaEditor.setDoc(localInput(bytes?.input ?? "", this._decimal));
  },

  /// La selezione da disegnare e da dare ai comandi: con le unioni intere.
  _selectedRange(this: GridEngine): GridRange {
    return expandToMerges(normalizedSelection(this._selection), this._merges());
  },

  /// Gli intervalli della Tabella in quelli della griglia.
  _rangesOf(this: GridEngine, ranges: readonly { r0: number; c0: number; r1: number; c1: number }[]): GridRange[] {
    return ranges.map((range) => ({ rowStart: range.r0, columnStart: range.c0, rowEnd: range.r1, columnEnd: range.c1 }));
  },

  /// Se `position` (o l'unione da lì a `last`) sta in un intervallo scelto.
  _inSelection(this: GridEngine, range: GridRange, row: number, column: number, lastRow = row, lastColumn = column): boolean {
    return [range, ...this._others].some((area) => touches(tableRange(area), row, column, lastRow, lastColumn));
  },

  _select(this: GridEngine, position: GridPosition, extend: boolean): void {
    const clamped = this._clampedPosition(position);
    const merge = mergeAt(this._merges(), clamped);
    const focus = merge && !extend ? { row: merge.row, column: merge.column } : clamped;
    const active = this._selection.active;
    if (!extend && !this._adding) this._others = [];
    this._selection = extend
      ? (active ? { anchor: this._selection.anchor, focus, active } : { anchor: this._selection.anchor, focus })
      : { anchor: focus, focus };
    this._tabStart = null;
    if (!this._editing) this._syncFormulaBar();
    this._ensureVisible(focus);
    this._render();
    this._selectionChanged();
  },

  _clampedPosition(this: GridEngine, position: GridPosition): GridPosition {
    const sheet = this._sheet();
    return {
      row: clamp(position.row, Math.max(0, sheet.rows.length - 1)),
      column: clamp(position.column, Math.max(0, sheet.columns.length - 1)),
    };
  },

  _clampedSelection(this: GridEngine, selection: GridSelection): GridSelection {
    const clamped = {
      anchor: this._clampedPosition(selection.anchor),
      focus: this._clampedPosition(selection.focus),
    };
    return selection.active ? { ...clamped, active: this._clampedPosition(selection.active) } : clamped;
  },

  /// La cella attiva: dove si scrive, che la barra della formula mostra.
  /// Estendere la selezione muove l'altro capo, e la cella attiva resta
  /// all'àncora, come nei fogli di calcolo.
  _active(this: GridEngine): GridPosition {
    return this._selection.active ?? this._selection.anchor;
  },

  _isVisiblePosition(this: GridEngine, position: GridPosition): boolean {
    return this._rows.sizes[position.row] > 0 && this._columns.sizes[position.column] > 0;
  },

  _nearestVisible(this: GridEngine, axis: "row" | "column", from: number): number {
    const sizes = axis === "row" ? this._rows.sizes : this._columns.sizes;
    if (sizes.length === 0) return 0;
    const start = clamp(from, sizes.length - 1);
    if (sizes[start] !== 0) return start;
    for (let distance = 1; distance < sizes.length; distance += 1) {
      if (start + distance < sizes.length && sizes[start + distance] !== 0) return start + distance;
      if (start - distance >= 0 && sizes[start - distance] !== 0) return start - distance;
    }
    return start;
  },

  _visibleSelection(this: GridEngine, selection: GridSelection): GridSelection {
    const visible = (position: GridPosition): GridPosition => ({
      row: this._nearestVisible("row", position.row),
      column: this._nearestVisible("column", position.column),
    });
    const shown = { anchor: visible(selection.anchor), focus: visible(selection.focus) };
    return selection.active ? { ...shown, active: visible(selection.active) } : shown;
  },

  _nextVisible(this: GridEngine, axis: "row" | "column", from: number, step: number): number {
    const sizes = axis === "row" ? this._rows.sizes : this._columns.sizes;
    if (sizes.length === 0 || step === 0) return from;
    const direction = Math.sign(step);
    const target = clamp(from + step, sizes.length - 1);
    for (let index = target; index >= 0 && index < sizes.length; index += direction) {
      if (sizes[index] !== 0) return index;
    }
    for (let index = target - direction; index >= 0 && index < sizes.length; index -= direction) {
      if (sizes[index] !== 0 && (direction > 0 ? index >= from : index <= from)) return index;
    }
    return from;
  },

  _edgeVisible(this: GridEngine, axis: "row" | "column", last: boolean): number {
    const sizes = axis === "row" ? this._rows.sizes : this._columns.sizes;
    for (
      let index = last ? sizes.length - 1 : 0;
      index >= 0 && index < sizes.length;
      index += last ? -1 : 1
    ) {
      if (sizes[index] !== 0) return index;
    }
    return 0;
  },

  /// Un passo del cursore. Da un'unione si parte dal suo bordo, e in
  /// un'unione si arriva nella sua cella in alto a sinistra.
  /// Senza Maiusc si parte dalla cella attiva; con Maiusc si muove l'altro
  /// capo della selezione.
  _move(this: GridEngine, rowStep: number, columnStep: number, extend: boolean): void {
    const focus = extend ? this._selection.focus : this._active();
    const merge = mergeAt(this._merges(), focus);
    const row = merge && rowStep > 0 ? merge.row + merge.rows - 1 : focus.row;
    const column = merge && columnStep > 0 ? merge.column + merge.columns - 1 : focus.column;
    this._select({
      row: rowStep === 0 ? focus.row : this._nextVisible("row", row, rowStep),
      column: columnStep === 0 ? focus.column : this._nextVisible("column", column, columnStep),
    }, extend);
  },

  _filled(this: GridEngine, position: GridPosition): boolean {
    return Boolean(this._workbookCell(position)?.cell.input);
  },

  /// Ctrl+freccia: fino al bordo dei dati, con la regola di ogni tabella
  /// (`dataEdge`); le righe e le colonne nascoste si saltano, e contano le
  /// celle lette.
  _jump(this: GridEngine, rowStep: -1 | 0 | 1, columnStep: -1 | 0 | 1, extend: boolean): void {
    const axis = rowStep ? "row" : "column";
    const step = rowStep || columnStep;
    const from = extend ? this._selection.focus : this._active();
    const at = (index: number): GridPosition => axis === "row"
      ? { row: index, column: from.column }
      : { row: from.row, column: index };
    const start = axis === "row" ? from.row : from.column;
    const index = dataEdge(start, (current) => this._nextVisible(axis, current, step), (current) => this._filled(at(current)));
    if (index === start) return;
    this._select(at(index), extend);
  },

  /// PagSu e PagGiù (con Alt, PagSu e PagGiù di lato): una schermata di
  /// righe vere, con le loro altezze; la vista scorre di tanto quanto la
  /// cella si sposta, così la cella resta allo stesso punto dello schermo.
  _page(this: GridEngine, axis: "row" | "column", step: -1 | 1, extend: boolean): void {
    const layout = axis === "row" ? this._rows : this._columns;
    if (!layout.sizes.length) return;
    const frame = this._frame;
    const extent = axis === "row"
      ? this._viewport.clientHeight - frame.columnHeader - frame.frozenHeight
      : this._viewport.clientWidth - frame.rowHeader - frame.frozenWidth;
    const from = extend ? this._selection.focus : this._active();
    const index = axis === "row" ? from.row : from.column;
    // Le righe intere che una schermata contiene, contate dalla cella verso
    // dove si va: su e giù fanno lo stesso numero di passi.
    let landed = index;
    let used = 0;
    for (;;) {
      const next = this._nextVisible(axis, landed, step);
      if (next === landed) break;
      used += layout.sizes[step > 0 ? landed : next] ?? 0;
      if (used > extent && landed !== index) break;
      landed = next;
    }
    if (landed === index) return;
    const delta = (layout.offsets[landed] ?? 0) - (layout.offsets[index] ?? 0);
    if (axis === "row") this._viewport.scrollTop = Math.max(0, this._viewport.scrollTop + delta);
    else this._viewport.scrollLeft = Math.max(0, this._viewport.scrollLeft + delta);
    this._select(axis === "row" ? { row: landed, column: from.column } : { row: from.row, column: landed }, extend);
  },

  /// Seleziona le righe (o le colonne) intere della selezione.
  _selectWhole(this: GridEngine, axis: "row" | "column"): void {
    const range = this._selectedRange();
    this._others = [];
    this._selection = axis === "row"
      ? {
        anchor: { row: range.rowStart, column: this._edgeVisible("column", false) },
        focus: { row: range.rowEnd, column: this._edgeVisible("column", true) },
      }
      : {
        anchor: { row: this._edgeVisible("row", false), column: range.columnStart },
        focus: { row: this._edgeVisible("row", true), column: range.columnEnd },
      };
    this._render();
    this._selectionChanged();
  },

  /// Passa al foglio visibile accanto: Ctrl+PagGiù e Ctrl+PagSu.
  _stepSheet(this: GridEngine, step: -1 | 1): void {
    const sheets = this._workbook?.sheets ?? [];
    const index = this._sheetIndex + step;
    if (index < 0 || index >= sheets.length) return;
    this._showSheetAt(index);
  },

  _tab(this: GridEngine, step: -1 | 1): boolean {
    const focus = this._selection.focus;
    const column = this._nextVisible("column", focus.column, step);
    if (column !== focus.column) {
      this._select({ row: focus.row, column }, false);
      return true;
    }
    const row = this._nextVisible("row", focus.row, step);
    if (row !== focus.row) {
      this._select({ row, column: this._edgeVisible("column", step < 0) }, false);
      return true;
    }
    return false;
  },

  _selectAll(this: GridEngine): void {
    this._others = [];
    this._selection = {
      anchor: {
        row: this._edgeVisible("row", false),
        column: this._edgeVisible("column", false),
      },
      focus: {
        row: this._edgeVisible("row", true),
        column: this._edgeVisible("column", true),
      },
    };
    this._render();
    this._selectionChanged();
  },

  /// La cella che comanda in `position`: l'angolo dell'unione che la copre.
  _anchorOf(this: GridEngine, position: GridPosition): GridPosition {
    const clamped = this._clampedPosition(position);
    const merge = mergeAt(this._merges(), clamped);
    return merge ? { row: merge.row, column: merge.column } : clamped;
  },

  /// Scorre fino a `position`. Una riga o una colonna bloccata si vede
  /// sempre; le altre devono uscire da sotto quelle bloccate.
  _ensureVisible(this: GridEngine, position: GridPosition): void {
    const frame = this._frame;
    const merge = mergeAt(this._merges(), position);
    const lastRow = merge ? merge.row + merge.rows - 1 : position.row;
    const lastColumn = merge ? merge.column + merge.columns - 1 : position.column;
    if (position.column >= frame.frozenColumns) {
      const before = frame.rowHeader + frame.frozenWidth;
      const left = frame.rowHeader + this._columns.offsets[position.column];
      const right = frame.rowHeader + this._columns.offsets[lastColumn + 1];
      if (left < this._viewport.scrollLeft + before) this._viewport.scrollLeft = Math.max(0, left - before);
      else if (right > this._viewport.scrollLeft + this._viewport.clientWidth) this._viewport.scrollLeft = Math.min(left - before, right - this._viewport.clientWidth);
    }
    if (position.row >= frame.frozenRows) {
      const before = frame.columnHeader + frame.frozenHeight;
      const top = frame.columnHeader + this._rows.offsets[position.row];
      const bottom = frame.columnHeader + this._rows.offsets[lastRow + 1];
      if (top < this._viewport.scrollTop + before) this._viewport.scrollTop = Math.max(0, top - before);
      else if (bottom > this._viewport.scrollTop + this._viewport.clientHeight) this._viewport.scrollTop = Math.min(top - before, bottom - this._viewport.clientHeight);
    }
  },
};
export type SelectionMethods = typeof selectionMethods;
