// Il motore della griglia: la sessione del file (byte, conferme, storia,\n// annulla e ripeti interni, gare). Metodi della\n// classe `GridEngine`, montati sul suo prototipo da `engine.ts`\n// (`editors/core/mix-methods.ts`).
import type {
  GridBytesSession,
  GridBytesWindow,
  GridCellPatch as GridRequestPatch,
  GridWindowRequest,
} from "../../host/contract";
import { GRID_BYTES_PROTOCOL_VERSION } from "../../host/contract";
import { errorText, isErrorKind } from "../../host/errors";
import { operationFromText, type EditorChangeOrigin } from "../core/text-operation";
import { gridJournalEntry, parseGridJournal, type GridJournal } from "../../state/grid-journal";
import { t } from "../../i18n/strings";
import { positionOf, type GridPosition, type GridSheet, type GridCell } from "./model";
import { type GridCellPatch } from "./operation";
import { cellKey, validateBytesSession, validateBytesWindow, type WorkbookCell } from "./workbook";
import { viewportRange, type AxisLayout } from "./engine-geometry";
import { applySourceEdit, keptWindows, type BytesState } from "./engine-host";
import {
  DEFAULT_ROW_HEIGHT,
  DEFAULT_COLUMN_WIDTH,
  ROW_HEADER_WIDTH,
  COLUMN_HEADER_HEIGHT,
  EMPTY_SHEET,
  GRID_WINDOW_ROWS,
  GRID_WINDOW_COLUMNS,
  MAX_GRID_SESSION_WINDOWS,
  UNDO,
  REDO,
  HistoryStep,
  ShownWindow,
  shownWindows,
} from "./engine-parts";
import type { GridEngine } from "./engine";

export const sessionMethods = {
  /// Se annulla e ripeti sono del provider: una cartella il cui catalogo li
  /// serve tiene la cronologia del documento, per celle e comandi insieme e
  /// anche oltre i salvataggi. Le patch della history servono soltanto a una
  /// sessione che non li ha.
  _providerHistory(this: GridEngine): boolean {
    return this._serves(UNDO) && this._serves(REDO);
  },

  /// Se un'altra mano ha cambiato una cella della history, la history si
  /// svuota e l'avviso lo dice: un annulla non riporta i dati di prima. Vero
  /// se si è svuotata, e allora annulla o ripeti non fanno niente.
  _refuseStaleHistory(this: GridEngine): boolean {
    if (!this._dropStaleHistory()) return false;
    this._addNotice(t("grid.external.undo"));
    return true;
  },

  /// Un passo da `from` a `to`. Nella sessione a comandi, un passo ancora in
  /// cima al giornale (o nessun passo delle celle: un comando della barra) va
  /// al provider; altrimenti si scrivono le sue patch, e da lì nessun passo è
  /// più in cima al giornale.
  _history(this: GridEngine, from: HistoryStep[], to: HistoryStep[], id: typeof UNDO | typeof REDO, write: (step: HistoryStep) => boolean): boolean {
    const step = from[from.length - 1];
    if (this._commandMode() && (!step || step.journaled)) {
      if (!this._documentHistory(id)) return false;
      if (step) to.push(from.pop()!);
      // Il provider ha annullato un comando che le celle non conoscono:
      // ciò che si ripeterebbe da qui è soltanto suo.
      else to.length = 0;
      return true;
    }
    if (!step) return false;
    from.pop();
    if (!write(step)) {
      from.push(step);
      return false;
    }
    to.push(step);
    this._foldHistory();
    return true;
  },

  /// Nessun passo è più in cima al giornale del provider: si annullano tutti
  /// con le loro patch.
  _foldHistory(this: GridEngine): void {
    for (const step of this._undo) step.journaled = false;
    for (const step of this._redo) step.journaled = false;
  },

  /// Annulla o ripeti del documento, nella sessione a comandi.
  _documentHistory(this: GridEngine, id: typeof UNDO | typeof REDO): boolean {
    // Mentre la cartella si riapre (dopo un salvataggio) il passo va in coda,
    // e arriva alla sessione nuova.
    if ((!this._bytes && !this._bytesOpening) || this._readOnly || !this._serves(id)) return false;
    this._finishEditing(false, "input", false);
    this._give(id, "{}", true);
    return true;
  },

  _sheet(this: GridEngine): GridSheet {
    return this._workbook?.sheets[this._sheetIndex] ?? EMPTY_SHEET;
  },

  /// La cella in `position` del foglio mostrato. Le celle della cartella sono
  /// indicizzate: cercarle in lista a ogni cella disegnata costerebbe quanto
  /// il foglio intero.
  _cellAt(this: GridEngine, position: GridPosition): GridCell | undefined {
    return this._workbookCell(position)?.cell;
  },

  _workbookCell(this: GridEngine, position: GridPosition): WorkbookCell | undefined {
    return this._view?.sheets[this._sheetIndex]?.cells.get(cellKey(position));
  },

  _currentBase(this: GridEngine): string | null {
    return this._options.base?.() ?? this._options.revision ?? null;
  },

  /// Apre la cartella sul giornale `journal` e sui byte della base di
  /// adesso. `reset` è un documento nuovo: si parte dal foglio attivo nel
  /// file, in alto a sinistra; altrimenti foglio, selezione e scorrimento
  /// restano dove sono. L'apertura va in coda alle modifiche già partite, e
  /// quelle scritte mentre si apre partono dopo di lei.
  _openWorkbook(this: GridEngine, journal: string, reset: boolean): void {
    const epoch = ++this._bytesEpoch;
    // Con una cella aperta, il foglio come si vede adesso: la riapertura dice
    // se le sue celle sono cambiate, oltre a quella che si scrive.
    const shown = !reset && this._editing ? shownWindows(this._windows, this._sheet().id) : null;
    this._journal = journal;
    this._bytesOpening = true;
    this._root.dataset.gridProfile = "workbook";
    // Una bozza aperta resta: la riapertura dopo un salvataggio, proprio o di
    // un altro riquadro, non la butta. Se la sua cella è cambiata sotto, si
    // chiede quale tenere (`_checkDraft`). Un documento nuovo la chiude.
    if (reset) this._finishEditing(false, "input", false);
    if (reset) {
      this._undo = [];
      this._redo = [];
      this._heldHistory = [];
    }
    // Una sessione nuova del provider non ha la history di quella di prima:
    // i passi si annullano con le loro patch (un salvataggio ha messo il
    // giornale nei byte, o un altro riquadro l'ha cambiato).
    this._foldHistory();
    // I passi in coda della sessione di prima non valgono più: le celle che
    // soltanto il provider teneva si riscrivono sulla sessione nuova. Un
    // documento nuovo non le porta.
    this._carried = reset ? [] : [...this._carried, ...this._unpublished];
    this._carriedTicket = this._bytesTickets;
    this._unpublished = [];
    this._enqueueProtocol(() => this._openBytes(journal, reset, epoch, shown));
  },

  async _openBytes(this: GridEngine, journal: string, reset: boolean, epoch: number, shown: readonly ShownWindow[] | null): Promise<void> {
    if (this._destroyed || epoch !== this._bytesEpoch) return;
    const host = this._options.grid;
    const doc = this._options.documentId;
    const base = this._currentBase();
    this._closeBytes();
    let opened: { readonly surface: string; readonly instance: string } | null = null;
    try {
      const surface = host && doc && base
        ? (await host.listGridSurfaces()).find((candidate) =>
          candidate.family === "grid"
          && candidate.protocol_version === GRID_BYTES_PROTOCOL_VERSION
          && candidate.format === this._options.formatId)
        : undefined;
      if (!host || !doc || !base || !surface) {
        if (!this._destroyed && epoch === this._bytesEpoch) this._openFailed(journal, t("grid.workbook.unavailable"));
        return;
      }
      let session: GridBytesSession;
      try {
        session = await host.openGridBytes(surface.id, doc, journal, base);
      } catch (error) {
        // I byte da cui il giornale discende non sono più sul disco: il file
        // è cambiato fuori (un conflitto, una bozza ritrovata dopo). Il
        // giornale si apre sui byte di adesso, come li scriverebbe «Tieni il
        // mio testo»: la cartella si legge invece di restare bianca, e la
        // scelta resta alla sessione.
        const disk = isErrorKind(error, "conflict") ? await this._options.diskRevision?.().catch(() => null) : null;
        if (!disk || disk === base || this._destroyed || epoch !== this._bytesEpoch) throw error;
        session = await host.openGridBytes(surface.id, doc, journal, disk);
      }
      opened = { surface: surface.id, instance: session.instance };
      validateBytesSession(session);
      if (this._destroyed || epoch !== this._bytesEpoch) return;
      const hidden = new Set(session.hidden);
      const kept = reset ? undefined : this._workbook?.sheets[this._sheetIndex]?.id;
      const visible = session.sheets.filter((sheet) => !hidden.has(sheet.id));
      const sheet = visible.find((candidate) => candidate.id === kept)
        ?? visible.find((candidate) => candidate.id === session.active)
        ?? visible[0];
      const top = sheet.id !== kept;
      if (top) {
        this._viewport.scrollTop = 0;
        this._viewport.scrollLeft = 0;
      }
      const state: BytesState = { surface: surface.id, instance: session.instance, session };
      const windows = await this._readBytesWindows(state, sheet.id, !top, []);
      if (this._destroyed || epoch !== this._bytesEpoch) return;
      this._confirm(journal);
      opened = null;
      this._bytes = state;
      this._shownSession = session;
      this._windows = windows;
      this._bytesBase = base;
      this._pendingCommandMode = 0;
      this._commands = session.commands;
      this._options.onCommands?.();
      this._bytesConflicts = session.conflicts.length;
      this._bytesMessage = null;
      this._root.dataset.gridProtocol = "v2";
      this._showView(sheet.id, top);
      this._afterRewrite(top, shown);
      this._followMedia();
      // Annulla e ripeti dati mentre il giornale si scriveva vengono prima
      // delle celle riportate: sono stati dati prima di loro. Se un'altra
      // scrittura riapre di nuovo la cartella, aspettano quella sessione.
      const held = this._heldHistory;
      this._heldHistory = [];
      for (const [index, command] of held.entries()) {
        if (!(await this._awaitWriting()) && !this._destroyed && epoch === this._bytesEpoch) {
          await this._giveNow(command, true, epoch, this._editEpoch, this._carriedTicket);
          continue;
        }
        if (!this._destroyed) this._holdHistory(held.slice(index));
        return;
      }
      if (this._destroyed || epoch !== this._bytesEpoch) return;
      // Dentro il passo della riapertura, prima di ciò che si è scritto
      // mentre si riapriva: l'ordine delle scritture resta quello dato.
      const carried = this._carried;
      this._carried = [];
      if (carried.length) await this._rewriteCarried(carried, epoch);
    } catch (error) {
      if (this._destroyed || epoch !== this._bytesEpoch) return;
      this._openFailed(journal, isErrorKind(error, "conflict")
        ? t("grid.workbook.changed")
        : t("grid.workbook.open_failed", { error: errorText(error) }));
    } finally {
      if (opened && host) void host.closeGridBytes(opened.surface, opened.instance).catch(() => {});
      if (epoch === this._bytesEpoch) this._bytesOpening = false;
    }
  },

  _openFailed(this: GridEngine, journal: string, message: string): void {
    this._bytesMessage = message;
    this._commands = [];
    this._options.onCommands?.();
    this._root.dataset.gridProtocol = "unavailable";
    // Una modifica scritta mentre si apriva non ha chi la controlli: il
    // giornale torna quello aperto.
    this._publishJournal(journal, "input");
    this._undo = [];
    this._redo = [];
    this._heldHistory = [];
    this._showNotice();
  },

  _closeBytes(this: GridEngine): void {
    const state = this._bytes;
    this._bytes = null;
    if (state && this._options.grid) void this._options.grid.closeGridBytes(state.surface, state.instance).catch(() => {});
  },

  _publishJournal(this: GridEngine, text: string, origin: EditorChangeOrigin): void {
    const published = this._journal;
    if (text === published) return;
    this._journal = text;
    this._options.onChange({ text, operation: operationFromText(published, text), origin });
  },

  /// Le finestre del foglio `sheetId` che lo schermo mostra e che `kept` non
  /// ha già alla revisione della sessione. `layout` usa le misure del foglio
  /// mostrato, che è quello.
  async _readBytesWindows(
    this: GridEngine,
    state: BytesState,
    sheetId: string,
    layout: boolean,
    kept: readonly GridBytesWindow[],
  ): Promise<GridBytesWindow[]> {
    const host = this._options.grid;
    const session = state.session;
    const sheet = session.sheets.find((candidate) => candidate.id === sheetId);
    if (!host || !sheet) return [];
    const none: AxisLayout = { offsets: [], sizes: [], total: 0 };
    const frame = layout ? this._frame : null;
    const zoom = frame?.zoom ?? 1;
    const rowRange = viewportRange(
      sheet.row_count,
      layout ? this._rows : none,
      this._viewport.scrollTop,
      this._viewport.clientHeight,
      frame?.columnHeader ?? COLUMN_HEADER_HEIGHT,
      DEFAULT_ROW_HEIGHT * zoom,
    );
    const columnRange = viewportRange(
      sheet.column_count,
      layout ? this._columns : none,
      this._viewport.scrollLeft,
      this._viewport.clientWidth,
      frame?.rowHeader ?? ROW_HEADER_WIDTH,
      DEFAULT_COLUMN_WIDTH * zoom,
    );
    if (!rowRange || !columnRange) return [];
    // I blocchi dello schermo, e quelli delle righe e colonne bloccate, che
    // si vedono anche quando lo schermo è lontano.
    const blocks = (range: { start: number; end: number }, frozen: number, size: number): number[] => {
      const out = new Set<number>();
      for (let start = 0; start < frozen; start += size) out.add(start);
      for (let start = Math.floor(range.start / size) * size; start <= range.end; start += size) out.add(start);
      return [...out].sort((left, right) => left - right);
    };
    const requests: GridWindowRequest[] = [];
    for (const row of blocks(rowRange, frame?.frozenRows ?? 0, GRID_WINDOW_ROWS)) {
      for (const column of blocks(columnRange, frame?.frozenColumns ?? 0, GRID_WINDOW_COLUMNS)) {
        if (kept.some((window) =>
          window.revision === session.revision
          && window.sheet === sheet.id
          && window.row_start === row
          && window.column_start === column)) continue;
        requests.push({
          revision: session.revision,
          sheet: sheet.id,
          row_start: row,
          row_count: Math.min(GRID_WINDOW_ROWS, sheet.row_count - row),
          column_start: column,
          column_count: Math.min(GRID_WINDOW_COLUMNS, sheet.column_count - column),
          known_media: this._media.known(),
        });
      }
    }
    if (requests.length > MAX_GRID_SESSION_WINDOWS) throw new Error("grid viewport requests exceed limit");
    return Promise.all(requests.map(async (request) => {
      const window = await host.gridBytesWindow(state.surface, state.instance, request);
      validateBytesWindow(window, session);
      if (this._media.remember(window.objects)) this._mediaAdded = true;
      return window;
    }));
  },

  _loadViewport(this: GridEngine): Promise<void> {
    const state = this._bytes;
    if (!state || this._destroyed) return Promise.resolve();
    if (this._viewportLoad) {
      this._viewportLoadQueued = true;
      return this._viewportLoad;
    }
    const epoch = this._bytesEpoch;
    const sheetId = this._sheet().id;
    const revision = state.session.revision;
    const current = () => !this._destroyed && epoch === this._bytesEpoch && this._bytes === state && state.session.revision === revision;
    const load = (async () => {
      try {
        const fresh = await this._readBytesWindows(state, sheetId, true, this._windows);
        // Una modifica confermata nel frattempo rilegge lo schermo da sé.
        if (!current() || !fresh.length) return;
        this._windows = keptWindows(this._windows, fresh, revision);
        this._showView(this._sheet().id, false, true);
        this._followMedia();
      } catch (error) {
        if (!current()) return;
        this._refuse(t("grid.workbook.read_failed", { error: errorText(error) }));
      }
    })().finally(() => {
      this._viewportLoad = null;
      if (this._viewportLoadQueued) {
        this._viewportLoadQueued = false;
        void this._loadViewport();
      }
    });
    this._viewportLoad = load;
    return load;
  },

  /// Rilegge lo schermo dopo una modifica confermata, o dopo una rifiutata.
  async _refreshBytes(this: GridEngine, state: BytesState, epoch: number): Promise<void> {
    const revision = state.session.revision;
    try {
      const fresh = await this._readBytesWindows(state, this._sheet().id, true, []);
      if (this._destroyed || epoch !== this._bytesEpoch || this._bytes !== state || state.session.revision !== revision) return;
      this._windows = keptWindows(this._windows, fresh, revision);
      this._showView(this._sheet().id, false);
      this._followMedia();
    } catch (error) {
      if (this._destroyed || epoch !== this._bytesEpoch || this._bytes !== state || state.session.revision !== revision) return;
      this._refuse(t("grid.workbook.read_failed", { error: errorText(error) }));
    }
  },

  /// Una finestra a cui l'host non ha dato i byte di un'immagine, perché
  /// non ci stavano, si richiede: adesso la shell ha le immagini delle altre,
  /// e l'host le salta. Soltanto dopo una lettura che ne ha portate di
  /// nuove, così la richiesta finisce.
  _followMedia(this: GridEngine): void {
    const added = this._mediaAdded;
    this._mediaAdded = false;
    if (!added) return;
    const sheet = this._sheet().id;
    const short = this._windows.filter((window) => window.sheet === sheet && this._media.missing(window.objects));
    if (!short.length) return;
    this._windows = this._windows.filter((window) => !short.includes(window));
    void this._loadViewport();
  },

  _refuse(this: GridEngine, message: string): void {
    this._bytesMessage = message;
    this._showNotice();
  },

  /// La finestra letta che contiene `position` del foglio mostrato.
  _windowAt(this: GridEngine, position: GridPosition): GridBytesWindow | undefined {
    const sheet = this._sheet().id;
    return this._windows.find((window) =>
      window.sheet === sheet
      && position.row >= window.row_start
      && position.row < window.row_start + window.rows.length
      && position.column >= window.column_start
      && position.column < window.column_start + window.columns.length);
  },

  /// Riscrive sulla sessione appena aperta le celle che la sessione di
  /// prima teneva soltanto nel provider: la riapertura le ha tolte dalla
  /// coda prima che il loro giornale arrivasse alla sessione del documento.
  /// Senza preimmagine, perché sono le ultime scritte; una cella scritta due
  /// volte va con l'ultima.
  async _rewriteCarried(this: GridEngine, carried: readonly GridRequestPatch[], epoch: number): Promise<void> {
    const last = new Map<string, GridRequestPatch>();
    for (const patch of carried) {
      const key = `${patch.cell.sheet}\u0000${patch.cell.row}\u0000${patch.cell.column}`;
      last.delete(key);
      last.set(key, { cell: { ...patch.cell }, before: null, after: patch.after });
    }
    const patches = [...last.values()];
    const sheet = this._sheet();
    for (const patch of patches) {
      const position = patch.cell.sheet === sheet.id ? positionOf(sheet, patch.cell) : null;
      if (position) this._showWritten(position, patch.after);
    }
    this._showView(sheet.id, false);
    this._pendingCommandMode += 1;
    this._unpublished.push(...patches);
    await this._applyBytes(patches, [], [], "input", epoch, this._editEpoch, this._carriedTicket, true);
  },

  /// Il giornale confermato è `text`.
  _confirm(this: GridEngine, text: string): GridJournal {
    const journal = parseGridJournal(text);
    this._confirmedJournal = text;
    this._confirmedCommands = journal.commands.length > 0;
    return journal;
  },

  async _applyBytes(
    this: GridEngine,
    patches: GridRequestPatch[],
    history: GridCellPatch[],
    disks: readonly string[],
    origin: EditorChangeOrigin,
    epoch: number,
    edits: number,
    ticket: number,
    commanding: boolean,
  ): Promise<void> {
    try {
      await this._applyBytesNow(patches, history, disks, origin, epoch, edits, ticket, commanding);
    } finally {
      if (commanding && epoch === this._bytesEpoch) this._pendingCommandMode = Math.max(0, this._pendingCommandMode - 1);
    }
  },

  async _applyBytesNow(
    this: GridEngine,
    patches: GridRequestPatch[],
    history: GridCellPatch[],
    disks: readonly string[],
    origin: EditorChangeOrigin,
    epoch: number,
    edits: number,
    ticket: number,
    commanding: boolean,
  ): Promise<void> {
    const host = this._options.grid;
    const state = this._bytes;
    const current = () => !this._destroyed && epoch === this._bytesEpoch && edits === this._editEpoch && this._bytes === state;
    // Senza sessione l'apertura è fallita, e ha già riportato il giornale.
    if (!host || !state || !current()) return;
    let confirmed: GridJournal;
    try {
      const commit = await host.applyGridBytes(state.surface, state.instance, { revision: state.session.revision, patches });
      if (!current()) return;
      confirmed = this._confirm(applySourceEdit(this._confirmedJournal, commit.edit));
      state.session = { ...state.session, revision: commit.revision };
    } catch (error) {
      if (!current()) return;
      // Le modifiche in coda partivano da questa: non entrano neanche loro.
      this._editEpoch++;
      this._unpublished = [];
      // Una cella che il provider dice bloccata lo era in una finestra che la
      // shell non aveva ancora riletto: lo dice come il blocco che si vede.
      this._bytesMessage = isErrorKind(error, "permission_denied")
        ? t("grid.workbook.locked", { reason: t("grid.workbook.lock.other") })
        : t("grid.workbook.apply_failed", { error: errorText(error) });
      this._publishJournal(this._confirmedJournal, origin);
      this._undo = [];
      this._redo = [];
      this._windows = [];
      this._showNotice();
      await this._refreshBytes(state, epoch);
      return;
    }
    // La history tiene l'input che il provider ha scritto (`0.250` è `0.25`):
    // annullare parte da quello.
    if (!commanding) {
      history.forEach((patch, index) => {
        history[index] = { ...patch, after: { input: gridJournalEntry(confirmed, patch.coordinate)?.after ?? disks[index] } };
      });
    }
    // Il giornale ottimistico si corregge soltanto quando non resta niente in
    // coda: prima, la conferma non contiene ancora le modifiche che seguono.
    if (ticket === this._bytesTickets) {
      this._unpublished = [];
      this._publishJournal(this._confirmedJournal, origin);
    }
    // Il passo nuovo si annulla, e niente si ripete più: annulla e ripeti
    // del menu lo dicono dal catalogo riletto.
    const stale = (id: string, enabled: boolean) => this._commands.some((command) => command.id === id && command.enabled !== enabled);
    if (this._providerHistory() && (stale(UNDO, true) || stale(REDO, false))) void this._loadCommands();
    await this._refreshBytes(state, epoch);
  },

  /// Se una cella della storia non è più quella che la storia ha lasciata
  /// (un'altra mano l'ha cambiata), la storia si svuota: un annulla non riporta
  /// i dati di prima. Vero se si è svuotata.
  /// Con annulla e ripeti del provider la history delle celle non si usa: il
  /// provider controlla da sé le preimmagini, e non c'è niente da svuotare.
  _dropStaleHistory(this: GridEngine): boolean {
    if (!this._undo.length && !this._redo.length) return false;
    if (this._providerHistory()) return false;
    const moved = this._staleIn(this._undo, (patch) => patch.after?.input ?? "")
      || this._staleIn(this._redo, (patch) => patch.before?.input ?? "");
    if (!moved) return false;
    this._undo = [];
    this._redo = [];
    return true;
  },

  /// Vero se una cella di `stack` letta adesso non ha più l'input che la voce
  /// più recente che la tocca ha lasciato (`expect`): le voci più vecchie di
  /// una stessa cella vengono dopo, e il loro valore non conta. Una cella non
  /// letta, o di un altro foglio, non si può dire: si dirà quando sarà letta.
  _staleIn(this: GridEngine, stack: readonly HistoryStep[], expect: (patch: GridCellPatch) => string): boolean {
    const sheet = this._sheet();
    // Le posizioni per id una volta sola: `positionOf` scorrerebbe il foglio a
    // ogni cella, e questo controllo gira a ogni riapertura.
    const rows = new Map<string, number>();
    sheet.rows.forEach((row, index) => { if (!rows.has(row.id)) rows.set(row.id, index); });
    const columns = new Map<string, number>();
    sheet.columns.forEach((column, index) => { if (!columns.has(column.id)) columns.set(column.id, index); });
    const seen = new Set<string>();
    for (let index = stack.length - 1; index >= 0; index -= 1) {
      for (const patch of stack[index]!.patches) {
        const { coordinate } = patch;
        const key = `${coordinate.sheet}\u0000${coordinate.row}\u0000${coordinate.column}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (coordinate.sheet !== sheet.id) continue;
        const row = rows.get(coordinate.row);
        const column = columns.get(coordinate.column);
        if (row === undefined || column === undefined) continue;
        const position = { row, column };
        if (!this._windowAt(position)) continue;
        if ((this._workbookCell(position)?.bytes.input ?? "") !== expect(patch)) return true;
      }
    }
    return false;
  },
};
export type SessionMethods = typeof sessionMethods;
