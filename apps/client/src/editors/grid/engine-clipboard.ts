// Il motore della griglia: copia, taglia e incolla. Metodi della\n// classe `GridEngine`, montati sul suo prototipo da `engine.ts`\n// (`editors/core/mix-methods.ts`).
import type { GridBytesCell } from "../../host/contract";
import { t } from "../../i18n/strings";
import { clipboardData, clipboardRows, cutDestination, pasteTargets, type ClipboardCell } from "../../tabella/clipboard";
import { type GridPosition } from "./model";
import { mergeAt, rangeA1, type GridRange } from "./merges";
import { fileInput } from "./workbook";
import { tableRange } from "./engine-geometry";
import { type CellWrite } from "./engine-host";
import { PASTE_FROM, Copied, Waiting, PastePreview } from "./engine-parts";
import type { GridEngine } from "./engine";

export const clipboardMethods = {
  /// Copia scrive il TSV degli input e una tabella HTML di ciò che si
  /// vede, come i fogli di calcolo; toglie le formiche di un taglio. Attorno
  /// a ciò che si è copiato restano un tratteggio largo e, una volta, un
  /// battito (griglia T6), finché non si incolla, si scrive o si preme Esc.
  _copy(this: GridEngine, event: ClipboardEvent): void {
    if (!this._takeCopy(event)) return;
    const range = this._selectedRange();
    const style = this._copyMarkStyle;
    this._cutMark = null;
    // «Solo il battito»: niente tratteggio da ricordare, e il bordo della
    // selezione resta.
    this._copyMark = style === "pulse" ? null : { sheet: this._sheet().id, range };
    this._render();
    const box = this._rangeBox(range);
    if (box && style !== "dash") this._marks.pulse({ x: box.left, y: box.top, w: box.width, h: box.height });
  },

  /// Mette negli appunti la selezione e la ricorda (`_copied`). Falso se non
  /// si copia niente.
  _takeCopy(this: GridEngine, event: ClipboardEvent): boolean {
    if (!event.clipboardData) return false;
    event.preventDefault();
    // Come in Excel: più intervalli non si copiano insieme.
    if (this._others.length) {
      this._refuse(t("grid.multi.refused"));
      return false;
    }
    const { text, html } = this._clipboard();
    event.clipboardData.setData("text/plain", text);
    event.clipboardData.setData("text/html", html);
    this._copied = { sheet: this._sheet().id, range: this._selectedRange(), text, move: false };
    return true;
  },

  /// Taglia non svuota subito: segna l'intervallo con un tratteggio fitto, e
  /// l'incolla che segue lo sposta. Esc toglie il segno.
  _cut(this: GridEngine, event: ClipboardEvent): void {
    if (this._readOnly || !event.clipboardData) return;
    if (!this._takeCopy(event)) return;
    this._cutMark = { sheet: this._sheet().id, range: this._selectedRange(), text: this._clipboard().text };
    this._copied = { ...this._cutMark, move: true };
    this._copyMark = null;
    this._render();
  },

  _paste(this: GridEngine, event: ClipboardEvent): void {
    if (this._readOnly || !event.clipboardData) return;
    event.preventDefault();
    const text = event.clipboardData.getData("text/plain");
    const copied = this._copied;
    if (copied && copied.text === text && this._pasteFrom(copied)) return;
    const mark = this._cutMark;
    if (mark && mark.text === text && mark.sheet === this._sheet().id) {
      this._pasteCut(mark);
      return;
    }
    this._pasteRows(clipboardRows(text, event.clipboardData.getData("text/html")));
  },

  /// L'incolla di ciò che si è copiato dalla cartella, quando il catalogo
  /// serve `fub.pasteFrom`: dall'angolo della selezione, ripetuto dove la
  /// selezione ne contiene più copie. Un taglio si incolla una volta.
  ///
  /// I valori si vedono subito, come anteprima (`_previewPaste`), e quelli
  /// che il provider rilegge prendono il loro posto; se dice di no, le celle
  /// tornano com'erano e l'avviso dice perché. Un taglio incollato ha le
  /// formiche attorno a ciò che si sposta finché il foglio non risponde.
  _pasteFrom(this: GridEngine, copied: Copied): boolean {
    if (!this.commandable() || !this._serves(PASTE_FROM) || this._others.length) return false;
    const params = { source: rangeA1(copied.range), sourceSheet: copied.sheet, move: copied.move };
    const wait: Waiting | null = copied.move ? { kind: "move", sheet: copied.sheet, range: copied.range, source: null } : null;
    let previews: PastePreview[] = [];
    const given = this._command(PASTE_FROM, JSON.stringify(params), (applied) => {
      if (!applied) this._unshowPaste(previews);
      if (wait) this._settleWait(wait, applied);
    });
    if (!given) return false;
    // Incollare toglie il tratteggio di ciò che si è copiato; ciò che si è
    // copiato resta, e si incolla ancora.
    this._copyMark = null;
    if (copied.move) {
      this._copied = null;
      this._cutMark = null;
      this._waiting = wait;
    }
    previews = this._previewPaste(copied);
    this._render();
    return true;
  },

  /// I valori di `copied` dove l'incolla li scriverà, come anteprima con le
  /// regole delle celle scritte (`_showWritten`): ogni copia che la selezione
  /// contiene, o la sola destinazione di un taglio, che svuota le celle da
  /// cui parte. Una formula resta com'era: i suoi riferimenti li sposta il
  /// provider. Una cella che non si scrive (bloccata, fuori dal foglio, non
  /// letta) non si mostra.
  _previewPaste(this: GridEngine, copied: Copied): PastePreview[] {
    const values = clipboardRows(copied.text, "");
    const block = { rows: values.length, columns: Math.max(0, ...values.map((row) => row.length)) };
    if (!block.rows || !block.columns) return [];
    const selection = tableRange(this._selectedRange());
    const targets = copied.move ? [cutDestination(tableRange(copied.range), selection)] : pasteTargets(selection, block);
    const sheet = this._sheet();
    const writes = new Map<string, { readonly position: GridPosition; readonly after: string }>();
    const put = (position: GridPosition, after: string) => {
      if (position.row >= sheet.rows.length || position.column >= sheet.columns.length) return;
      writes.set(`${position.row}:${position.column}`, { position, after });
    };
    if (copied.move && copied.sheet === sheet.id) {
      for (let row = copied.range.rowStart; row <= copied.range.rowEnd; row += 1) {
        for (let column = copied.range.columnStart; column <= copied.range.columnEnd; column += 1) put({ row, column }, "");
      }
    }
    for (const target of targets) {
      values.forEach((line, rowOffset) => line.forEach((value, columnOffset) => {
        put({ row: target.r0 + rowOffset, column: target.c0 + columnOffset }, fileInput(value, this._decimal));
      }));
    }
    const shown: PastePreview[] = [];
    for (const { position, after } of writes.values()) {
      if (after.startsWith("=") || this._writeRefusal(position)) continue;
      const merge = mergeAt(this._merges(), position);
      if (merge && (merge.row !== position.row || merge.column !== position.column)) continue;
      if ((this._workbookCell(position)?.bytes.input ?? "") === after) continue;
      const preview = this._showWritten(position, after);
      if (preview) shown.push(preview);
    }
    if (shown.length) this._showView(sheet.id, false);
    return shown;
  },

  /// Il provider non ha preso l'incolla: le celle mostrate in anticipo
  /// tornano com'erano, se una lettura non le ha già sostituite.
  _unshowPaste(this: GridEngine, previews: readonly PastePreview[]): void {
    if (this._destroyed || !previews.length) return;
    let restored = false;
    const gone = new Set<GridBytesCell>();
    for (const { window, previous, shown } of previews) {
      if (!window.cells.includes(shown)) continue;
      window.cells = [...window.cells.filter((cell) => cell !== shown), ...(previous ? [previous] : [])];
      this._pendingCells.delete(shown);
      gone.add(shown);
      restored = true;
    }
    // Ciò che torna non è un valore nuovo: niente dissolvenza d'entrata.
    for (const [key, written] of this._written) if (gone.has(written.shown)) this._written.delete(key);
    if (restored && this._workbook) this._showView(this._sheet().id, false);
  },

  _clipboard(this: GridEngine): { readonly text: string; readonly html: string } {
    const range = this._selectedRange();
    const rows: ClipboardCell[][] = [];
    for (let row = range.rowStart; row <= range.rowEnd; row += 1) {
      const cells: ClipboardCell[] = [];
      for (let column = range.columnStart; column <= range.columnEnd; column += 1) {
        const bytes = this._workbookCell({ row, column })?.bytes;
        const input = this._cellAt({ row, column })?.input ?? "";
        cells.push({ input, shown: bytes?.display || input });
      }
      rows.push(cells);
    }
    return clipboardData(rows);
  },

  _pasteTsv(this: GridEngine, text: string): void {
    this._pasteRows(clipboardRows(text, ""));
  },

  /// Incolla dall'angolo in alto a sinistra della selezione. Un valore, o un
  /// blocco che la selezione contiene un numero intero di volte, la riempie.
  /// Dopo, la selezione è ciò che si è scritto.
  _pasteRows(this: GridEngine, values: readonly (readonly string[])[]): void {
    const block = { rows: values.length, columns: Math.max(0, ...values.map((row) => row.length)) };
    const range = this._selectedRange();
    const targets = pasteTargets(
      { r0: range.rowStart, c0: range.columnStart, r1: range.rowEnd, c1: range.columnEnd },
      block,
    );
    if (!targets.length) return;
    const writes = new Map<string, CellWrite>();
    for (const target of targets) {
      values.forEach((row, rowOffset) => row.forEach((value, columnOffset) => {
        const position = { row: target.r0 + rowOffset, column: target.c0 + columnOffset };
        writes.set(`${position.row}:${position.column}`, { position, after: fileInput(value, this._decimal) });
      }));
    }
    const last = targets[targets.length - 1];
    this._writePasted([...writes.values()], { rowStart: targets[0].r0, columnStart: targets[0].c0, rowEnd: last.r1, columnEnd: last.c1 });
  },

  /// L'incolla dopo un taglio: gli input vanno all'angolo della selezione e
  /// le celle tagliate che restano fuori si svuotano, in un passo solo.
  _pasteCut(this: GridEngine, mark: { readonly range: GridRange; readonly text: string }): void {
    const destination = cutDestination(tableRange(mark.range), tableRange(this._selectedRange()));
    const to: GridRange = {
      rowStart: destination.r0,
      columnStart: destination.c0,
      rowEnd: destination.r1,
      columnEnd: destination.c1,
    };
    const inside = (range: GridRange, row: number, column: number) =>
      row >= range.rowStart && row <= range.rowEnd && column >= range.columnStart && column <= range.columnEnd;
    const writes: CellWrite[] = [];
    for (let row = mark.range.rowStart; row <= mark.range.rowEnd; row += 1) {
      for (let column = mark.range.columnStart; column <= mark.range.columnEnd; column += 1) {
        const input = this._cellAt({ row, column })?.input ?? "";
        const moved = { row: row - mark.range.rowStart + to.rowStart, column: column - mark.range.columnStart + to.columnStart };
        if (!inside(to, row, column) && input !== "") writes.push({ position: { row, column }, after: "" });
        writes.push({ position: moved, after: input });
      }
    }
    this._cutMark = null;
    // Le formiche attorno a ciò che si sposta, finché il foglio non ha
    // risposto alla scrittura: il passo dopo nella coda del protocollo.
    const wait: Waiting = { kind: "move", sheet: this._sheet().id, range: mark.range, source: null };
    this._waiting = wait;
    if (!this._writePasted(writes, to)) {
      this._waiting = null;
      this._updateMarks(this._selectedRange());
      return;
    }
    this._enqueueProtocol(async () => this._settleWait(wait, true));
  },

  _writePasted(this: GridEngine, writes: readonly CellWrite[], range: GridRange): boolean {
    const sheet = this._sheet();
    const fits = writes.filter(({ position }) => position.row < sheet.rows.length && position.column < sheet.columns.length);
    if (!this._commitCells(fits, "input", true)) {
      this._render();
      return false;
    }
    const anchor = { row: range.rowStart, column: range.columnStart };
    const focus = this._clampedPosition({ row: range.rowEnd, column: range.columnEnd });
    this._others = [];
    this._selection = { anchor, focus };
    this._syncFormulaBar();
    this._render();
    this._selectionChanged();
    return true;
  },
};
export type ClipboardMethods = typeof clipboardMethods;
