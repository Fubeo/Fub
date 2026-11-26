// Il motore della griglia: i comandi del foglio (catalogo, permessi, coda,\n// riempimento, ordinamento). Metodi della\n// classe `GridEngine`, montati sul suo prototipo da `engine.ts`\n// (`editors/core/mix-methods.ts`).
import type {
  GridCommand,
  GridBytesSession,
  GridCommandOutcome,
  GridSelection as GridCommandSelection,
} from "../../host/contract";
import { errorText, isErrorKind } from "../../host/errors";
import { t } from "../../i18n/strings";
import { type GridSelection } from "./model";
import { cellA1, parseCellA1, parseRangeA1, rangeA1, type GridRange } from "./merges";
import { enterValues } from "./grid-motion";
import { validateBytesSession } from "./workbook";
import { samePosition } from "./engine-geometry";
import { applySourceEdit, emptyEdit, insertedObject, type GridRun } from "./engine-host";
import { PASTE_FROM, SORTS, regionOf, Waiting, FILL_COMMANDS, UNDO, REDO, HISTORY_RETRIES } from "./engine-parts";
import type { GridEngine } from "./engine";

export const commandsMethods = {
  /// Se il comando `id` si può dare in questo stato: in sola lettura
  /// soltanto se non cambia la cartella.
  _allowed(this: GridEngine, id: string): boolean {
    if (!this._readOnly) return true;
    const effect = this._effectOf(id);
    return effect === "legge" || effect === "mostra";
  },

  /// `command`, con `after` che sa, quando il provider ha risposto e la
  /// griglia ha riletto, se il comando ha cambiato la cartella.
  _command(this: GridEngine, id: string, params: string, after?: (applied: boolean) => void): boolean {
    const state = this._commands.find((command) => command.id === id);
    if (!this._bytes || !this._allowed(id) || !state) return false;
    // Annulla e ripeti dal menu sono Ctrl+Z e Ctrl+Y: il provider sa se c'è
    // un passo, anche quando il catalogo letto prima non lo sa ancora.
    if (id === UNDO) return this.undo();
    if (id === REDO) return this.redo();
    if (!state.enabled) {
      if (state.reason) this._refuse(t("grid.workbook.command_off", { reason: state.reason }));
      return false;
    }
    if (SORTS.has(id) && this._sortRegion(id, params)) return true;
    this._finishEditing(true, "input", false);
    this._give(id, params, false, undefined, HISTORY_RETRIES, after);
    return true;
  },

  /// Ordinare da una cella sola ordina la sua zona, come in un foglio di
  /// calcolo: la selezione si allarga prima, perché si veda che cosa si
  /// ordina (IMP-036), poi il comando va sulla selezione nuova. Falso se la
  /// selezione è già un intervallo, o se la cella non ha una zona.
  _sortRegion(this: GridEngine, id: string, params: string): boolean {
    const range = this._selectedRange();
    if (this._others.length || range.rowStart !== range.rowEnd || range.columnStart !== range.columnEnd) return false;
    if (!this._serves("selection.currentRegion")) return false;
    this._finishEditing(true, "input", false);
    const sheet = this._sheet().id;
    const active = cellA1(this._active());
    void this.query("selection.currentRegion").then((read) => {
      if (this._destroyed || !this._bytes || this._sheet().id !== sheet) return;
      const region = regionOf(read);
      if (region) this._adoptSelection({ sheet, selection: region, active });
      this._give(id, params, false);
    });
    return true;
  },

  /// Mette in coda il comando `id`: da qui annulla e ripeti sono del
  /// provider, anche prima che risponda.
  ///
  /// Un riempimento mette le formiche attorno a ciò che riempirà, finché il
  /// provider non ha risposto e la griglia non ha riletto (`_beginFill`).
  /// `after`, se c'è, sa allora se il comando ha cambiato la cartella.
  _give(
    this: GridEngine,
    id: string,
    params: string,
    history: boolean,
    done?: (run: GridRun) => void,
    retries = HISTORY_RETRIES,
    after?: (applied: boolean) => void,
  ): void {
    const selection = this._commandSelection();
    const command: GridCommand = { id, params, ...selection };
    // Un comando cambia la cartella sotto ciò che si è copiato.
    if (id !== PASTE_FROM) {
      this._copied = null;
      this._dropCopyMark();
    }
    const wait = after ? null : this._beginFill(id, params);
    const answered = after ?? (wait ? (applied: boolean) => this._settleWait(wait, applied) : undefined);
    // Un comando della barra lo annulla soltanto il provider, finché è nel
    // suo giornale; annulla e ripeti tengono la history (`_history`).
    if (id !== UNDO && id !== REDO) {
      this._undo = [];
      this._redo = [];
    }
    this._pendingCommandMode += 1;
    const given = this._bytesEpoch;
    const givenEdits = this._editEpoch;
    const ticket = ++this._bytesTickets;
    let settled = false;
    const finish = (run: GridRun): void => {
      if (settled) return;
      settled = true;
      done?.(run);
    };
    this._enqueueProtocol(async () => {
      // Mentre il giornale si scrive, annullare un comando lo toglierebbe da
      // un testo che il disco ha già, e il salvataggio non lo riporterebbe
      // sui byte nuovi (IMP-6400). Il passo aspetta la scrittura, con la coda
      // ferma dietro di lui; se la scrittura ha fatto riaprire la cartella va
      // alla sessione nuova, che ritrova la cronologia, appena si apre.
      if (history && await this._awaitWriting()) {
        // La riapertura azzera i comandi in coda (`_pendingCommandMode`).
        if (!this._destroyed) this._holdHistory([command]);
        finish({ ok: false, error: null });
        return;
      }
      // Annulla e ripeti valgono per la sessione che c'è quando arrivano al
      // provider: anche quella riaperta dopo un salvataggio, che ritrova la
      // cronologia del documento.
      const epoch = history ? this._bytesEpoch : given;
      const edits = history ? this._editEpoch : givenEdits;
      const revision = this._bytes?.session.revision;
      let reached = true;
      try {
        reached = await this._giveNow(command, history, epoch, edits, ticket, done ? finish : undefined);
      } finally {
        if (epoch === this._bytesEpoch) this._pendingCommandMode = Math.max(0, this._pendingCommandMode - 1);
        finish({ ok: false, error: null });
      }
      // Un salvataggio ha riaperto la cartella mentre il passo era in volo:
      // la sessione vecchia è chiusa con la sua risposta, e quella nuova ha
      // la cronologia di prima del passo. Il passo va a lei, una volta.
      if (history && !reached && retries > 0 && !this._destroyed && epoch !== this._bytesEpoch && edits === this._editEpoch) {
        this._give(id, params, true, undefined, retries - 1, answered);
        return;
      }
      answered?.(!this._destroyed && this._bytes !== null && this._bytes.session.revision !== revision);
    });
  },

  /// Aspetta la scrittura del giornale in volo, se c'è (`writing`). Vero se
  /// intanto la cartella si è riaperta sui byte scritti (o la griglia è
  /// smontata): un passo della cronologia non va più alla sessione di prima.
  /// Falso se non c'era una scrittura, o se non ha cambiato i byte (è
  /// fallita): il passo va avanti sulla sessione di adesso.
  async _awaitWriting(this: GridEngine): Promise<boolean> {
    const writing = this._options.writing?.();
    if (!writing) return false;
    const epoch = this._bytesEpoch;
    await writing.catch(() => {});
    return this._destroyed || epoch !== this._bytesEpoch;
  },

  /// Tiene annulla e ripeti `commands` per la sessione che si sta aprendo,
  /// prima di quelli già tenuti (sono stati dati prima). Se nessuna apertura è
  /// in coda, vanno in coda adesso, nell'ordine.
  _holdHistory(this: GridEngine, commands: readonly GridCommand[]): void {
    if (this._bytesOpening) {
      this._heldHistory = [...commands, ...this._heldHistory];
      return;
    }
    for (const command of commands) this._give(command.id, command.params, true);
  },

  /// Un comando che riempie (`FILL_COMMANDS`): le formiche attorno a ciò che
  /// riempirà, cioè il bersaglio di `edit.autoFill` o la selezione, finché il
  /// foglio non risponde. La selezione resta dov'è: il provider la mette sul
  /// riempimento quando risponde, e i segni ci scivolano.
  _beginFill(this: GridEngine, id: string, params: string): Waiting | null {
    if (!FILL_COMMANDS.has(id) || !this._workbook) return null;
    let range = this._selectedRange();
    let source: GridRange | null = null;
    if (id === "edit.autoFill") {
      try {
        const asked = JSON.parse(params) as { source?: unknown; target?: unknown };
        const target = typeof asked.target === "string" ? parseRangeA1(asked.target) : null;
        source = typeof asked.source === "string" ? parseRangeA1(asked.source) : null;
        if (target) range = target;
      } catch {
        // Parametri che non si leggono: le formiche stanno sulla selezione.
      }
    } else if (id === "edit.fillDown") {
      source = { ...range, rowEnd: range.rowStart };
    } else if (id === "edit.fillUp") {
      source = { ...range, rowStart: range.rowEnd };
    } else if (id === "edit.fillRight") {
      source = { ...range, columnEnd: range.columnStart };
    } else if (id === "edit.fillLeft") {
      source = { ...range, columnStart: range.columnEnd };
    }
    const wait: Waiting = { kind: "fill", sheet: this._sheet().id, range, source };
    this._waiting = wait;
    this._updateMarks(this._selectedRange());
    return wait;
  },

  /// Il foglio ha risposto al gesto `wait`, e la griglia ha riletto: le
  /// formiche se ne vanno con una dissolvenza (se un gesto più nuovo non le ha
  /// già prese) e, se il riempimento è entrato, i valori nuovi entrano uno
  /// dopo l'altro dalla sorgente. Un no lo dice l'avviso, come per ogni
  /// comando.
  _settleWait(this: GridEngine, wait: Waiting, applied: boolean): void {
    if (this._destroyed) return;
    const mine = this._waiting === wait;
    if (mine) this._waiting = null;
    if (!this._workbook) return;
    if (mine) this._updateMarks(this._selectedRange());
    if (!applied || wait.kind !== "fill" || wait.sheet !== this._sheet().id) return;
    const { range, source } = wait;
    const inside = (area: GridRange, row: number, column: number) =>
      row >= area.rowStart && row <= area.rowEnd && column >= area.columnStart && column <= area.columnEnd;
    // Quanto una cella sta lontana dalla sorgente: i valori arrivano da lì.
    const from = (row: number, column: number) => source
      ? Math.max(0, source.rowStart - row, row - source.rowEnd) + Math.max(0, source.columnStart - column, column - source.columnEnd)
      : (row - range.rowStart) * (range.columnEnd - range.columnStart + 1) + column - range.columnStart;
    const entering: { readonly text: HTMLElement; readonly order: number }[] = [];
    for (const cell of this._plane.querySelectorAll<HTMLElement>(".grid-cell")) {
      const row = Number(cell.dataset.row);
      const column = Number(cell.dataset.column);
      if (!inside(range, row, column) || (source && inside(source, row, column))) continue;
      const text = cell.querySelector<HTMLElement>(".grid-cell-text");
      if (text?.textContent) entering.push({ text, order: from(row, column) });
    }
    entering.sort((a, b) => a.order - b.order);
    enterValues(entering.map((item) => item.text), this._life);
  },

  /// Con `done`, il rifiuto va a chi aspetta invece che nell'avviso. Torna
  /// `false` se la risposta non vale più per la sessione di adesso (riaperta,
  /// o con celle scritte nel frattempo) e non si è applicata.
  async _giveNow(
    this: GridEngine,
    command: GridCommand,
    history: boolean,
    epoch: number,
    edits: number,
    ticket: number,
    done?: (run: GridRun) => void,
  ): Promise<boolean> {
    const host = this._options.grid;
    const state = this._bytes;
    const current = () => !this._destroyed && epoch === this._bytesEpoch && edits === this._editEpoch && this._bytes === state;
    if (!host || !state || !current()) return false;
    let outcome: GridCommandOutcome;
    let session: GridBytesSession;
    try {
      outcome = await host.gridBytesCommand(state.surface, state.instance, { revision: state.session.revision, command });
      if (!current()) return false;
      if (this._readOnly && !emptyEdit(outcome.commit.edit)) {
        // Un comando che doveva soltanto leggere ha cambiato la cartella del
        // provider: in sola lettura non si applica. Il provider riparte dal
        // testo confermato, così la sua cartella torna quella che si vede.
        console.warn(`grid: «${command.id}» ha portato modifiche in sola lettura, scartate`);
        this._openWorkbook(this._confirmedJournal, false);
        done?.({ ok: false, error: null });
        return true;
      }
      session = {
        ...state.session,
        revision: outcome.commit.revision,
        sheets: outcome.sheets,
        hidden: outcome.hidden,
        active: outcome.selection.sheet,
        commands: outcome.commands,
        book: outcome.book,
      };
      validateBytesSession(session);
      this._confirm(applySourceEdit(this._confirmedJournal, outcome.commit.edit));
    } catch (error) {
      if (!current()) return false;
      // Niente da annullare o da ripetere non è un errore da dire.
      if (history && isErrorKind(error, "bad_args")) return true;
      if (done) {
        done({ ok: false, error: errorText(error) });
        return true;
      }
      this._refuse(t("grid.workbook.command_failed", { error: errorText(error) }));
      // La transazione del provider non ha cambiato niente: le celle
      // mostrate in anticipo dalle modifiche in coda restano le sue.
      return true;
    }
    state.session = session;
    this._shownSession = session;
    this._commands = outcome.commands;
    this._bytesMessage = null;
    this._options.onCommands?.();
    const last = ticket === this._bytesTickets;
    if (last) this._publishJournal(this._confirmedJournal, command.id === UNDO ? "undo" : command.id === REDO ? "redo" : "input");
    // Il riempimento mette la selezione su ciò che ha riempito, e i segni ci
    // scivolano dalla sorgente; ogni altra selezione rimessa dall'host salta.
    if (last) this._adoptSelection(outcome.selection, FILL_COMMANDS.has(command.id));
    // Un oggetto appena inserito resta selezionato, come in Excel.
    const inserted = last && command.id.startsWith("insert.") ? insertedObject(outcome.result) : null;
    done?.({ ok: true, result: outcome.result });
    if (outcome.dialog) this._options.onDialog?.(outcome.dialog);
    if (emptyEdit(outcome.commit.edit)) {
      this._showView(this._sheet().id, false);
      return true;
    }
    await this._refreshBytes(state, epoch);
    if (inserted && current() && this._objectByKey(inserted)) this._selectObject(inserted);
    return true;
  },

  /// La selezione che un comando ha lasciato: il foglio, l'intervallo che
  /// contiene la cella attiva e la cella attiva, che è l'àncora quando è un
  /// angolo dell'intervallo. Di solito i segni ci saltano; con `glide` ci
  /// scivolano.
  _adoptSelection(this: GridEngine, selection: GridCommandSelection, glide = false): void {
    const indexOf = () => this._workbook?.sheets.findIndex((sheet) => sheet.id === selection.sheet) ?? -1;
    let index = indexOf();
    // Un comando che ha aggiunto il foglio (Inserisci foglio) lo lascia
    // attivo: la cartella mostrata lo conosce dopo essersi riletta dalla
    // sessione del provider, che lo ha già.
    if (index < 0 && this._shownSession?.sheets.some((sheet) => sheet.id === selection.sheet)) {
      this._showView(this._sheet().id, false);
      index = indexOf();
    }
    const active = parseCellA1(selection.active);
    if (index < 0 || !active) return;
    this._marksJump = !glide;
    const areas = selection.selection.split(",").map(parseRangeA1).filter((area): area is GridRange => area !== null);
    const area = areas.find((candidate) =>
      active.row >= candidate.rowStart && active.row <= candidate.rowEnd
      && active.column >= candidate.columnStart && active.column <= candidate.columnEnd);
    // Gli altri intervalli restano scelti, come li ha lasciati il comando.
    this._others = areas.filter((candidate) => candidate !== area);
    let next: GridSelection = { anchor: active, focus: active };
    if (area) {
      const row = active.row === area.rowStart ? area.rowEnd : area.rowStart;
      const column = active.column === area.columnStart ? area.columnEnd : area.columnStart;
      const corner = (active.row === area.rowStart || active.row === area.rowEnd)
        && (active.column === area.columnStart || active.column === area.columnEnd);
      next = corner
        ? { anchor: active, focus: { row, column } }
        : { anchor: { row: area.rowStart, column: area.columnStart }, focus: { row: area.rowEnd, column: area.columnEnd }, active };
    }
    const sameSheet = index === this._sheetIndex;
    if (
      sameSheet
      && samePosition(next.anchor, this._selection.anchor)
      && samePosition(next.focus, this._selection.focus)
      && samePosition(next.active ?? next.anchor, this._active())
    ) return;
    if (!sameSheet) {
      this._finishEditing(false, "input", false);
      this._sheetIndex = index;
      this._selection = next;
      this._showSheet(true);
      this._sheetTabs?.handle.select(selection.sheet);
      void this._loadViewport();
    }
    this._selection = this._clampedSelection(next);
    this._ensureVisible(this._selection.focus);
    if (!this._editing) this._syncFormulaBar();
    this._render();
    this._options.onSelectionChange();
  },

  /// Rilegge il catalogo sulla selezione, una richiesta alla volta: chi
  /// arriva mentre una è in volo la rifà dopo.
  _loadCommands(this: GridEngine): Promise<void> {
    const state = this._bytes;
    if (!state || !this._commands.length || !this._options.onCommands || this._destroyed) return Promise.resolve();
    if (this._commandsLoad) {
      this._commandsQueued = true;
      return this._commandsLoad;
    }
    const epoch = this._bytesEpoch;
    const load = (async () => {
      try {
        const commands = await this._options.grid!.gridBytesCommands(state.surface, state.instance, this._commandSelection());
        if (this._destroyed || epoch !== this._bytesEpoch || this._bytes !== state) return;
        this._commands = [...commands];
        this._options.onCommands?.();
      } catch {
        // Un catalogo che non si rilegge resta quello di prima.
      }
    })().finally(() => {
      this._commandsLoad = null;
      if (this._commandsQueued) {
        this._commandsQueued = false;
        void this._loadCommands();
      }
    });
    this._commandsLoad = load;
    return load;
  },

  /// Se la sessione è a comandi, o lo sarà quando la coda arriva al provider.
  _commandMode(this: GridEngine): boolean {
    return this._confirmedCommands || this._pendingCommandMode > 0;
  },

  /// Se il catalogo serve il comando `id`.
  _serves(this: GridEngine, id: string): boolean {
    return this._commands.some((command) => command.id === id);
  },

  /// La selezione come la nomina un comando.
  _commandSelection(this: GridEngine): GridCommandSelection {
    return {
      sheet: this._sheet().id,
      selection: [...this._others, this._selectedRange()].map(rangeA1).join(","),
      active: cellA1(this._active()),
    };
  },

  /// Le richieste che cambiano lo stato del provider, una dopo l'altra:
  /// ognuna parte da ciò che ha lasciato la precedente, ed è ciò che rende
  /// [`_confirmedJournal`] la base giusta del diff successivo.
  _enqueueProtocol(this: GridEngine, step: () => Promise<void>): void {
    this._providerCommitTail = this._providerCommitTail
      .catch(() => {})
      .then(step)
      .catch(() => {});
  },
};
export type CommandsMethods = typeof commandsMethods;
