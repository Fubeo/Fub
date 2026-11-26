// Il motore della griglia: scrivere nelle celle, gli avvisi, la bozza. Metodi
// della classe `GridEngine`, montati sul suo prototipo da `engine.ts`
// (`editors/core/mix-methods.ts`).

import type { GridBytesCell, GridCellPatch as GridRequestPatch } from "../../host/contract";
import { type EditorChangeOrigin } from "../core/text-operation";
import {
  gridJournalEntry,
  gridJournalText,
  parseGridJournal,
  recordGridJournal,
  type GridJournal,
} from "../../state/grid-journal";
import { t, plural, resolvedLanguage } from "../../i18n/strings";
import { writeClipboardText } from "../../platform/clipboard";
import { coordinateAt, normalizedSelection, positionOf, type GridPosition } from "./model";
import { type GridCellPatch } from "./operation";
import { cellA1 } from "./merges";
import { fadeInValue } from "./grid-motion";
import { keyPosition, localInput, writtenValue } from "./workbook";
import { samePosition } from "./engine-geometry";
import { type CellWrite } from "./engine-host";
import {
  GRID_WINDOW_ROWS,
  GRID_WINDOW_COLUMNS,
  NOT_SHOWN_KEYS,
  SET_VALUES,
  PastePreview,
  LOCK_KEYS,
  PLAIN_STYLE,
  isCircular,
  EditingState,
  ShownWindow,
  shownWindows,
  changedElsewhere,
  joinNotices,
} from "./engine-parts";
import type { GridEngine } from "./engine";

export const writeMethods = {
  /// Ogni cella dell'intervallo è in una finestra letta: le finestre si
  /// chiedono allineate, e basta guardare i loro angoli.
  _rangeRead(this: GridEngine, range: ReturnType<typeof normalizedSelection>): boolean {
    const sheet = this._sheet().id;
    for (let row = Math.floor(range.rowStart / GRID_WINDOW_ROWS) * GRID_WINDOW_ROWS; row <= range.rowEnd; row += GRID_WINDOW_ROWS) {
      for (let column = Math.floor(range.columnStart / GRID_WINDOW_COLUMNS) * GRID_WINDOW_COLUMNS; column <= range.columnEnd; column += GRID_WINDOW_COLUMNS) {
        if (!this._windows.some((window) => window.sheet === sheet && window.row_start === row && window.column_start === column)) return false;
      }
    }
    return true;
  },

  /// Perché la cella in `position` non si scrive, o `null`.
  _writeRefusal(this: GridEngine, position: GridPosition): string | null {
    if (!this._view || (!this._bytes && !this._bytesOpening)) return t("grid.workbook.unavailable");
    if (!this._windowAt(position)) return t("grid.workbook.not_loaded");
    const lock = this._workbookCell(position)?.bytes.lock;
    return lock ? t("grid.workbook.locked", { reason: t(LOCK_KEYS[lock] ?? "grid.workbook.lock.other") }) : null;
  },

  /// La cella come la griglia la mostra finché il provider non la rilegge
  /// (griglia T5): un numero semplice subito a destra, come un numero; una
  /// formula com'è scritta, tenue (`pending`), finché il foglio non dà il
  /// valore. È un'anteprima: la cella che il provider rilegge prende il suo
  /// posto e vince sempre (`_settleWritten`). Rende l'anteprima, con ciò che
  /// la finestra aveva prima, o `null` se la cella non è in una finestra letta.
  _showWritten(this: GridEngine, position: GridPosition, input: string): PastePreview | null {
    const window = this._windowAt(position);
    const key = coordinateAt(this._sheet(), position);
    if (!window || !key) return null;
    const same = (cell: GridBytesCell) => cell.key.row === key.row && cell.key.column === key.column;
    const previous = window.cells.find(same);
    const { value, display } = writtenValue(input, this._decimal);
    // Una cella nuova prende lo stile di serie, che la finestra può non avere.
    let style = previous?.style;
    if (style === undefined) {
      style = window.styles.length;
      window.styles = [...window.styles, PLAIN_STYLE];
    }
    const shown: GridBytesCell = {
      key: { sheet: key.sheet, row: key.row, column: key.column },
      input,
      style,
      value,
      display,
      lock: null,
      stale: false,
      conflict: false,
      data_bar: null,
      icon: null,
      comment: null,
      link: null,
    };
    window.cells = [...window.cells.filter((cell) => !same(cell)), shown];
    if (input.startsWith("=")) this._pendingCells.add(shown);
    this._written.set(`${key.sheet}\u0000${position.row}\u0000${position.column}`, { sheet: key.sheet, position, shown });
    return { window, previous, shown };
  },

  /// Le celle scritte che il provider ha riletto: la sua cella ha preso il
  /// posto dell'anteprima. Se mostra altro (il valore di una formula, un
  /// numero nel formato del file, il valore di prima dopo un rifiuto), il
  /// testo nuovo compare con una dissolvenza. Una cella non ancora ridisegnata
  /// aspetta il disegno dopo; quelle di un altro foglio si dimenticano.
  _settleWritten(this: GridEngine): void {
    if (!this._written.size) return;
    const sheet = this._sheet().id;
    for (const [key, written] of this._written) {
      if (written.sheet !== sheet) {
        this._written.delete(key);
        continue;
      }
      const bytes = this._workbookCell(written.position)?.bytes;
      if (bytes === written.shown) continue;
      const display = bytes?.display ?? "";
      const text = this._findCell(written.position)?.querySelector<HTMLElement>(".grid-cell-text") ?? null;
      if (text && text.textContent !== display) continue;
      this._written.delete(key);
      if (text && display && display !== written.shown.display) fadeInValue(text, this._life);
    }
  },

  /// Scrive le celle nel giornale. La sessione del documento lo riceve
  /// subito, come i commit del foglio di Fub; il provider lo controlla dopo,
  /// in coda, e la sua risposta corregge il giornale e la history.
  _commitCells(this: GridEngine, writes: readonly CellWrite[], origin: EditorChangeOrigin, recordHistory: boolean): boolean {
    if (!this._view || this._readOnly || !writes.length) return false;
    // Scrivere toglie le formiche di un taglio, ciò che si è copiato e il suo
    // tratteggio, come nei fogli di calcolo.
    this._cutMark = null;
    this._copied = null;
    this._copyMark = null;
    let journal: GridJournal;
    try {
      journal = parseGridJournal(this._journal);
    } catch {
      this._refuse(t("grid.workbook.journal_invalid"));
      return false;
    }
    const sheet = this._sheet();
    const request: GridRequestPatch[] = [];
    const history: GridCellPatch[] = [];
    const disks: string[] = [];
    const written: CellWrite[] = [];
    // Su una sessione a comandi il giornale lo scrive il provider: la griglia
    // mostra subito le celle e pubblica il giornale che lui conferma.
    const wasCommanding = this._commandMode();
    let commanding = wasCommanding;
    for (const write of writes) {
      const refusal = this._writeRefusal(write.position);
      if (refusal) {
        this._refuse(refusal);
        return false;
      }
      const coordinate = coordinateAt(sheet, write.position)!;
      const current = this._workbookCell(write.position)?.bytes.input ?? "";
      if (write.after === current) continue;
      const entry = commanding ? undefined : gridJournalEntry(journal, coordinate);
      // Una formula entra come comando, dove la sessione ne serve; altrimenti
      // si riscrive soltanto per tornare a quella del file.
      if (write.after.startsWith("=") && (commanding || entry?.before !== write.after)) {
        if (!this._serves(SET_VALUES)) {
          this._refuse(t("grid.workbook.formula"));
          return false;
        }
        commanding = true;
      }
      if (!commanding) {
        try {
          journal = recordGridJournal(journal, coordinate, current, write.after);
        } catch {
          this._refuse(t("grid.workbook.too_many"));
          return false;
        }
      }
      request.push({ cell: { ...coordinate }, before: current, after: write.after });
      history.push({ coordinate, before: { input: current }, after: { input: write.after } });
      disks.push(entry?.before ?? current);
      written.push(write);
    }
    if (!request.length) return false;
    for (const write of written) this._showWritten(write.position, write.after);
    if (commanding) {
      // Entrando nei comandi il provider porta le voci del giornale di celle
      // nel suo, una per cella: i passi di prima non sono suoi.
      if (!wasCommanding) this._foldHistory();
      this._pendingCommandMode += 1;
    }
    if (recordHistory) {
      this._undo.push({ patches: history, journaled: commanding });
      this._redo = [];
    }
    this._bytesMessage = null;
    this._showView(sheet.id, false);
    if (!commanding) this._publishJournal(gridJournalText(journal), origin);
    const epoch = this._bytesEpoch;
    const edits = this._editEpoch;
    const ticket = ++this._bytesTickets;
    if (commanding) this._unpublished.push(...request);
    this._enqueueProtocol(() => this._applyBytes(request, history, disks, origin, epoch, edits, ticket, commanding));
    return true;
  },

  _showNotice(this: GridEngine): void {
    const lines: string[] = [];
    const parts: string[] = [];
    let other = false;
    for (const notice of this._view?.notices ?? []) {
      const part = NOT_SHOWN_KEYS[notice.code];
      if (part) {
        parts.push(t(part));
        continue;
      }
      switch (notice.code) {
        case "macros": lines.push(t("grid.workbook.macros")); break;
        case "external-links": lines.push(t("grid.workbook.external_links")); break;
        case "uncomputed": lines.push(t("grid.workbook.uncomputed")); break;
        // Detto dalle celle qui sotto, con le formule scritte adesso.
        case "circular": break;
        case "incomplete": lines.push(plural(notice.count, "grid.workbook.incomplete_one", "grid.workbook.incomplete")); break;
        default: other = true;
      }
    }
    if (parts.length) {
      const list = new Intl.ListFormat(resolvedLanguage(), { type: "conjunction" }).format(parts);
      lines.push(t("grid.workbook.not_shown", { parts: list }));
    }
    if (other) lines.push(t("grid.workbook.notice_other"));
    if (this._bytesConflicts) lines.push(plural(this._bytesConflicts, "grid.workbook.conflicts_one", "grid.workbook.conflicts"));
    if (this._view?.sheets.some((sheet) => [...sheet.cells.values()].some((cell) => cell.bytes.stale))) {
      lines.push(t("grid.workbook.stale"));
    }
    // Un riferimento circolare, come lo dice un foglio di calcolo: le celle
    // del giro mostrano `#CIRC!`, e la riga lo spiega (IMP-028). Il provider
    // lo conta all'apertura, anche fuori dalle finestre lette; le formule
    // scritte dopo le dicono le loro celle.
    if (
      this._view?.notices.some((notice) => notice.code === "circular")
      || this._view?.sheets.some((sheet) => [...sheet.cells.values()].some((cell) => isCircular(cell.bytes)))
    ) {
      lines.push(t("grid.workbook.circular"));
    }
    if (this._bytesMessage) lines.push(this._bytesMessage);
    this._notice.textContent = lines.join(" ");
    this._notice.hidden = lines.length === 0;
  },

  /// Dopo una riapertura: una bozza la cui cella è cambiata sotto resta, e
  /// si chiede quale tenere; su un foglio che non c'è più si chiude, e lo si
  /// dice. Niente si perde in silenzio.
  _checkDraft(this: GridEngine, top: boolean): void {
    const editing = this._editing;
    if (!editing) return;
    if (top) {
      this._finishEditing(false, "input", false);
      if (editing.draft !== editing.original) this._refuse(t("grid.draft.gone", { draft: editing.draft }));
      return;
    }
    if (!this._windowAt(editing.position)) return;
    const now = localInput(this._workbookCell(editing.position)?.bytes.input ?? "", this._decimal);
    if (now === editing.original || now === editing.theirs) return;
    if (now === editing.draft) {
      editing.original = now;
      editing.theirs = null;
      this._draftNotice.hidden = true;
      this._pendingChanged();
      return;
    }
    editing.theirs = now;
    this._draftText.textContent = t("grid.draft.changed", { cell: cellA1(editing.position), theirs: now });
    this._draftNotice.hidden = false;
  },

  /// «Tieni la tua»: la bozza resta, e confermata scrive sopra la cella nuova.
  _keepDraft(this: GridEngine): void {
    const editing = this._editing;
    if (!editing || editing.theirs === null) return;
    editing.original = editing.theirs;
    editing.theirs = null;
    this._draftNotice.hidden = true;
    this._pendingChanged();
    (editing.owner === "cell" ? this._cellEditor : this._formulaEditor).focus();
  },

  /// «Prendi quella nuova»: la bozza si chiude e la cella mostra ciò che c'è.
  _takeTheirs(this: GridEngine): void {
    if (this._editing?.theirs === null) return;
    this._finishEditing(false, "input");
  },

  /// Dopo una riscrittura da fuori (un altro riquadro, un salvataggio, una
  /// ricarica): la bozza si tiene, o si chiude se la sua riga non c'è più; la
  /// storia dell'annulla si svuota se una sua cella è cambiata; e un avviso lo
  /// dice. `before` è il foglio com'era quando una cella era aperta.
  _afterRewrite(this: GridEngine, top: boolean, before: readonly ShownWindow[] | null): void {
    const editing = this._editing;
    const closed = editing !== null && !top && this._followEditing(editing);
    this._checkDraft(top);
    const notes: string[] = [];
    const open = this._editing;
    if (open && !closed && !top && before
      && changedElsewhere(before, shownWindows(this._windows, this._sheet().id), open.coordinate)) {
      notes.push(t("grid.external.writing"));
    }
    if (this._dropStaleHistory()) notes.push(t("grid.external.undo"));
    if (notes.length) this._addNotice(...notes);
  },

  /// La cella aperta segue la sua riga, anche se questa si è spostata. Se la
  /// riga non c'è più, la cella si chiude e la bozza va negli appunti. Vero se
  /// la cella si è chiusa.
  _followEditing(this: GridEngine, editing: EditingState): boolean {
    if (!editing.coordinate) return false;
    const at = positionOf(this._sheet(), editing.coordinate);
    if (!at) {
      this._finishEditing(false, "input", false);
      if (editing.draft !== editing.original) this._copyDraft(editing.draft);
      return true;
    }
    if (!samePosition(at, editing.position)) {
      this._editing = { ...editing, position: at };
      this._render();
    }
    return false;
  },

  /// La bozza che la riga ha portato via va negli appunti. Se gli appunti
  /// rifiutano, il testo resta scritto nell'avviso: non si perde in silenzio.
  _copyDraft(this: GridEngine, draft: string): void {
    writeClipboardText(draft).then(
      () => this._addNotice(t("grid.draft.row_gone", { draft })),
      () => this._addNotice(t("grid.draft.row_gone_lost", { draft })),
    );
  },

  /// Un avviso in più, dietro quelli che la griglia mostra già: è il canale di
  /// `_refuse`.
  _addNotice(this: GridEngine, ...texts: readonly string[]): void {
    if (this._destroyed) return;
    this._refuse(joinNotices(this._bytesMessage, ...texts));
  },

  /// Riscrive le celle di `patches` della history: annullare e rifare.
  _commit(this: GridEngine, patches: readonly GridCellPatch[], origin: EditorChangeOrigin, recordHistory: boolean): boolean {
    const sheet = this._sheet();
    const writes: CellWrite[] = [];
    for (const patch of patches) {
      const position = positionOf(sheet, patch.coordinate);
      if (!position) {
        this._refuse(t("grid.workbook.not_loaded"));
        return false;
      }
      writes.push({ position, after: patch.after?.input ?? "" });
    }
    return this._commitCells(writes, origin, recordHistory);
  },

  _clearSelection(this: GridEngine): void {
    if (this._readOnly) return;
    const range = normalizedSelection(this._selection);
    if (![range, ...this._others].every((area) => this._rangeRead(area))) {
      this._refuse(t("grid.workbook.not_loaded"));
      return;
    }
    const writes: CellWrite[] = [];
    for (const [key, cell] of this._view?.sheets[this._sheetIndex]?.cells ?? []) {
      const position = keyPosition(key);
      if (cell.bytes.input !== "" && this._inSelection(range, position.row, position.column)) writes.push({ position, after: "" });
    }
    this._commitCells(writes, "input", true);
  },
};
export type WriteMethods = typeof writeMethods;
