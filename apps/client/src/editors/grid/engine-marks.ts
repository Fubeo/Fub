// Il motore della griglia: i segni sopra le celle (selezione, formiche,\n// riferimenti, maniglie). Metodi della\n// classe `GridEngine`, montati sul suo prototipo da `engine.ts`\n// (`editors/core/mix-methods.ts`).

import { t, resolvedLanguage } from "../../i18n/strings";
import { columnLabel } from "./model";
import { mergeAt, rangeA1, type GridRange } from "./merges";
import { fadeOutResizeLabel, selectionMotion, slideLines, SLIDE } from "./grid-motion";
import {
  cornerSeen,
  edgeParts,
  selectionParts,
  type MarkGeometry,
  type MarkPart,
  type SelectionLook,
} from "./marks";
import { WORKBOOK_SCALE } from "./workbook";
import {
  MOVE_SLOP,
  pixelsToChars,
  RESIZE_LABEL_GAP,
  RESIZE_SLOP,
  resizeLabelAt,
  sameRange,
  type AxisLayout,
  type ResizeEdge,
  type SizePreview,
} from "./engine-geometry";
import { PASTE_FROM, FILL_SLOP, Drawing, isDataRow } from "./engine-parts";
import type { GridEngine } from "./engine";

export const marksMethods = {
  /// Se la selezione è la sola cella attiva, o l'unione che la contiene.
  _lone(this: GridEngine, range: GridRange): boolean {
    const active = this._active();
    const merge = mergeAt(this._merges(), active);
    const cell = merge
      ? { rowStart: merge.row, rowEnd: merge.row + merge.rows - 1, columnStart: merge.column, columnEnd: merge.column + merge.columns - 1 }
      : { rowStart: active.row, rowEnd: active.row, columnStart: active.column, columnEnd: active.column };
    return sameRange(range, cell);
  },

  /// I segni della selezione, che restano e scivolano: il rettangolo, la
  /// cella attiva, il velo, le fasce delle intestazioni, il quadratino; e,
  /// fermi, i fili del blocco e gli altri intervalli scelti. Li disegna e li
  /// muove `grid-motion.ts` dai dieci numeri di `_markGeometry`.
  _updateMarks(this: GridEngine, range: GridRange): void {
    const geometry = this._markGeometry(range);
    if (!geometry) {
      this._marks.clear();
      return;
    }
    const sheet = this._sheet().id;
    const glide = !this._marksJump && this._marksSheet === sheet;
    // Le maniglie del tocco sono della selezione su cui sono nate.
    if (this._marksSheet !== sheet) this._grips = false;
    this._marksJump = false;
    this._marksSheet = sheet;
    const motion = selectionMotion(this._selectionSpeed, this._marksSpring);
    this._marksSpring = null;
    const frame = this._frame;
    const clip = this._clipMark(sheet);
    const ants = this._antsMark(sheet);
    const look: SelectionLook = {
      lone: this._lone(range) && !this._others.length,
      // Sul tratteggio di una copia o di un taglio, o sulle formiche, il
      // bordo pieno li coprirebbe.
      edges: !(clip && sameRange(clip.range, range)) && !(ants && sameRange(ants.range, range)),
      // Col dito il riempimento si fa dal menu: il quadratino non c'è.
      handle: this._fillServed() && !this._touchLast,
      grips: this._grips,
      header: { width: frame.rowHeader, height: frame.columnHeader },
    };
    const still: MarkPart[] = [...this._freezeParts()];
    const outline = (area: GridRange) => {
      const box = this._rangeBox(area);
      return box ? { L: box.left, T: box.top, R: box.left + box.width, B: box.top + box.height } : null;
    };
    const clipBox = clip ? outline(clip.range) : null;
    if (clip && clipBox) still.push(...edgeParts("clip", clip.kind, clipBox, 2, { glide: false, fade: true }));
    const antsBox = ants ? outline(ants.range) : null;
    if (antsBox) still.push(...edgeParts("ants", "ants", antsBox, 2, { glide: false, fade: true }));
    this._others.forEach((area, index) => {
      const box = this._rangeBox(area);
      if (!box) return;
      const edges = { L: box.left, T: box.top, R: box.left + box.width, B: box.top + box.height };
      still.push(...edgeParts(`other-${index}`, "edge", edges, 2, { glide: false }));
      still.push({ name: `other-${index}-veil`, kind: "veil", rect: { x: box.left, y: box.top, w: box.width, h: box.height }, glide: false });
    });
    this._marks.update({
      geometry,
      parts: (shown) => selectionParts(shown, look),
      still,
      fill: this._drag?.kind === "fill",
      glide,
      walk: ants?.walk ?? false,
      spring: motion.spring,
      snap: motion.snap,
    });
  },

  /// Il tratteggio di ciò che si è copiato (largo) o tagliato (fitto) sul
  /// foglio `sheet`, o `null`.
  _clipMark(this: GridEngine, sheet: string): { readonly kind: "copy" | "cut"; readonly range: GridRange } | null {
    const cut = this._cutMark;
    if (cut) return cut.sheet === sheet ? { kind: "cut", range: cut.range } : null;
    const copy = this._copyMark;
    return copy && copy.sheet === sheet ? { kind: "copy", range: copy.range } : null;
  },

  /// Le formiche sul foglio `sheet`: ferme attorno al riempimento che si
  /// tira, in cammino attorno al gesto che aspetta il foglio; o `null`.
  _antsMark(this: GridEngine, sheet: string): { readonly range: GridRange; readonly walk: boolean } | null {
    const drag = this._drag?.kind === "fill" ? this._drag : null;
    if (drag && !sameRange(drag.source, drag.target)) return { range: drag.target, walk: false };
    const wait = this._waiting;
    return wait && wait.sheet === sheet ? { range: wait.range, walk: true } : null;
  },

  /// I dieci numeri dei segni (`MarkGeometry`): il rettangolo di `range`, la
  /// cella attiva (con la sua unione) e l'angolo del quadratino, che mentre
  /// si tira il riempimento sta su quello del riempimento. `null` se il
  /// rettangolo o la cella attiva non hanno misura (righe o colonne
  /// nascoste).
  _markGeometry(this: GridEngine, range: GridRange): MarkGeometry | null {
    const active = this._active();
    const merge = mergeAt(this._merges(), active);
    const cell: GridRange = merge
      ? { rowStart: merge.row, rowEnd: merge.row + merge.rows - 1, columnStart: merge.column, columnEnd: merge.column + merge.columns - 1 }
      : { rowStart: active.row, rowEnd: active.row, columnStart: active.column, columnEnd: active.column };
    const box = this._rangeBox(range);
    const own = this._rangeBox(cell);
    if (!box || !own) return null;
    const drag = this._drag?.kind === "fill" ? this._drag : null;
    const fill = (drag ? this._rangeBox(drag.target) : null) ?? box;
    return [
      box.left, box.top, box.left + box.width, box.top + box.height,
      own.left, own.top, own.left + own.width, own.top + own.height,
      fill.left + fill.width, fill.top + fill.height,
    ];
  },

  /// Se il punto (dello schermo) prende il quadratino: dove si vede il suo
  /// angolo, entro `FILL_SLOP` px, anche sulla metà che una fascia ferma
  /// copre, e mai quando l'angolo è passato sotto la fascia. Decide questa
  /// prova, non il bersaglio del DOM, che sul filo dipende da chi copre chi.
  _onFillHandle(this: GridEngine, x: number, y: number): boolean {
    // Dopo un dito il quadratino non si mostra, e non si prende.
    if (!this._fillServed() || this._touchLast) return false;
    const box = this._rangeBox(this._selectedRange());
    if (!box) return false;
    const seen = cornerSeen(box.left + box.width, box.top + box.height, false, this._bands(), {
      left: this._viewport.scrollLeft,
      top: this._viewport.scrollTop,
    });
    if (!seen) return false;
    const rect = this._viewport.getBoundingClientRect();
    const px = x - rect.left - this._viewport.clientLeft;
    const py = y - rect.top - this._viewport.clientTop;
    return Math.abs(px - (seen.x - 1)) <= FILL_SLOP && Math.abs(py - (seen.y - 1)) <= FILL_SLOP;
  },

  /// Mentre si tira il bordo di un'intestazione: la guida dove cadrà e la
  /// misura, nelle unità di Excel e in pixel del file. Stanno nel livello
  /// fermo nell'angolo del riquadro, nelle sue coordinate.
  _resizeMarks(this: GridEngine, drawing: Drawing): void {
    const resize = this._resize;
    if (!resize) return;
    const frame = this._frame;
    const guide = document.createElement("div");
    guide.className = "grid-resize-guide";
    guide.setAttribute("aria-hidden", "true");
    const label = document.createElement("div");
    label.className = "grid-resize-label";
    label.setAttribute("aria-hidden", "true");
    const pixels = Math.round(resize.now / (WORKBOOK_SCALE * frame.zoom));
    const number = (value: number) => new Intl.NumberFormat(resolvedLanguage(), { maximumFractionDigits: 2 }).format(value);
    // Nel riquadro: una colonna o una riga bloccata non è scorsa. La misura
    // sta dentro il riquadro, dalla parte del bordo dove c'è posto (griglia
    // T5): la sua misura è quella dell'ultimo disegno, e `_fitResizeLabel`
    // la corregge appena l'etichetta c'è.
    label.style.position = "absolute";
    if (resize.axis === "column") {
      const x = this._columnLeft(resize.index) + resize.now - this._zoneScroll(resize.index < frame.frozenColumns, true).left;
      this._place(guide, x - 1, 0, 2, this._viewport.clientHeight);
      label.textContent = t("grid.resize.width", { chars: number(pixelsToChars(pixels)), px: String(pixels) });
      label.dataset.edge = String(x);
      label.style.left = `${resizeLabelAt(x, this._resizeLabelSize, this._viewport.clientWidth)}px`;
      label.style.top = `${frame.columnHeader + RESIZE_LABEL_GAP}px`;
    } else {
      const y = frame.columnHeader + this._rows.offsets[resize.index] + resize.now - this._zoneScroll(true, resize.index < frame.frozenRows).top;
      this._place(guide, 0, y - 1, this._viewport.clientWidth, 2);
      label.textContent = t("grid.resize.height", { points: number(pixels * 0.75), px: String(pixels) });
      label.dataset.edge = String(y);
      label.style.left = `${frame.rowHeader + RESIZE_LABEL_GAP}px`;
      label.style.top = `${resizeLabelAt(y, this._resizeLabelSize, this._viewport.clientHeight)}px`;
    }
    this._draw(drawing, this._fixed, guide);
    this._draw(drawing, this._fixed, label);
  },

  /// L'etichetta della misura disegnata, con la sua misura vera nel verso del
  /// bordo: se non è quella con cui `_resizeMarks` l'ha messa, la rimette
  /// dentro il riquadro.
  _fitResizeLabel(this: GridEngine): void {
    const resize = this._resize;
    if (!resize) return;
    const label = this._fixed.querySelector<HTMLElement>(".grid-resize-label");
    if (!label?.dataset.edge) return;
    const column = resize.axis === "column";
    const size = column ? label.offsetWidth : label.offsetHeight;
    if (size === this._resizeLabelSize) return;
    this._resizeLabelSize = size;
    const at = `${resizeLabelAt(Number(label.dataset.edge), size, column ? this._viewport.clientWidth : this._viewport.clientHeight)}px`;
    if (column) label.style.left = at;
    else label.style.top = at;
  },

  /// Il bordo fra due intestazioni sotto il punto, se si può misurare: un
  /// bordo è preso a `RESIZE_SLOP` pixel, e senza il comando servito non c'è.
  _resizeEdge(this: GridEngine, x: number, y: number): ResizeEdge | null {
    if (!this.commandable() || this._editing || this._selectedObject !== null) return null;
    const frame = this._frame;
    const rect = this._viewport.getBoundingClientRect();
    const px = x - rect.left - this._viewport.clientLeft;
    const py = y - rect.top - this._viewport.clientTop;
    const nearest = (point: number, header: number, frozen: number, scroll: number, layout: AxisLayout): number | null => {
      const inside = point - header;
      const offset = inside < frozen ? inside : inside + scroll;
      let best: number | null = null;
      let distance = RESIZE_SLOP + 1;
      for (let index = 0; index < layout.sizes.length; index += 1) {
        if (layout.sizes[index] === 0) continue;
        const gap = Math.abs(layout.offsets[index + 1] - offset);
        if (gap <= distance) {
          best = index;
          distance = gap;
        }
        if (layout.offsets[index] > offset + RESIZE_SLOP) break;
      }
      return best;
    };
    if (py >= 0 && py < frame.columnHeader && px >= frame.rowHeader && px < this._viewport.clientWidth) {
      if (!this._serves("home.columnWidth")) return null;
      const index = nearest(px, frame.rowHeader, frame.frozenWidth, this._viewport.scrollLeft, this._columns);
      return index === null ? null : { axis: "column", index };
    }
    if (px >= 0 && px < frame.rowHeader && py >= frame.columnHeader && py < this._viewport.clientHeight) {
      if (!this._serves("home.rowHeight")) return null;
      const index = nearest(py, frame.columnHeader, frame.frozenHeight, this._viewport.scrollTop, this._rows);
      return index === null ? null : { axis: "row", index };
    }
    return null;
  },

  /// Le linee che una misura tocca, la prima e l'ultima: tutte quelle
  /// scelte intere, se `index` è fra loro, come in Excel; altrimenti `index`
  /// sola.
  _resizeSpan(this: GridEngine, edge: ResizeEdge): readonly [number, number] {
    const range = this._selectedRange();
    const sheet = this._sheet();
    if (edge.axis === "column") {
      const whole = range.rowStart === 0 && range.rowEnd >= sheet.rows.length - 1;
      return whole && edge.index >= range.columnStart && edge.index <= range.columnEnd
        ? [range.columnStart, range.columnEnd]
        : [edge.index, edge.index];
    }
    const whole = range.columnStart === 0 && range.columnEnd >= sheet.columns.length - 1;
    return whole && edge.index >= range.rowStart && edge.index <= range.rowEnd
      ? [range.rowStart, range.rowEnd]
      : [edge.index, edge.index];
  },

  /// Le linee di `_resizeSpan`, in A1 per GridCraft.
  _resizeLines(this: GridEngine, edge: ResizeEdge): string {
    const [a, b] = this._resizeSpan(edge);
    return edge.axis === "column" ? `${columnLabel(a)}:${columnLabel(b)}` : `${a + 1}:${b + 1}`;
  },

  /// Il rilascio di un bordo tirato (griglia T5). La misura nuova vale
  /// subito, come anteprima (`_sizePreviews`), e le linee dopo scivolano al
  /// posto nuovo; il comando va al provider come prima. Quando il provider ha
  /// risposto, e la griglia ha riletto le finestre, l'anteprima esce: se ha
  /// detto sì le misure lette sono già quelle, se ha detto no tornano com'erano
  /// scivolando, e l'avviso dice perché (`_giveNow`).
  _endResize(this: GridEngine, commit: boolean): void {
    const resize = this._resize;
    if (!resize) return;
    this._resize = null;
    const label = this._fixed.querySelector<HTMLElement>(".grid-resize-label");
    if (label) fadeOutResizeLabel(label);
    if (!commit || Math.round(resize.now) === Math.round(resize.size)) {
      this._render();
      return;
    }
    const pixels = Math.round(resize.now / (WORKBOOK_SCALE * this._frame.zoom));
    const lines = this._resizeLines(resize);
    const id = resize.axis === "column" ? "home.columnWidth" : "home.rowHeight";
    const params = JSON.stringify(resize.axis === "column" ? { cols: lines, width: pixels } : { rows: lines, height: pixels });
    const state = this._commands.find((command) => command.id === id);
    if (!this._bytes || !this._allowed(id) || !state?.enabled) {
      // Niente anteprima: `command` dice perché il comando non si dà.
      this._render();
      this.command(id, params);
      return;
    }
    const [first, last] = this._resizeSpan(resize);
    const preview: SizePreview = {
      ticket: ++this._sizeTickets,
      sheet: this._sheet().id,
      axis: resize.axis,
      first,
      last,
      size: pixels * WORKBOOK_SCALE,
    };
    this._slideSizes(resize.axis, first, () => this._sizePreviews.push(preview));
    this._give(id, params, false);
    // La coda del protocollo è in fila: questo passo parte quando il comando
    // ha avuto la sua risposta e le finestre sono rilette.
    this._enqueueProtocol(async () => this._dropSizePreview(preview));
  },

  /// L'anteprima `preview` ha avuto la risposta: esce. Un'anteprima più
  /// nuova sulle stesse linee resta, e vince ancora.
  _dropSizePreview(this: GridEngine, preview: SizePreview): void {
    const index = this._sizePreviews.indexOf(preview);
    if (index < 0 || this._destroyed) return;
    const drop = () => {
      this._sizePreviews.splice(this._sizePreviews.indexOf(preview), 1);
    };
    if (!this._view || preview.sheet !== this._sheet().id) {
      drop();
      return;
    }
    this._slideSizes(preview.axis, preview.first, drop);
  },

  /// Cambia le misure con `mutate` e ridisegna: ciò che sta dopo la linea
  /// `index` scivola dal posto di prima (`slideLines`), e i segni con la
  /// stessa molla.
  _slideSizes(this: GridEngine, axis: "column" | "row", index: number, mutate: () => void): void {
    slideLines(this._linesAfter(axis, index), () => {
      mutate();
      this._marksSpring = SLIDE;
      this._rebuildLayout();
      this._render();
    }, this._life);
  },

  /// I pezzi disegnati che una misura della linea `index` sposta, nelle righe
  /// che si vedono: per una colonna le celle dopo (coi loro bordi), le
  /// intestazioni e i fili della carta; per una riga le righe dopo.
  _linesAfter(this: GridEngine, axis: "column" | "row", index: number): HTMLElement[] {
    const frame = this._frame;
    const top = this._viewport.scrollTop + frame.frozenHeight;
    const bottom = this._viewport.scrollTop + this._viewport.clientHeight - frame.columnHeader;
    const seen = (row: number) => row < frame.frozenRows || (this._rows.offsets[row + 1] > top && this._rows.offsets[row] < bottom);
    const out: HTMLElement[] = [];
    for (const parent of [this._head, this._body]) {
      for (const element of parent.children) {
        if (!isDataRow(element)) continue;
        const row = Number(element.dataset.row);
        if (!seen(row)) continue;
        if (axis === "row") {
          if (row > index) out.push(element);
          continue;
        }
        for (const [slot, drawn] of this._drawnRows.get(element)?.cells ?? []) {
          const column = slot.startsWith("merge:") ? Number(slot.split(":")[2]) : Number(slot);
          if (column <= index) continue;
          out.push(drawn.cell);
          if (drawn.border) out.push(drawn.border);
        }
      }
    }
    if (axis === "column") {
      for (const header of this._head.querySelectorAll<HTMLElement>(".grid-column-header")) {
        if (Number(header.getAttribute("aria-colindex")) - 2 > index) out.push(header);
      }
      for (const [column, rule] of this._paperRules) if (column >= index) out.push(rule.element);
    }
    return out;
  },

  /// Mentre si tira il bordo della selezione: il contorno di dove andrà.
  _moveMarks(this: GridEngine, drawing: Drawing): void {
    const drag = this._drag?.kind === "move" ? this._drag : null;
    if (!drag || sameRange(drag.source, drag.target)) return;
    const box = this._rangeBox(drag.target);
    if (box) this._rectMark(drawing, "grid-move-preview", box);
  },

  /// Se il punto sta sul bordo della selezione, a `MOVE_SLOP` pixel, e la
  /// selezione si può spostare: un intervallo solo, di celle, con
  /// `fub.pasteFrom` servito. L'angolo del quadratino resta al riempimento.
  _onSelectionEdge(this: GridEngine, x: number, y: number): boolean {
    if (!this.commandable() || !this._serves(PASTE_FROM) || this._editing || this._selectedObject !== null || this._others.length) return false;
    const range = this._selectedRange();
    const sheet = this._sheet();
    const whole = (range.rowStart === 0 && range.rowEnd >= sheet.rows.length - 1)
      || (range.columnStart === 0 && range.columnEnd >= sheet.columns.length - 1);
    const box = whole ? null : this._rangeBox(range);
    if (!box) return false;
    // Ogni lato nel riquadro: un lato su una colonna o una riga bloccata non
    // è scorso.
    const frame = this._frame;
    const rect = this._viewport.getBoundingClientRect();
    const originX = rect.left + this._viewport.clientLeft;
    const originY = rect.top + this._viewport.clientTop;
    const scrollStart = this._zoneScroll(range.columnStart < frame.frozenColumns, range.rowStart < frame.frozenRows);
    const scrollEnd = this._zoneScroll(range.columnEnd < frame.frozenColumns, range.rowEnd < frame.frozenRows);
    const left = originX + box.left - scrollStart.left;
    const top = originY + box.top - scrollStart.top;
    const right = originX + box.left + box.width - scrollEnd.left;
    const bottom = originY + box.top + box.height - scrollEnd.top;
    const outside = x < left - MOVE_SLOP || x > right + MOVE_SLOP || y < top - MOVE_SLOP || y > bottom + MOVE_SLOP;
    const inside = x > left + MOVE_SLOP && x < right - MOVE_SLOP && y > top + MOVE_SLOP && y < bottom - MOVE_SLOP;
    const handle = this._fillServed() && x >= right - 6 && y >= bottom - 6;
    return !outside && !inside && !handle;
  },

  /// Lo spostamento (o con `copy` la copia) di `source` in `target`, con
  /// `fub.pasteFrom`; dopo, la selezione è dove si è lasciato.
  _moveRange(this: GridEngine, source: GridRange, target: GridRange, copy: boolean): void {
    const sheet = this._sheet().id;
    this._others = [];
    this._selection = {
      anchor: { row: target.rowStart, column: target.columnStart },
      focus: { row: target.rowEnd, column: target.columnEnd },
    };
    this._syncFormulaBar();
    this._render();
    this._selectionChanged();
    this.command(PASTE_FROM, JSON.stringify({ source: rangeA1(source), sourceSheet: sheet, move: !copy }));
  },

  /// Il rettangolo di `range` nel piano, come lo disegnano le celle: senza lo
  /// scorrimento, anche sulle righe e le colonne bloccate.
  _rangeBox(this: GridEngine, range: GridRange): { left: number; top: number; width: number; height: number } | null {
    const frame = this._frame;
    const width = (this._columns.offsets[range.columnEnd + 1] ?? 0) - (this._columns.offsets[range.columnStart] ?? 0);
    const height = (this._rows.offsets[range.rowEnd + 1] ?? 0) - (this._rows.offsets[range.rowStart] ?? 0);
    if (!(width > 0 && height > 0)) return null;
    return { left: this._columnLeft(range.columnStart), top: frame.columnHeader + this._rows.offsets[range.rowStart], width, height };
  },
};
export type MarksMethods = typeof marksMethods;
