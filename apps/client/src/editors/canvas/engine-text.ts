// Il motore della lavagna: il testo di una scheda, la scrittura e il testo
// dal vivo. Metodi della classe `CanvasEngine`, montati sul suo prototipo da
// `engine.ts` (`editors/core/mix-methods.ts`).

import { t } from "../../i18n/strings";
import { openLifetime } from "../../ui/lifetime";
import { type CardTextEditor } from "../core/cards/contract";
import { cardTitle } from "./a11y";
import { isCommandSearchKey } from "./chrome/commands";
import { isBareKey } from "./chrome/workspace";
import { type CanvasDocument, type CanvasNode } from "./model";
import { CanvasCoreError, type CanvasCompiled, type CanvasCoreErrorCode, type CanvasIntentOp } from "./wasm/core";
import { composingKey } from "../../kit/ime";
import { CARD_PAUSE_MS, MAX_CARD_TEXT_BYTES, utf8 } from "./engine-options";
import { CardField, CardEditor, CanvasStep, PendingText } from "./engine-parts";
import { TEXT_CARD_HEIGHT, NEXT_CARD_GAP, measureWriting, freeSpot } from "./engine-geometry";
import { setOp, withPending, passesToShell, lostCore } from "./engine-names";
import type { CanvasEngine } from "./engine";

export const textMethods = {
  // --- il testo di una scheda ---------------------------------------------------

  /**
   * Registra il testo in sospeso: un commit, una modifica alla sessione, un
   * passo d'annulla. `false` se resta da registrare (il nucleo l'ha rifiutato:
   * il testo resta nel campo, e l'avviso dice perché).
   */
  _recordPending(this: CanvasEngine): boolean {
    clearTimeout(this._pauseTimer);
    this._pauseTimer = undefined;
    const pending = this._pending;
    if (!pending) return true;
    if (!this._doc || this._readOnly || this._destroyed) return false;
    // La misura del testo com'è adesso: l'ultimo tasto può non averla ancora data (T44).
    const editor = this._editor;
    if (editor && editor.id === pending.card.id && !editor.composing) this._growWriting(editor);
    let code = "rejected" as true | CanvasCoreErrorCode;
    for (let attempt = 0; attempt < 2 && code !== true; attempt++) {
      const doc: CanvasDocument = this._doc;
      // La scheda com'è adesso; se non c'è più, com'era, col testo del campo.
      const current = doc.nodes.find((node) => node.id === pending.card.id);
      if (current) pending.card = current;
      const next = withPending(pending.card, pending);
      // Il campo scrive con le operazioni (T23): `set` dei campi cambiati, o
      // la scheda intera se intanto è sparita.
      const op = current ? setOp(current, next) : { op: "add_card", node: next };
      const compiled = op ? this._compileField(op) : { patches: [] };
      if (typeof compiled === "string") {
        code = compiled;
        break;
      }
      if (compiled.patches.length === 0) {
        this._setPending(null);
        return true;
      }
      code = this._commitLocal(compiled.patches, "input", (step) => {
        this._setPending(null);
        this._pushUndo(step, true);
      });
      // Il testo è cambiato da un'altra parte: si riprova sulla scheda di adesso.
      const fresh = code === "stale" ? this._coreModel() : null;
      if (!fresh) break;
      this._doc = fresh;
    }
    if (code === true) {
      if (this._intakeError) this._showNotice("");
      return true;
    }
    if (code === "invalid" || code === "limit") {
      this._showNotice(t(pending.field === "text" && utf8.encode(pending.text).length > MAX_CARD_TEXT_BYTES
        ? "canvas.card_too_long" : "canvas.card_invalid"));
    }
    return false;
  },

  /**
   * Compila l'operazione del campo di una scheda, senza registrare il testo
   * in sospeso (è lui che si registra): le toppe, o il codice del rifiuto.
   * Un'operazione che il nucleo non accetta vale come una scheda che il
   * formato non accetta (`invalid`): l'avviso del campo lo dice.
   */
  _compileField(this: CanvasEngine, op: CanvasIntentOp): CanvasCompiled | CanvasCoreErrorCode {
    const core = this._core;
    if (!core) return "trap";
    if (this._isSceneOversized()) return "rejected";
    try {
      return core.compile([op], this._seed());
    } catch (error) {
      if (lostCore(error)) {
        this._lose();
        return "trap";
      }
      if (error instanceof CanvasCoreError) return error.code === "op" ? "invalid" : error.code;
      throw error;
    }
  },

  /** La `set` del testo `text` nella scheda di testo `id`, come la registra il suo campo. */
  _textOps(this: CanvasEngine, id: string, text: string): CanvasIntentOp[] | null {
    const node = this._doc?.nodes.find((one) => one.id === id);
    if (!node) return null;
    const op = setOp(node, { ...node, text });
    return op ? [op] : null;
  },

  /**
   * Chiude il campo aperto, dopo averne registrato il testo. Se il nucleo lo
   * rifiuta il campo resta aperto col suo testo, a meno di `force` (la
   * superficie si chiude, o diventa di sola lettura): allora quel testo si
   * perde, e l'avviso l'ha già detto.
   */
  _closeField(this: CanvasEngine, force: boolean): boolean {
    const recorded = this._recordPending();
    if (!recorded && !force) return false;
    this._setPending(null);
    const editor = this._editor;
    if (!editor) return true;
    this._editor = null;
    editor.lifetime.abort();
    editor.input.disabled = true;
    // L'editor delle note si smonta con la vita del campo; qui anche se la
    // porta non l'avesse legato a quella vita.
    editor.live?.destroy();
    editor.live = null;
    // La scheda nuova lasciata vuota se ne va (T44).
    if (editor.born && recorded) this._dropBlankBorn(editor.id, editor.born);
    return true;
  },

  /**
   * Esc, Invio, l'uscita dal campo: registra e chiude. Con `choose` (Esc) la
   * scheda resta scelta: un secondo Esc toglie la scelta (T44).
   */
  _leaveField(this: CanvasEngine, focus: boolean, choose = false): void {
    const id = this._editor?.id;
    if (!this._closeField(false)) return;
    if (choose && id !== undefined && this._doc?.nodes.some((node) => node.id === id)
      && (this._selection.length !== 1 || this._selection[0] !== id || this._edgeSelection.length > 0)) {
      this._selection = [id];
      this._edgeSelection = [];
      this._options.onSelectionChange();
    }
    this._render();
    if (focus) this._viewport.focus();
  },

  /**
   * La scheda `id`, nata adesso col passo `born`, se è rimasta senza testo se
   * ne va senza lasciare un passo d'annulla («Ho creato schede vuote per
   * sbaglio», T44): si disfano la nascita e ciò che dopo ha toccato solo lei
   * (il testo scritto e poi cancellato), e il testo torna ai byte di prima. Se
   * nel frattempo un altro passo ha cambiato altro, la si toglie come
   * «Togli dalla lavagna», col suo passo. Una scheda che c'era già non passa
   * di qui: resta anche vuota.
   */
  _dropBlankBorn(this: CanvasEngine, id: string, born: CanvasStep): void {
    const node = this._doc?.nodes.find((one) => one.id === id);
    if (!node || node.type !== "text" || (node.text ?? "").trim() !== "") return;
    const at = this._undo.lastIndexOf(born);
    const after = at < 0 ? [] : this._undo.slice(at + 1);
    if (at < 0 || !after.every((step) => step.back.every((patch) => patch.kind === "upsert-node" && patch.after.id === id))) {
      this._removeNodes([id], []);
      return;
    }
    while (this._undo.length > at) {
      const step = this._undo.pop()!;
      if (this._replay(step, "undo", () => {}) !== true) {
        // Il nucleo non lo prende (sola lettura, una trappola): la scheda resta.
        this._undo.push(step);
        return;
      }
    }
  },

  _setPending(this: CanvasEngine, next: PendingText | null): void {
    const had = this._pending !== null;
    this._pending = next;
    // Ogni tasto conta: la sessione arma la bozza su ogni cambio, non solo sul primo.
    if (next || had) this._options.onPendingChange?.(next !== null);
  },

  _schedulePause(this: CanvasEngine): void {
    clearTimeout(this._pauseTimer);
    this._pauseTimer = setTimeout(() => {
      this._pauseTimer = undefined;
      this._deferPending();
    }, CARD_PAUSE_MS);
  },

  /**
   * Registra il testo in sospeso adesso o, con una penna giù, quando si alza:
   * il commit ridisegna le schede. Il tratto, quando finisce, lo registra da sé
   * prima di scriversi.
   */
  _deferPending(this: CanvasEngine): void {
    if (this._destroyed) return;
    this._quiet.defer("pending", () => {
      if (!this._destroyed) this._recordPending();
    });
  },

  _showNotice(this: CanvasEngine, text: string): void {
    if (this._destroyed || this._intakeError === text) return;
    this._intakeError = text;
    this._drawToolbar();
  },

  _pruneSelection(this: CanvasEngine): void {
    if (!this._doc) {
      this._selection = [];
      this._edgeSelection = [];
      return;
    }
    const nodes = new Set(this._doc.nodes.map((n) => n.id));
    const edges = new Set(this._doc.edges.map((e) => e.id));
    this._selection = this._selection.filter((id) => nodes.has(id));
    this._edgeSelection = this._edgeSelection.filter((id) => edges.has(id));
  },

  _selectedNodes(this: CanvasEngine): CanvasNode[] {
    if (!this._doc) return [];
    const byId = new Map(this._doc.nodes.map((n) => [n.id, n]));
    return this._selection.map((id) => byId.get(id)!).filter(Boolean);
  },

  /**
   * Apre il campo della scheda `target`. `born` è il passo che l'ha appena
   * messa per scriverci (lo strumento Testo, Ctrl+Invio): lasciata vuota, se
   * ne va con lui (T44).
   */
  _beginCardEdit(this: CanvasEngine, target: CanvasNode, born: CanvasStep | null = null, point: { x: number; y: number } | null = null): void {
    if (this._readOnly || !this._doc) return;
    const node = this._doc.nodes.find((candidate) => candidate.id === target.id);
    if (!node) return;
    if (this._editor) {
      if (this._editor.id === node.id) return;
      // Il testo dell'altra scheda si registra prima; se non si può, resta lì.
      if (!this._closeField(false)) return;
      this._render();
    }
    const entry = this._cards.get(node.id);
    if (!entry || entry.article.parentElement !== this._stage) return;
    const { article, body } = entry;
    // Il campo prende il posto del corpo: la vista o il Markdown si smontano,
    // e il corpo si rifà alla prima resa dopo che il campo si chiude. Anche il
    // «file mancante» e il suo ascolto se ne vanno: alla chiusura il file si chiede di nuovo.
    this._releaseBody(entry);
    entry.missingFor = null;
    const field: CardField = node.type === "text" ? "text" : node.type === "group" ? "label" : node.type === "link" ? "url" : "file";
    const input = node.type === "text" ? document.createElement("textarea") : document.createElement("input");
    input.className = node.type === "text" ? "canvas-text-editor" : "canvas-field-editor";
    input.value = node[field] ?? "";
    input.setAttribute("aria-label", t("canvas.edit_text", { card: cardTitle(node) }));
    const lifetime = new AbortController();
    const editor: CardEditor = {
      id: node.id, field, input, place: input, live: null, article, lifetime, composing: false, recordOnInput: false,
      born, grown: null, point,
    };
    this._editor = editor;
    // Mentre si scrive nella scheda la barra della selezione non c'è (T51).
    this._syncSelectionBar();
    // Il campo semplice ha i suoi ascolti: smettono quando l'editor delle note
    // lo sostituisce (T43), o quando il campo si chiude.
    const simple = new AbortController();
    lifetime.signal.addEventListener("abort", () => simple.abort(), { once: true });
    const signal = simple.signal;
    // Il testo resta qui finché non c'è una pausa: niente commit per tasto.
    input.addEventListener("input", () => this._fieldText(editor, node, input.value), { signal });
    // Durante la composizione (IME) la pausa non corre: conta dalla fine.
    input.addEventListener("compositionstart", () => this._fieldComposing(editor), { signal });
    input.addEventListener("compositionend", () => this._fieldComposed(editor, node, input.value), { signal });
    input.addEventListener("keydown", (event) => {
      if (!(event instanceof KeyboardEvent)) return;
      // Col campo aperto i tasti, Ctrl+Z compreso, sono del campo; un tasto
      // della shell che il campo non usa (Ctrl+W) sale, la tela no.
      if (passesToShell(event)) this._shellKeys.add(event);
      else event.stopPropagation();
      editor.recordOnInput = false;
      if (composingKey(event) || editor.composing) return;
      if (isCommandSearchKey(event)) {
        // Ctrl+/ si apre anche mentre si scrive; Esc torna nel campo.
        event.preventDefault();
        this._openCommandSearch();
      } else if (isBareKey(event)) {
        // Il campo non usa Ctrl+.: nasconde l'interfaccia, e si resta a scrivere (T65).
        event.preventDefault();
        this._workspace.setBare(!this._workspace.bare);
      } else if (event.key === "Escape") {
        event.preventDefault();
        this._leaveField(true, true);
      } else if (event.key === "Enter") {
        if (field === "text" && !event.ctrlKey && !event.metaKey) {
          // L'a capo entra nel campo, e con lui il testo si registra.
          editor.recordOnInput = true;
          return;
        }
        event.preventDefault();
        // Ctrl+Invio in una scheda di testo apre la scheda dopo (T44); negli altri campi chiude (A15).
        if (field === "text") this._writeNext(event.shiftKey);
        else this._leaveField(true);
      }
    }, { signal });
    // Il fuoco che va nella ricerca dei comandi non chiude il campo: ci torna.
    input.addEventListener("blur", () => {
      if (!this._searching) this._leaveField(false);
    }, { signal });
    body.replaceChildren(input);
    input.focus();
    if (node.type === "text") input.setSelectionRange(input.value.length, input.value.length);
    else input.select();
    // La scheda di testo si scrive come una nota (T43): l'editor delle note
    // prende il posto del campo appena si monta; se non si monta, il campo resta.
    if (node.type === "text") this._openLiveText(editor, node, body, simple, false);
  },

  /**
   * Il testo del campo è cambiato: va nel testo in attesa (la bozza lo vede
   * subito), e il commit arriva dopo la pausa, o subito dopo un a capo.
   */
  _fieldText(this: CanvasEngine, editor: CardEditor, node: CanvasNode, text: string): void {
    if (this._editor !== editor) return;
    const card = this._doc?.nodes.find((candidate) => candidate.id === node.id) ?? this._pending?.card ?? node;
    // La scheda di testo cresce col testo (T44); durante una composizione no:
    // la misura arriva con la sua fine.
    if (!editor.composing) this._growWriting(editor, card);
    this._setPending({ card, field: editor.field, text, ...(editor.grown ? { size: editor.grown } : {}) });
    if (editor.composing) return;
    if (editor.recordOnInput) {
      editor.recordOnInput = false;
      this._recordPending();
      return;
    }
    this._schedulePause();
  },

  /**
   * La scheda di testo che si scrive cresce col testo (T44): in larghezza
   * fino a `CANVAS_TEXT_FIT_MAX_WIDTH`, se nessuno l'ha ridimensionata a mano,
   * poi va a capo e cresce in altezza; da sola non si restringe mai. La misura
   * si vede subito, sta in `editor.grown` e nel testo in sospeso, e arriva al
   * `.canvas` col commit del testo.
   */
  _growWriting(this: CanvasEngine, editor: CardEditor, card?: CanvasNode): void {
    if (editor.field !== "text") return;
    const node = card ?? this._doc?.nodes.find((candidate) => candidate.id === editor.id) ?? this._pending?.card;
    if (!node || node.type !== "text") return;
    const measured = measureWriting(editor.article, editor.place, this._sizedByHand.has(node.id));
    if (!measured) return;
    const before = editor.grown ?? node;
    const width = Math.max(before.width, node.width, measured.width);
    const height = Math.max(before.height, node.height, measured.height);
    if (editor.grown?.width === width && editor.grown.height === height) return;
    if (!editor.grown && width === node.width && height === node.height) return;
    editor.grown = { width, height };
    editor.article.style.width = `${width}px`;
    editor.article.style.height = `${height}px`;
    const pending = this._pending;
    if (pending && pending.card.id === editor.id) pending.size = editor.grown;
  },

  /**
   * Ctrl+Invio in una scheda di testo (T44, allarga A15): registra, chiude e
   * apre una scheda di testo nuova, già in scrittura, larga come questa, a
   * `NEXT_CARD_GAP` sotto; con `beside` (Ctrl+Maiusc+Invio) a destra,
   * collegata con un filo. In una scheda nuova ancora vuota non fa niente:
   * è già la scheda nuova.
   */
  _writeNext(this: CanvasEngine, beside: boolean): void {
    const editor = this._editor;
    if (!editor || this._readOnly || !this._doc) return;
    const id = editor.id;
    if (editor.born) {
      const text = this._pending?.card.id === id ? this._pending.text : this._doc.nodes.find((node) => node.id === id)?.text;
      if ((text ?? "").trim() === "") return;
    }
    if (!this._closeField(false)) return;
    this._render();
    const source = this._doc?.nodes.find((node) => node.id === id);
    const placed = source ? this._addTextNext(source, beside) : null;
    if (!placed) {
      this._viewport.focus();
      return;
    }
    this._render();
    this._beginCardEdit(placed, this._undo[this._undo.length - 1] ?? null);
  },

  /**
   * La scheda di testo vuota accanto a `source` (sotto, o a destra con
   * `beside` e un filo da lei), al primo posto libero; un commit e un passo
   * d'annulla. Torna la scheda messa, scelta, o `null`.
   */
  _addTextNext(this: CanvasEngine, source: CanvasNode, beside: boolean): CanvasNode | null {
    const doc = this._doc;
    if (!doc || this._readOnly) return null;
    const spot = freeSpot(doc.nodes, beside
      ? { x: source.x + source.width + NEXT_CARD_GAP, y: source.y, width: source.width, height: TEXT_CARD_HEIGHT }
      : { x: source.x, y: source.y + source.height + NEXT_CARD_GAP, width: source.width, height: TEXT_CARD_HEIGHT });
    // Il posto lo sceglie la tela (`freeSpot`, larga come la scheda di
    // partenza): la scheda nasce con `add_card` e il suo `id`, il filo con
    // `connect`, in una lista sola (T24).
    const id = this._newId();
    const ops: CanvasIntentOp[] = [{ op: "add_card", id, text: "", ...spot }];
    if (beside) {
      const edge = this._connectOps(source.id, id, { from: "right", to: "left" }, id);
      if (edge) ops.push(...edge);
    }
    const written = this._writeOps(ops)?.[0];
    const node = written === undefined ? undefined : this._doc?.nodes.find((one) => one.id === written);
    if (!node) return null;
    this._selection = [node.id];
    this._edgeSelection = [];
    this._options.onSelectionChange();
    return node;
  },

  _fieldComposing(this: CanvasEngine, editor: CardEditor): void {
    if (this._editor !== editor) return;
    editor.composing = true;
    clearTimeout(this._pauseTimer);
    this._pauseTimer = undefined;
  },

  _fieldComposed(this: CanvasEngine, editor: CardEditor, node: CanvasNode, text: string): void {
    if (this._editor !== editor) return;
    editor.composing = false;
    editor.recordOnInput = false;
    this._fieldText(editor, node, text);
  },

  /**
   * Monta l'editor delle note in Live sopra il testo della scheda (T43), dalla
   * porta delle schede: la tela non importa nessun editor. Finché non c'è si
   * scrive nel campo semplice; se nel frattempo lì è cambiato qualcosa, si
   * riapre una volta sul testo di adesso. Se la porta dice no, il campo resta.
   */
  _openLiveText(this: CanvasEngine, editor: CardEditor, node: CanvasNode, body: HTMLElement, simple: AbortController, again: boolean): void {
    const port = this._options.cards?.editors;
    if (!port?.openText || this._editor !== editor) return;
    const host = document.createElement("div");
    // L'aspetto della nota che si scrive in una scheda (T41). Il contenitore è
    // alto quanto il corpo e non trabocca: il testo scorre nell'editor, e ciò
    // che l'editor tiene sotto di sé per la Lettura resta fuori dalla vista.
    host.className = "canvas-card-note canvas-text-live";
    host.style.height = "100%";
    host.style.overflow = "hidden";
    host.hidden = true;
    body.append(host);
    const life = openLifetime();
    editor.lifetime.signal.addEventListener("abort", () => life.close(), { once: true });
    const giveUp = (): void => {
      life.close();
      host.remove();
    };
    const start = editor.input.value;
    let opened: Promise<CardTextEditor | null>;
    try {
      opened = port.openText(host, start, {
        // Solo ciò che si scrive nell'editor che si vede.
        onText: (text) => {
          if (editor.place === host) this._fieldText(editor, node, text);
        },
        readOnly: this._readOnly,
        lifetime: life,
        documentId: this._options.documentId ?? "",
        ...(this._forms ? { forms: this._forms } : {}),
      });
    } catch (error) {
      console.warn(`canvas: l'editor delle note non si monta nella scheda ${node.id}`, error);
      giveUp();
      return;
    }
    void opened.then((live) => {
      if (!live) {
        giveUp();
        return;
      }
      if (this._editor !== editor || life.closed) {
        live.destroy();
        giveUp();
        return;
      }
      if (editor.input.value !== start) {
        live.destroy();
        giveUp();
        if (!again) this._openLiveText(editor, node, body, simple, true);
        return;
      }
      this._showLiveText(editor, node, live, host, simple);
    }, (error: unknown) => {
      console.warn(`canvas: l'editor delle note non si monta nella scheda ${node.id}`, error);
      giveUp();
    });
  },

  /**
   * L'editor delle note prende il posto del campo semplice, col cursore dove
   * era. I tasti restano dell'editor (Ctrl+Z annulla lì); Esc, se non chiude
   * dei suggerimenti, e Ctrl+Invio registrano e chiudono (A14, A15); Invio va a capo e
   * registra; il fuoco che esce dall'editor chiude, come per il campo.
   */
  _showLiveText(this: CanvasEngine, editor: CardEditor, node: CanvasNode, live: CardTextEditor, host: HTMLElement, simple: AbortController): void {
    const input = editor.input;
    const focused = document.activeElement === input;
    const caret = input.selectionEnd ?? input.value.length;
    // Gli ascolti del campo smettono prima che esca: toglierlo col fuoco non lo chiude.
    simple.abort();
    editor.live = live;
    editor.place = host;
    const signal = editor.lifetime.signal;
    // Esc chiude prima un elenco di suggerimenti aperto nell'editor; se no esce.
    // L'editor delle note usa Esc anche per altro (lo segna come usato): non
    // conta, come nella scheda di nota (T41).
    let escapeForEditor = false;
    host.addEventListener("keydown", (event) => {
      if (!(event instanceof KeyboardEvent)) return;
      editor.recordOnInput = false;
      escapeForEditor = false;
      if (composingKey(event) || editor.composing) return;
      if (event.key === "Escape") {
        // Il menu «/» galleggia fuori dalla scheda: lo dice l'editor stesso
        // (`aria-haspopup`), finché è aperto.
        escapeForEditor = host.querySelector('[role="listbox"], [aria-haspopup="listbox"]') !== null;
      } else if (isCommandSearchKey(event)) {
        event.preventDefault();
        event.stopPropagation();
        this._openCommandSearch();
      } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        // Prima dell'editor, che non deve farne un a capo: la scheda dopo (T44).
        event.preventDefault();
        event.stopPropagation();
        this._writeNext(event.shiftKey);
      } else if (event.key === "Enter") {
        // L'a capo che l'editor scrive si registra subito, come nel campo.
        editor.recordOnInput = true;
      }
    }, { signal, capture: true });
    host.addEventListener("keydown", (event) => {
      // I tasti sono dell'editor, Ctrl+Z compreso: la tela non li vede. Un
      // tasto della shell che l'editor non ha usato (Ctrl+W) sale fino a lei,
      // e la tela lo lascia passare.
      if (event instanceof KeyboardEvent && passesToShell(event)) this._shellKeys.add(event);
      else event.stopPropagation();
      if (!(event instanceof KeyboardEvent) || composingKey(event) || editor.composing) return;
      if (event.key === "Escape" && !escapeForEditor) {
        event.preventDefault();
        this._leaveField(true, true);
      } else if (!event.defaultPrevented && isBareKey(event)) {
        // Ctrl+. che l'editor non usa nasconde l'interfaccia (T65).
        event.preventDefault();
        this._workspace.setBare(!this._workspace.bare);
      }
    }, { signal });
    host.addEventListener("compositionstart", () => this._fieldComposing(editor), { signal });
    host.addEventListener("compositionend", () => this._fieldComposed(editor, node, live.text()), { signal });
    // Il fuoco che va nella ricerca dei comandi non chiude il campo: ci torna.
    host.addEventListener("focusout", (event) => {
      const next = event.relatedTarget;
      if (next instanceof Node && host.contains(next)) return;
      if (!this._searching) this._leaveField(false);
    }, { signal });
    // Portare il cursore in vista non sposta il contenitore: scorre l'editor.
    host.addEventListener("scroll", () => {
      if (host.scrollTop !== 0) host.scrollTop = 0;
      if (host.scrollLeft !== 0) host.scrollLeft = 0;
    }, { signal });
    input.remove();
    host.hidden = false;
    // Il cursore dove era il doppio clic, se nel campo non si è ancora scritto
    // niente; se no (o fuori dal testo) dov'era nel campo (IMP-3808).
    const untouched = input.value === (node.text ?? "");
    if (focused && !(untouched && editor.point && live.focusAtPoint?.(editor.point))) live.focus(caret);
  },
};
export type TextMethods = typeof textMethods;
