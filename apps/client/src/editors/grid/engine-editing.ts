// Il motore della griglia: la cella in modifica. Metodi della classe
// `GridEngine`, montati sul suo prototipo da `engine.ts`
// (`editors/core/mix-methods.ts`).

import { type EditorChangeOrigin } from "../core/text-operation";
import { t } from "../../i18n/strings";
import { createTextEngine, type TextEngine } from "../text/engine";
import { createFormulaProfile, formulaReferences, operandSlot, type FormulaMove } from "../text/profiles/formula";
import { isMultiCell, nextCell, nextInRange, type Move, type Shape } from "../../tabella/navigation";
import { coordinateAt, type GridPosition } from "./model";
import { mergeAt, parseRangeA1, rangeA1 } from "./merges";
import { hideEditorFrame, showEditorFrame } from "./grid-motion";
import { wholeRect, type Zone } from "./marks";
import { horizontalOf } from "./paint";
import { fileInput, localInput } from "./workbook";
import { mergeCovers, openSpan, samePosition, type OpenSpan } from "./engine-geometry";
import { type CellWrite } from "./engine-host";
import { EditingState, EDITOR_SLACK, EDITOR_PAPER, measureContext, zoneOf, Drawing } from "./engine-parts";
import type { GridEngine } from "./engine";

export const editingMethods = {
  _createCellEditor(this: GridEngine): TextEngine {
    const profile = createFormulaProfile({
      singleLine: false,
      callbacks: {
        commit: (_value, move, arrow) => this._commitAndMove(move, arrow),
        cancel: () => this._finishEditing(false, "input"),
        arrowsCommit: () => this._editing?.mode === "insert",
        toggleMode: () => this._toggleEditMode(),
        point: (move, extend) => this._pointByKey(move, extend),
      },
    });
    const engine = createTextEngine(this._cellEditorField, {
      onChange: (change) => this._draftFromEditor("cell", change.text),
      onSelectionChange: () => {},
      theme: this._cellTheme,
      field: true,
      extensions: () => profile.extensions(),
    });
    if (this._readOnly) engine.setReadOnly(true);
    return engine;
  },

  _detachCellEditor(this: GridEngine): void {
    const host = this._cellEditorHost;
    if (host.parentElement !== this._plane) this._plane.append(host);
    host.classList.remove("wraps");
    delete host.dataset.row;
    delete host.dataset.column;
    this._editorDress = null;
    this._editorNeed = null;
    this._editorHeight = null;
  },

  /// Apre la cella (o la barra della formula) su `position`. Una battuta
  /// (`initial`) apre in «Inserisci», F2 e il doppio clic in «Modifica».
  _beginEditing(
    this: GridEngine,
    owner: "cell" | "formula",
    position: GridPosition,
    initial?: string,
    mode: "insert" | "edit" = initial === undefined ? "edit" : "insert",
  ): void {
    if (this._readOnly || !this._workbook || !this._isVisiblePosition(position)) return;
    const refusal = this._writeRefusal(position);
    if (refusal) {
      this._refuse(refusal);
      return;
    }
    const current = localInput(this._workbookCell(position)?.bytes.input ?? "", this._decimal);
    if (this._editing && (!samePosition(this._editing.position, position) || this._editing.owner !== owner)) {
      this._finishEditing(true, "input", false);
    }
    this._editing = {
      position,
      original: current,
      draft: initial ?? current,
      owner,
      mode,
      theirs: null,
      coordinate: coordinateAt(this._sheet(), position),
    };
    if (owner === "cell") {
      const cell = this._findCell(position);
      if (!cell) {
        this._editing = null;
        return;
      }
      // La cella aperta è la cella: il suo carattere, la sua carta, il testo
      // dove stava. Il resto è subito al suo posto; la cornice compare.
      this._editorDress = null;
      this._mountCellEditor(position, cell);
      this._cellEditor.setDoc(this._editing.draft);
      this._positionEditor(position, true);
      showEditorFrame(this._cellEditorFrame, this._life);
      // La maniglia del riempimento se ne va (`_fillServed`): resterebbe
      // sopra il testo della cella aperta, che ora si allarga oltre l'angolo.
      this._updateMarks(this._selectedRange());
      // Il cursore va in fondo, come nei fogli di calcolo: la battuta che ha
      // aperto la cella è già scritta, e le altre la seguono. Non con
      // `revealByteOffset`: porterebbe la riga del cursore in cima scorrendo
      // anche la griglia, che invece resta dov'è (la cella è già in vista, e
      // la cella aperta sta sopra di lei). Scorre solo il testo nel campo.
      const editor = this._cellEditor;
      if (editor.placeCursor(editor.getDoc().length)) {
        editor.focus();
        const scroller = this._cellEditorField.querySelector<HTMLElement>(".cm-scroller");
        if (scroller && scroller.scrollHeight > scroller.clientHeight) scroller.scrollTop = scroller.scrollHeight;
      } else {
        editor.revealByteOffset(new TextEncoder().encode(this._editing.draft).length);
      }
    } else {
      this._formulaEditor.setDoc(this._editing.draft);
    }
    this._options.onEditMode?.();
    this._pendingChanged();
  },

  /// Un disegno dei segni, uno per fotogramma: lo chiedono lo scorrimento
  /// (le righe le disegna il suo gestore), i riferimenti della formula e un
  /// disegno rimasto indietro (`_rowsBehind`), che ci finisce le sue celle
  /// con le misure lette dal gestore. Dopo, le misure si rileggono.
  _scheduleRender(this: GridEngine): void {
    if (this._renderFrame !== null) return;
    this._renderFrame = requestAnimationFrame(() => {
      this._renderFrame = null;
      if (!this._destroyed) this._render(false);
      this._scrollView = null;
    });
  },

  /// F2 nella cella aperta: «Inserisci» ⇄ «Modifica».
  _toggleEditMode(this: GridEngine): void {
    const editing = this._editing;
    if (editing?.owner !== "cell") return;
    editing.mode = editing.mode === "insert" ? "edit" : "insert";
    this._options.onEditMode?.();
  },

  /// Invio, Tab o una freccia nella cella aperta: conferma e si sposta.
  /// Ctrl+Invio scrive la bozza in tutta la selezione e resta.
  _commitAndMove(this: GridEngine, move: FormulaMove, arrow = false): void {
    const editing = this._editing;
    if (!editing) return;
    if (move === "fill") {
      this._fillDraft(editing);
      return;
    }
    this._finishEditing(true, "input");
    this._advance(move);
    // Soltanto Tab comincia una serie: una freccia la chiude.
    if (arrow) this._tabStart = null;
  },

  /// La bozza in ogni cella visibile della selezione.
  _fillDraft(this: GridEngine, editing: EditingState): void {
    const range = this._selectedRange();
    const inside = editing.position.row >= range.rowStart && editing.position.row <= range.rowEnd
      && editing.position.column >= range.columnStart && editing.position.column <= range.columnEnd;
    if (!inside) {
      this._finishEditing(true, "input");
      return;
    }
    this._finishEditing(false, "input");
    if (!this._rangeRead(range)) {
      this._refuse(t("grid.workbook.not_loaded"));
      return;
    }
    const after = fileInput(editing.draft, this._decimal);
    const writes: CellWrite[] = [];
    for (let row = range.rowStart; row <= range.rowEnd; row += 1) {
      for (let column = range.columnStart; column <= range.columnEnd; column += 1) {
        const position = { row, column };
        if (!this._isVisiblePosition(position)) continue;
        const merge = mergeAt(this._merges(), position);
        if (merge && (merge.row !== row || merge.column !== column)) continue;
        writes.push({ position, after });
      }
    }
    this._commitCells(writes, "input", true);
  },

  /// Sposta la cella attiva di un passo di Invio o di Tab: dentro la
  /// selezione se è più di una cella, altrimenti accanto (Invio torna alla
  /// colonna dove una serie di Tab era cominciata). Falso se oltre non c'è
  /// niente.
  _advance(this: GridEngine, move: Move): boolean {
    const shape: Shape = {
      step: (axis, from, step) => this._nextVisible(axis, from, step),
      visible: (axis, index) => ((axis === "row" ? this._rows.sizes : this._columns.sizes)[index] ?? 0) > 0,
    };
    const range = this._selectedRange();
    const active = this._active();
    const bounds = { r0: range.rowStart, c0: range.columnStart, r1: range.rowEnd, c1: range.columnEnd };
    if (isMultiCell(bounds) && !mergeCovers(this._merges(), range)) {
      const cell = nextInRange(bounds, active, move, shape);
      this._selection = { ...this._selection, active: cell };
      this._ensureVisible(cell);
      this._syncFormulaBar();
      this._render();
      this._selectionChanged();
      return true;
    }
    // Da un'unione si parte dal suo bordo.
    const merge = mergeAt(this._merges(), active);
    const from = merge
      ? {
        row: move === "down" ? merge.row + merge.rows - 1 : active.row,
        column: move === "right" ? merge.column + merge.columns - 1 : active.column,
      }
      : active;
    const step = nextCell(from, move, this._tabStart, shape);
    if (!step) return false;
    this._select(step.cell, false);
    this._tabStart = step.tabStart;
    return true;
  },

  _draftFromEditor(this: GridEngine, owner: "cell" | "formula", draft: string): void {
    const editing = this._editing;
    if (editing?.owner !== owner) return;
    // I contorni dei riferimenti seguono la formula.
    const formula = draft.startsWith("=") || editing.draft.startsWith("=");
    editing.draft = draft;
    this._pendingChanged();
    // La cella aperta si misura a ogni cambio della bozza, senza chiedere
    // niente all'host.
    if (owner === "cell" && !this._cellEditorHost.hidden) this._positionEditor(editing.position, true);
    if (formula) this._scheduleRender();
  },

  /// Il campo della formula aperta.
  _openEditor(this: GridEngine): TextEngine | null {
    const editing = this._editing;
    if (!editing) return null;
    return editing.owner === "cell" ? this._cellEditor : this._formulaEditor;
  },

  /// Dove un riferimento puntato andrebbe adesso: quello appena puntato, se
  /// il cursore è ancora alla sua fine, o un posto dove la formula aspetta un
  /// operando.
  _pointSlot(this: GridEngine): { readonly from: number; readonly to: number } | null {
    const editor = this._openEditor();
    if (!editor) return null;
    const text = editor.getDoc();
    const head = editor.cursorContext().head;
    const pointing = this._pointing;
    if (pointing && pointing.text === text && head === pointing.to) return { from: pointing.from, to: pointing.to };
    this._pointing = null;
    return operandSlot(text, head);
  },

  /// Scrive al posto di `slot` il riferimento da `anchor` a `focus`, con il
  /// cursore dopo, come una battuta.
  _writeReference(this: GridEngine, slot: { readonly from: number; readonly to: number }, anchor: GridPosition, focus: GridPosition): void {
    const editor = this._openEditor();
    if (!editor) return;
    const reference = rangeA1({
      rowStart: Math.min(anchor.row, focus.row),
      rowEnd: Math.max(anchor.row, focus.row),
      columnStart: Math.min(anchor.column, focus.column),
      columnEnd: Math.max(anchor.column, focus.column),
    });
    if (!editor.applyUserEdit(slot.from, slot.to, reference)) return;
    editor.placeCursor(slot.from + reference.length);
    this._pointing = { from: slot.from, to: slot.from + reference.length, text: editor.getDoc(), anchor, focus };
    this._scheduleRender();
  },

  /// Un clic (o l'inizio di un trascinamento) su una cella mentre la formula
  /// aspetta un operando scrive il riferimento, e la cella resta aperta.
  _pointerReference(this: GridEngine, event: PointerEvent): boolean {
    const slot = this._pointSlot();
    if (!slot) return false;
    const hit = this._eventPosition(event) ?? this._hit(event.clientX, event.clientY, false);
    if (!hit || hit.row === null || hit.column === null) return false;
    // Il fuoco resta nel campo della formula.
    event.preventDefault();
    const position = { row: hit.row, column: hit.column };
    this._writeReference(slot, position, position);
    this._drag = { kind: "point", anchor: position, x: event.clientX, y: event.clientY };
    this._viewport.setPointerCapture?.(event.pointerId);
    return true;
  },

  /// Le frecce nel modo «Inserisci» dove la formula aspetta un operando:
  /// muovono il riferimento puntato (dalla cella aperta, la prima volta), e
  /// con Maiuscolo lo allargano.
  _pointByKey(this: GridEngine, move: "down" | "up" | "right" | "left", extend: boolean): boolean {
    const editing = this._editing;
    if (!editing || editing.owner !== "cell") return false;
    const slot = this._pointSlot();
    if (!slot) return false;
    const pointing = this._pointing;
    const focus = this._stepPosition(pointing?.focus ?? editing.position, move);
    this._writeReference(slot, extend && pointing ? pointing.anchor : focus, focus);
    return true;
  },

  /// La cella accanto a `from` verso `move`, oltre righe e colonne nascoste.
  _stepPosition(this: GridEngine, from: GridPosition, move: "down" | "up" | "right" | "left"): GridPosition {
    const rows = move === "down" ? 1 : move === "up" ? -1 : 0;
    const columns = move === "right" ? 1 : move === "left" ? -1 : 0;
    let { row, column } = from;
    do {
      row += rows;
      column += columns;
    } while (
      row >= 0 && column >= 0 && row < this._rows.sizes.length && column < this._columns.sizes.length
      && (this._rows.sizes[row] === 0 || this._columns.sizes[column] === 0)
    );
    return this._clampedPosition({ row, column });
  },

  /// Il contorno di ogni riferimento della formula aperta che sta sul foglio
  /// mostrato, del colore che ha nel testo.
  _referenceMarks(this: GridEngine, drawing: Drawing): void {
    const draft = this._editing?.draft ?? "";
    if (!draft.startsWith("=")) return;
    const name = this._sheet().name.toLowerCase();
    for (const reference of formulaReferences(draft)) {
      const bang = reference.text.lastIndexOf("!");
      if (bang >= 0) {
        const sheet = reference.text.slice(0, bang).replace(/^'(.*)'$/, "$1").replace(/''/g, "'");
        if (sheet.toLowerCase() !== name) continue;
      }
      const range = parseRangeA1(reference.text.slice(bang + 1).toUpperCase());
      const box = range ? this._rangeBox(range) : null;
      if (box) this._rectMark(drawing, `grid-formula-ref grid-formula-ref-${reference.color + 1}`, box);
    }
  },

  _commitAfterBlur(this: GridEngine, owner: "cell" | "formula"): void {
    queueMicrotask(() => {
      if (this._destroyed || this._editing?.owner !== owner) return;
      // Un clic che punta un riferimento può portare via il fuoco: torna al
      // campo della formula, che resta aperto.
      if (this._drag?.kind === "point") {
        this._openEditor()?.focus();
        return;
      }
      const host = owner === "cell" ? this._cellEditorHost : this._formulaHost;
      // Il fuoco è andato altrove di sua volontà: la cella si conferma e il
      // fuoco resta dove è andato.
      if (!host.contains(document.activeElement)) this._finishEditing(true, "input", false);
    });
  },

  _finishEditing(this: GridEngine, commit: boolean, origin: EditorChangeOrigin, restoreFocus = true): void {
    const editing = this._editing;
    if (!editing) return;
    this._editing = null;
    this._pointing = null;
    this._draftNotice.hidden = true;
    // La cornice esce da dov'è (anche a metà della sua entrata); il campo
    // sparisce subito, e la cella sotto ha già il valore.
    if (editing.owner === "cell" && !this._cellEditorHost.hidden) hideEditorFrame(this._cellEditorFrame);
    this._detachCellEditor();
    this._cellEditorHost.hidden = true;
    this._cellEditorHost.setAttribute("aria-hidden", "true");
    this._editorForReaders(null);
    this._options.onEditMode?.();
    if (commit && editing.draft !== editing.original) {
      this._commitCells([{ position: editing.position, after: fileInput(editing.draft, this._decimal) }], origin, true);
    }
    this._pendingChanged();
    this._syncFormulaBar();
    this._render();
    // Il fuoco torna alla griglia, se nel frattempo non si è aperta un'altra
    // cella: le toglierebbe il fuoco, e la confermerebbe.
    if (restoreFocus) queueMicrotask(() => {
      if (!this._destroyed && !this._editing) this._viewport.focus();
    });
  },

  /// La zona del piano della cella aperta: quella della sua cella.
  _editorZone(this: GridEngine, position: GridPosition): Zone {
    return zoneOf(position.column < this._frame.frozenColumns, position.row < this._frame.frozenRows);
  },

  /// Mette la cella aperta in fondo al livello «lift» della zona della sua
  /// cella, la mostra e la veste come la cella. Spostandola, il fuoco resta
  /// nel campo.
  _mountCellEditor(this: GridEngine, position: GridPosition, cell: HTMLElement): void {
    // Il campo prima delle misure: la veste legge il carattere dal suo
    // `.cm-content`.
    const field = this._cellEditor;
    const host = this._cellEditorHost;
    const lift = this._lifts[this._editorZone(position)];
    if (host.parentElement !== lift) {
      const focused = host.contains(document.activeElement);
      lift.append(host);
      if (focused) field.focus();
    }
    host.dataset.row = String(position.row);
    host.dataset.column = String(position.column);
    host.hidden = false;
    host.removeAttribute("aria-hidden");
    this._editorForReaders({ lift, cell, position });
    this._dressEditor(position, cell);
  },

  /// La cella aperta per chi usa un lettore di schermo. I livelli «lift» non
  /// si leggono, salvo quello che porta la cella aperta: un campo col fuoco
  /// dentro un `aria-hidden` sparisce (axe `aria-hidden-focus`); ciò che il
  /// livello porta oltre al campo (i segni d'angolo, gli oggetti) è
  /// `aria-hidden` da sé. E il campo sta nel livello, non nella cella, ma una
  /// griglia contiene solo righe e celle: la cella lo dichiara suo
  /// (`aria-owns`), e chi legge lo trova dov'è la cella. `null` quando la
  /// cella si chiude.
  _editorForReaders(
    this: GridEngine,
    open: { readonly lift: HTMLElement; readonly cell: HTMLElement; readonly position: GridPosition } | null,
  ): void {
    for (const lift of new Set(Object.values(this._lifts))) {
      if (lift === open?.lift) lift.removeAttribute("aria-hidden");
      else lift.setAttribute("aria-hidden", "true");
    }
    const before = this._editorOwner?.cell;
    if (before && before !== open?.cell) before.removeAttribute("aria-owns");
    this._editorOwner = open ? { cell: open.cell, position: open.position } : null;
    open?.cell.setAttribute("aria-owns", this._cellEditorHost.id);
  },

  /// Veste la cella aperta come la cella `cell`: la carta e l'inchiostro del
  /// file, il carattere (`--field-font`, che la pelle dell'editor dà a
  /// `.cm-content`), il peso, la misura, l'allineamento e i margini, così il
  /// testo non si sposta di un pixel. In «Inserisci» il testo parte da
  /// sinistra; in «Modifica» tiene l'allineamento della cella. Si rifà solo
  /// quando la cella o lo stile cambiano: legge le misure.
  _dressEditor(this: GridEngine, position: GridPosition, cell: HTMLElement): void {
    const workbookCell = this._workbookCell(position);
    const horizontal = this._editing?.mode === "insert" || !workbookCell?.bytes
      ? "start"
      : horizontalOf(workbookCell.style, workbookCell.bytes.value);
    const align = horizontal === "center" || horizontal === "end" ? horizontal : "start";
    const key = `${position.row},${position.column}|${align}|${this._frame.zoom}|${cell.style.cssText}`;
    if (this._editorDress?.key === key) return;
    const style = this._cellEditorHost.style;
    for (const name of EDITOR_PAPER) {
      const value = cell.style.getPropertyValue(name);
      if (value) style.setProperty(name, value);
      else style.removeProperty(name);
    }
    style.fontWeight = cell.style.fontWeight;
    style.fontStyle = cell.style.fontStyle;
    style.fontSize = cell.style.fontSize;
    style.textAlign = align;
    style.setProperty("--field-font", cell.style.fontFamily || this._gridFont() || "inherit");
    const computed = getComputedStyle(cell);
    const padLeft = parseFloat(computed.paddingLeft) || 0;
    const padRight = parseFloat(computed.paddingRight) || 0;
    style.setProperty("--field-pad-top", `${Math.max(0, this._textTop(cell, computed))}px`);
    style.setProperty("--field-pad-left", `${padLeft}px`);
    style.setProperty("--field-pad-right", `${padRight}px`);
    const content = this._cellEditorField.querySelector<HTMLElement>(".cm-content");
    const font = content ? getComputedStyle(content) : computed;
    this._editorDress = {
      key,
      font: font.font || `${font.fontStyle} ${font.fontWeight} ${font.fontSize} ${font.fontFamily}`,
      size: parseFloat(font.fontSize) || 13,
      padLeft,
      padRight,
    };
    this._editorNeed = null;
    this._editorHeight = null;
  },

  /// Dove comincia il testo nella cella, dal suo bordo alto: la prima riga
  /// del testo, o, per una cella vuota, dove la riga starebbe secondo
  /// l'allineamento in verticale (`paint.ts`, `alignContent`).
  _textTop(this: GridEngine, cell: HTMLElement, computed: CSSStyleDeclaration): number {
    const text = cell.querySelector<HTMLElement>(".grid-cell-text");
    if (!text) return parseFloat(computed.paddingTop) || 0;
    const box = cell.getBoundingClientRect();
    const at = text.getBoundingClientRect();
    if (at.height > 0) return at.top - box.top;
    const line = parseFloat(computed.lineHeight) || (parseFloat(computed.fontSize) || 13) * 1.3;
    switch (computed.alignContent) {
      case "start": return at.top - box.top;
      case "center": return at.top - box.top - line / 2;
      default: return at.bottom - box.top - line;
    }
  },

  /// La misura del testo della bozza: la riga più larga col carattere della
  /// cella, sulla tela, più i margini; e quante righe.
  _measureEditorText(this: GridEngine): { readonly width: number; readonly lines: number } {
    const dress = this._editorDress;
    const lines = (this._editing?.draft ?? "").split("\n");
    let widest = 0;
    const context = dress ? measureContext() : null;
    if (context && dress) {
      context.font = dress.font;
      for (const line of lines) widest = Math.max(widest, context.measureText(line).width);
    } else {
      // Senza tela (un DOM di prova): una stima larga.
      for (const line of lines) widest = Math.max(widest, line.length * (dress?.size ?? 13) * 0.6);
    }
    return { width: Math.ceil(widest) + (dress?.padLeft ?? 0) + (dress?.padRight ?? 0) + EDITOR_SLACK, lines: lines.length };
  },

  /// L'altezza del testo della cella aperta larga `width`: dalla cima del
  /// campo al fondo dell'ultima riga. Si rilegge quando il testo cambia o la
  /// larghezza è un'altra.
  _editorTextHeight(this: GridEngine, width: number, measure: boolean): number {
    const known = this._editorHeight;
    if (!measure && known?.width === width) return known.height;
    const content = this._cellEditorField.querySelector<HTMLElement>(".cm-content");
    const last = content?.querySelector<HTMLElement>(".cm-line:last-child");
    const height = content && last ? last.getBoundingClientRect().bottom - content.getBoundingClientRect().top : 0;
    this._editorHeight = { width, height };
    return height;
  },

  /// Il posto e la misura della cella aperta (B2): parte dalla cella e cresce
  /// a colonne intere verso dove il testo va (a destra, o a sinistra per una
  /// cella allineata a destra) finché il testo ci sta, fino al bordo del
  /// riquadro; dall'altra parte no, perché il testo resti dov'era. Se non ci
  /// sta va a capo (`wraps`) e cresce in giù a righe intere fino a metà del
  /// riquadro e non oltre il suo fondo, poi il testo scorre dentro. Sta nel
  /// livello della sua zona, che scorre con le celle: una cella di una colonna
  /// bloccata cresce dentro la sua zona e oltre. `measure` rimisura il testo.
  _positionEditor(this: GridEngine, position: GridPosition, measure = false): void {
    const host = this._cellEditorHost;
    const frame = this._frame;
    const rows = this._rows;
    const merge = mergeAt(this._merges(), position);
    const lastRow = merge ? merge.row + merge.rows - 1 : position.row;
    const lastColumn = merge ? merge.column + merge.columns - 1 : position.column;
    if (measure || !this._editorNeed) this._editorNeed = this._measureEditorText();
    const need = this._editorNeed;
    const view = this._readView();
    const bands = this._bands();
    const frozenColumn = position.column < frame.frozenColumns;
    const frozenRow = position.row < frame.frozenRows;
    // I confini delle colonne e delle righe sullo schermo, dall'angolo del
    // riquadro: quelli di una fascia ferma non scorrono.
    const x = (index: number) => this._columnLeft(index) - (frozenColumn && index <= frame.frozenColumns ? 0 : view.scrollLeft);
    const y = (index: number) => frame.columnHeader + rows.offsets[index] - (frozenRow && index <= frame.frozenRows ? 0 : view.scrollTop);
    const across = openSpan(
      x,
      this._columns.sizes.length,
      position.column,
      lastColumn + 1,
      need.width,
      frozenColumn ? frame.rowHeader : bands.left,
      view.width,
      host.style.textAlign === "end" ? ["before"] : ["after"],
    );
    const width = Math.max(0, x(across.end) - x(across.start) - 1);
    const left = this._columnLeft(position.column) - (x(position.column) - x(across.start));
    const wraps = !across.fits;
    host.classList.toggle("wraps", wraps);
    let down: OpenSpan = { start: position.row, end: lastRow + 1, fits: true };
    if (wraps || need.lines > 1) {
      host.style.width = `${width}px`;
      const height = this._editorTextHeight(width, measure);
      const cap = Math.max(rows.offsets[lastRow + 1] - rows.offsets[position.row] - 1, view.height / 2);
      const low = frozenRow ? frame.columnHeader : bands.top;
      down = openSpan(y, rows.sizes.length, position.row, lastRow + 1, height, low, Math.min(view.height, y(position.row) + cap + 1), ["after"]);
    }
    const height = Math.max(0, y(down.end) - y(down.start) - 1);
    const top = frame.columnHeader + rows.offsets[position.row] - (y(position.row) - y(down.start));
    const at = wholeRect(this._editorZone(position), { x: left, y: top, w: width, h: height }, bands);
    this._place(host, at.x, at.y, at.w, at.h);
  },
};
export type EditingMethods = typeof editingMethods;
