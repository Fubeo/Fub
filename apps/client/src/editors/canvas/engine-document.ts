// Il motore della lavagna: il nucleo, la storia, la compilazione e la
// scrittura del documento. Metodi della classe `CanvasEngine`, montati sul
// suo prototipo da `engine.ts` (`editors/core/mix-methods.ts`).

import { t, type Key } from "../../i18n/strings";
import type { EditorChangeOrigin } from "../core/text-operation";
import { changeAnnouncement } from "./a11y";
import { type CanvasPatch, type CanvasOperation } from "./operation";
import type { CanvasDocument } from "./model";
import {
  CanvasCoreError,
  type CanvasCore,
  changedModel,
  type CanvasCommitted,
  type CanvasCompiled,
  type CanvasCoreErrorCode,
  type CanvasIntentOp,
  type CanvasSourceEdit,
} from "./wasm/core";
import { MAX_INTERACTIVE_NODES, MAX_INTERACTIVE_EDGES, MAX_CANVAS_HISTORY } from "./engine-options";
import { CanvasStep, randomSeed } from "./engine-parts";
import { lostCore, copyPatches, sourceOperation } from "./engine-names";
import type { CanvasEngine } from "./engine";

export const documentMethods = {
  // --- il nucleo --------------------------------------------------------------

  /**
   * Il modello del testo `text` nel nucleo: `reset` della lavagna aperta, o
   * una lavagna nuova. `null` se il nucleo non è carico o è morto (allora
   * serve `_revive`); un testo che il nucleo rifiuta lancia.
   */
  _open(this: CanvasEngine, text: string): CanvasDocument | null {
    if (this._core) {
      try {
        return this._core.reset(text);
      } catch (error) {
        if (!lostCore(error)) throw error;
        this._dropCore();
      }
    }
    let core: CanvasCore | null;
    try {
      core = this._port.openNow(text);
    } catch (error) {
      if (lostCore(error)) return null;
      throw error;
    }
    if (!core) return null;
    this._core = core;
    return core.model();
  },

  /** Il modello del nucleo; `null` se non c'è o se è appena morto (allora si riapre). */
  _coreModel(this: CanvasEngine): CanvasDocument | null {
    const core = this._core;
    if (!core) return null;
    try {
      return core.model();
    } catch (error) {
      if (!lostCore(error)) throw error;
      this._lose();
      return null;
    }
  },

  _dropCore(this: CanvasEngine): void {
    const core = this._core;
    this._core = null;
    try {
      core?.close();
    } catch {
      // Un'istanza morta ha già perso le sue lavagne.
    }
  },

  /** Una trappola: la lavagna si riapre su un'istanza nuova, dal testo della sessione. */
  _lose(this: CanvasEngine): void {
    this._dropCore();
    this._traps += 1;
    // Due di fila: lo si dice, e si riprova soltanto al prossimo testo.
    if (this._traps > 1) {
      this._coreUnavailable();
      return;
    }
    void this._revive();
  },

  async _revive(this: CanvasEngine): Promise<void> {
    const revival = ++this._revival;
    try {
      await this._port.ready();
    } catch {
      if (!this._destroyed && revival === this._revival) this._coreUnavailable();
      return;
    }
    if (this._destroyed || revival !== this._revival || this._core) return;
    let document: CanvasDocument | null;
    try {
      document = this._open(this._source);
    } catch {
      document = null;
    }
    if (!document) {
      this._coreUnavailable();
      return;
    }
    const first = this._doc === null;
    this._doc = document;
    this._checkWritable();
    this._pruneSelection();
    if (first) this._fitCamera(false);
    this._render();
    if (first) {
      this._markOpenView();
      const held = this._heldView;
      if (held) this._restoreView(held.round, held.view);
    }
    if (this._pending) this._recordPending();
  },

  _coreUnavailable(this: CanvasEngine): void {
    this._showNotice(t("canvas.core_unavailable"));
  },

  /**
   * Passa le toppe al nucleo: tutte o nessuna. Il testo nuovo è il tratto che
   * il nucleo ha cambiato; `record` riceve il passo che lo disfa (le toppe
   * inverse dello stesso commit e il tratto di prima) prima che la sessione
   * sappia della modifica (che può tornare qui con un `syncDoc`). Il codice
   * del rifiuto, se il nucleo rifiuta.
   */
  _commitLocal(
    this: CanvasEngine,
    patches: readonly CanvasPatch[],
    origin: EditorChangeOrigin,
    record: ((step: CanvasStep) => void) | null,
    render = true,
  ): true | CanvasCoreErrorCode {
    // Mai una lista vuota: su un sorgente vuoto il nucleo riscriverebbe tutto.
    if (!patches.length) return "request";
    if (this._destroyed || !this._doc || this._readOnly || this._isSceneOversized()) return "rejected";
    const core = this._core;
    if (!core) return "trap";
    const before = this._source;
    let committed: CanvasCommitted;
    try {
      committed = core.commit(patches);
    } catch (error) {
      if (lostCore(error)) {
        this._lose();
        return "trap";
      }
      if (error instanceof CanvasCoreError) return error.code;
      throw error;
    }
    this._traps = 0;
    const { edit } = committed;
    const after = before.slice(0, edit.start) + edit.text + before.slice(edit.end);
    const restores = this._version;
    this._source = after;
    this._version = ++this._versions;
    // Un commit di soli tratti dice che cosa ha cambiato: il modello nuovo
    // si fa da quello di prima, senza rileggere la lavagna intera (T20e).
    const changed = committed.changed && this._doc ? changedModel(this._doc, committed.changed) : null;
    this._doc = changed ?? this._coreModel() ?? this._doc;
    // Una modifica nuova: l'avviso di un togliere di prima se ne va (T17).
    this._dropRemoval();
    const operation: CanvasOperation = {
      kind: "canvas",
      patches: copyPatches(patches),
      ...sourceOperation(before, after, edit),
    };
    record?.({
      patches: committed.inverse,
      back: copyPatches(patches),
      start: edit.start,
      inserted: edit.text,
      removed: before.slice(edit.start, edit.end),
      version: this._version,
      restores,
    });
    this._pruneSelection();
    if (render) this._render();
    this._options.onChange({ text: after, operation, origin });
    return true;
  },

  /**
   * Fa un passo d'annulla o di ripeti. Se il testo è quello che il passo ha
   * lasciato, rimette il suo tratto con un `reset` sul testo esatto (una
   * lettura intera: va bene per un annulla, non per ogni gesto); se no passa
   * le sue toppe al nucleo. `record` riceve il passo opposto.
   */
  _replay(this: CanvasEngine, step: CanvasStep, origin: "undo" | "redo", record: (step: CanvasStep) => void): true | CanvasCoreErrorCode {
    const before = this._source;
    const end = step.start + step.inserted.length;
    // Un passo fatto solo di tratti cambia solo l'inchiostro: si ridisegna lo
    // strato, non le schede.
    const inkOnly = step.patches.length > 0 && step.patches.every((patch) => patch.kind === "ink");
    if (step.version !== this._version || before.slice(step.start, end) !== step.inserted) {
      const code = this._commitLocal(step.patches, origin, record, !inkOnly);
      if (code === true && inkOnly) this._paintInk();
      return code;
    }
    // Il testo esatto del passo torna anche su una scena troppo grande: un
    // passo locale che l'ha portata oltre il limite (un «Incolla codice» di
    // migliaia di schede) si annulla e si ripete, e la lavagna torna
    // interattiva (LIC T25).
    if (this._destroyed || !this._doc || this._readOnly) return "rejected";
    const core = this._core;
    if (!core) return "trap";
    const after = before.slice(0, step.start) + step.removed + before.slice(end);
    let document: CanvasDocument;
    try {
      document = core.reset(after);
    } catch (error) {
      if (lostCore(error)) {
        this._lose();
        return "trap";
      }
      // Il nucleo non riapre il testo di prima (non dovrebbe mai): restano le toppe.
      if (error instanceof CanvasCoreError) {
        const code = this._commitLocal(step.patches, origin, record, !inkOnly);
        if (code === true && inkOnly) this._paintInk();
        return code;
      }
      throw error;
    }
    this._traps = 0;
    this._source = after;
    this._version = step.restores;
    this._doc = document;
    this._dropRemoval();
    const edit: CanvasSourceEdit = { start: step.start, end, text: step.removed };
    const operation: CanvasOperation = {
      kind: "canvas",
      patches: copyPatches(step.patches),
      ...sourceOperation(before, after, edit),
    };
    record({
      patches: step.back,
      back: step.patches,
      start: step.start,
      inserted: step.removed,
      removed: step.inserted,
      version: step.restores,
      restores: step.version,
    });
    this._pruneSelection();
    if (inkOnly) this._paintInk();
    else this._render();
    this._options.onChange({ text: after, operation, origin });
    return true;
  },

  /** Un gesto della tela: prima il testo in sospeso, poi le sue toppe, un passo d'annulla. */
  _commit(this: CanvasEngine, patches: readonly CanvasPatch[], origin: EditorChangeOrigin): boolean {
    this._recordPending();
    const done = this._commitLocal(patches, origin, (step) => this._pushUndo(step, true)) === true;
    // Una scheda tolta, un filo nuovo, una scheda spostata: lo dice la regione
    // viva della tela (T61).
    const said = done && this._doc ? changeAnnouncement(patches, this._doc) : null;
    if (said !== null) this._sayGesture(said);
    return done;
  },

  _pushUndo(this: CanvasEngine, step: CanvasStep, fresh: boolean): void {
    this._undo.push(step);
    if (this._undo.length > MAX_CANVAS_HISTORY) this._undo.shift();
    if (fresh) this._redo = [];
  },

  /** Le toppe delle operazioni d'intento `ops` sul modello di adesso; `null` se il nucleo le rifiuta (lo dice l'avviso). */
  _compileOps(this: CanvasEngine, ops: readonly CanvasIntentOp[]): CanvasPatch[] | null {
    return this._compileIntent(ops, "canvas.ink.refused")?.patches ?? null;
  },

  /** Il seme degli id nuovi di un'azione: quello delle opzioni, o uno a caso. */
  _seed(this: CanvasEngine): bigint {
    return this._options.seed?.() ?? randomSeed();
  },

  /**
   * Compila le operazioni d'intento `ops` sul modello di adesso, dopo aver
   * registrato il testo in sospeso. `null` se la tela non scrive (sola
   * lettura, troppo grande, il nucleo non ancora pronto) o se il nucleo le
   * rifiuta: allora l'avviso `refused` lo dice (nessun avviso con `null`:
   * lo dà chi chiama).
   */
  _compileIntent(this: CanvasEngine, ops: readonly CanvasIntentOp[], refused: Key | null, seed?: bigint): CanvasCompiled | null {
    const core = this._core;
    if (!core || this._destroyed || this._readOnly || this._isSceneOversized()) return null;
    this._recordPending();
    try {
      return core.compile(ops, seed ?? this._seed());
    } catch (error) {
      if (lostCore(error)) {
        this._lose();
        return null;
      }
      if (error instanceof CanvasCoreError) {
        if (refused !== null) this._showNotice(t(refused));
        return null;
      }
      throw error;
    }
  },

  /**
   * Un'azione del menu, della barra, di un campo o di un tasto (T23): le sue
   * operazioni d'intento, compilate dal nucleo e scritte in un passo
   * d'annulla, come le scrive `canvas.apply`. Torna gli id nati (schede, poi
   * fili, come `created`), o `null` se non ha scritto niente: nessuna
   * operazione, nessuna toppa, la tela che non scrive, o il nucleo che le
   * rifiuta (lo dice l'avviso `refused`, o nessuno con `null`, quando lo dà
   * chi chiama). Se il nucleo rifiuta la compilazione o il commit (un limite),
   * i campi della barra tornano al valore del modello. `seed` è quello di un
   * controllo già fatto («Incolla codice»), così gli id nati sono i suoi.
   */
  _writeOps(
    this: CanvasEngine,
    ops: readonly CanvasIntentOp[] | null,
    refused: Key | null = "canvas.change_refused",
    seed?: bigint,
  ): readonly string[] | null {
    if (!ops || ops.length === 0) return null;
    const compiled = this._compileIntent(ops, refused, seed);
    if (!compiled) {
      if (!this._destroyed) this._drawToolbar();
      return null;
    }
    if (compiled.patches.length === 0) return null;
    if (!this._commit(compiled.patches, "input")) {
      if (!this._destroyed) this._drawToolbar();
      return null;
    }
    return compiled.created;
  },
  /**
   * Chiede al nucleo se il testo di adesso si riscrive: un'anteprima senza
   * toppe passa dallo stesso ritocco di ogni commit, e un testo che il
   * ritocco rifiuta (una chiave doppia, anche annidata in un campo
   * sconosciuto) risponde `rejected`. Allora la tela resta da guardare: il
   * campo aperto si chiude come per la sola lettura del pannello, e l'avviso
   * della barra dice perché. Un nucleo assente o morto non risponde: la
   * risposta di prima resta finché `_revive` non riapre il testo.
   */
  _checkWritable(this: CanvasEngine): void {
    const core = this._core;
    if (!core) return;
    let unwritable: boolean;
    try {
      core.preview([]);
      unwritable = false;
    } catch (error) {
      if (lostCore(error)) {
        this._lose();
        return;
      }
      if (!(error instanceof CanvasCoreError)) throw error;
      unwritable = error.code === "rejected";
    }
    if (unwritable === this._unwritable) return;
    if (unwritable) {
      this._unwritable = true;
      this._closeField(true);
      this._cancelGestures();
    } else {
      this._unwritable = false;
    }
    this._root.dataset.readOnly = String(this._readOnly);
    // Subito, anche con una penna giù e il ridisegno rimandato: lo strato se
    // ne va (il tratto in corso si annulla) o torna, e la barra dice perché.
    this._syncInkLayer();
    this._drawToolbar();
  },

  _isSceneOversized(this: CanvasEngine): boolean {
    return !!this._doc && (this._doc.nodes.length > MAX_INTERACTIVE_NODES
      || this._doc.edges.length > MAX_INTERACTIVE_EDGES);
  },
};
export type DocumentMethods = typeof documentMethods;
