// Il motore della lavagna: i tasti, le etichette lette e il fuoco delle
// schede. Metodi della classe `CanvasEngine`, montati sul suo prototipo da
// `engine.ts` (`editors/core/mix-methods.ts`).

import { t } from "../../i18n/strings";
import { focusableElements } from "../../ui/a11y";
import { boardReading, cardLabel, nearestCard, stepInOrder, type BoardReading } from "./a11y";
import { commandForKey, isCommandSearchKey, type CanvasCommand } from "./chrome/commands";
import { type CanvasNode } from "./model";
import { composingKey } from "../../kit/ime";
import { CARD_KEYS, NEAREST_CARD_KEYS, CARD_ONLY_NEAREST_KEYS, LABEL_BATCH } from "./engine-options";
import {
  isInkKey,
  HISTORY_COMMANDS,
  isMenuKey,
  keepsItsUndo,
  isTextTarget,
  CardEntry,
  NARROW_WIDTH,
  NARROW_PANE,
  MENU_ECHO_MS,
} from "./engine-parts";
import type { CanvasEngine } from "./engine";

export const keysMethods = {
  // --- tastiera e lettore di schermo (T61) ------------------------------------

  /** La lettura della lavagna di adesso (`boardReading`): si rifà solo se il documento è cambiato. */
  _boardReading(this: CanvasEngine): BoardReading | null {
    const doc = this._doc;
    if (!doc) return null;
    if (this._reading?.doc !== doc) this._reading = { doc, value: boardReading(doc) };
    return this._reading.value;
  },

  /** I nomi scritti sulle schede sono quelli del documento e della lingua di adesso. */
  _labelsCurrent(this: CanvasEngine): boolean {
    const done = this._labelled;
    return !done.stale && done.doc === this._doc && done.round === this._languageRound;
  },

  /**
   * I nomi delle schede vecchi (un documento nuovo, una scheda nuova, un'altra
   * lingua): li riscrive quando il thread è libero, non durante la resa. La
   * scheda che prende il fuoco prima non aspetta: il suo lo scrive subito.
   */
  _scheduleLabels(this: CanvasEngine): void {
    if (this._labelsPending !== null || this._destroyed || this._labelsCurrent()) return;
    this._labelsPending = this._labelsSchedule(() => this._labelStep());
  },

  /**
   * Un passo del giro dei nomi: `LABEL_BATCH` schede, poi il thread torna
   * libero e il giro riprende dove era. Un documento nuovo, una lingua nuova o
   * una scheda nata nel frattempo lo fanno ricominciare da capo.
   */
  _labelStep(this: CanvasEngine): void {
    this._labelsPending = null;
    const doc = this._doc;
    if (!doc || this._destroyed || this._isSceneOversized()) return;
    let run = this._labelRun;
    if (!run || run.doc !== doc || run.round !== this._languageRound || this._labelled.stale) {
      run = { doc, round: this._languageRound, queue: [...this._cards.values()], at: 0 };
      this._labelled = { doc: null, round: -1, stale: false };
    }
    const end = Math.min(run.queue.length, run.at + LABEL_BATCH);
    for (; run.at < end; run.at++) {
      const entry = run.queue[run.at]!;
      if (this._cards.get(entry.id) === entry) this._labelCard(entry);
    }
    if (run.at < run.queue.length) {
      this._labelRun = run;
      this._labelsPending = this._labelsSchedule(() => this._labelStep());
      return;
    }
    this._labelRun = null;
    this._labelled = { doc, round: run.round, stale: false };
  },

  /** Il nome della scheda `entry` com'è adesso, scritto sul suo nodo se è cambiato. */
  _labelCard(this: CanvasEngine, entry: CardEntry): void {
    const doc = this._doc;
    const reading = this._boardReading();
    if (!doc || !reading) return;
    const label = cardLabel(entry.node, doc, reading);
    if (entry.label === label) return;
    entry.label = label;
    entry.article.setAttribute("aria-label", label);
  },

  /**
   * Sceglie la scheda `node`, la porta in vista e le dà il fuoco: Tab e
   * Alt+frecce. In vista vuol dire tutta dentro la vista; se no la vista vola
   * fino a metterla al centro col zoom di adesso (col movimento ridotto arriva
   * subito). Non è un salto di Indietro e Avanti: è un passo della tastiera,
   * come uno spostamento a mano.
   */
  _focusCard(this: CanvasEngine, node: CanvasNode): void {
    const entry = this._cards.get(node.id);
    if (!entry) return;
    if (this._selection.length !== 1 || this._selection[0] !== node.id || this._edgeSelection.length > 0) {
      this._selection = [node.id];
      this._edgeSelection = [];
      this._options.onSelectionChange();
      this._displaySelection();
    }
    const { view, zoom } = this._viewRect();
    const inside = node.x >= view.x && node.y >= view.y
      && node.x + node.width <= view.x + view.width && node.y + node.height <= view.y + view.height;
    if (!inside) {
      const rect = this._viewport.getBoundingClientRect();
      this._flyCamera({
        x: (rect.width || 800) / 2 - (node.x + node.width / 2) * zoom,
        y: (rect.height || 600) / 2 - (node.y + node.height / 2) * zoom,
        zoom,
      });
    }
    entry.article.focus({ preventScroll: true });
  },

  /**
   * Tab e Maiusc+Tab col fuoco sulla lavagna o su una scheda: la scheda dopo
   * o prima nell'ordine di lettura (T58). Dalla lavagna Tab va alla scheda
   * scelta, o alla prima; Maiusc+Tab dalla lavagna esce come sempre. Prima
   * della prima scheda si torna alla lavagna; dopo l'ultima il fuoco esce
   * dalla vista, verso ciò che la segue. Una lavagna senza schede non prende
   * il Tab: va ai pulsanti della lavagna vuota (T62). `true` se il tasto è suo.
   */
  _tabKey(this: CanvasEngine, event: KeyboardEvent): boolean {
    if (event.key !== "Tab" || event.ctrlKey || event.metaKey || event.altKey) return false;
    if (!this._onCardOrBoard(event.target)) return false;
    const reading = this._boardReading();
    if (!reading || reading.order.length === 0) return false;
    const step = event.shiftKey ? -1 : 1;
    const from = event.target === this._viewport ? null : this._nodeAt(event.target);
    if (from === null && step < 0) return false;
    const next = from === null ? this._selectionFocus() ?? stepInOrder(reading, null, 1) : stepInOrder(reading, from, step);
    if (next) {
      event.preventDefault();
      this._focusCard(next);
      return true;
    }
    if (step < 0) {
      event.preventDefault();
      this._viewport.focus({ preventScroll: true });
      return true;
    }
    const after = this._afterViewport();
    if (!after) return false;
    event.preventDefault();
    after.focus();
    return true;
  },

  /** Il primo elemento che il Tab raggiunge dopo la vista e fuori da lei. */
  _afterViewport(this: CanvasEngine): HTMLElement | null {
    const viewport = this._viewport;
    return focusableElements(document.body).find((el) => !viewport.contains(el)
      && (viewport.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0) ?? null;
  },

  /**
   * Alt+frecce col fuoco sulla lavagna o su una scheda (M1): la scheda più
   * vicina in quella direzione (`nearestCard`), da quella col fuoco o da
   * quella scelta; senza, la prima nell'ordine di lettura. Se da quella parte
   * non c'è niente lo dice la regione viva. Alt+← e Alt+→ solo col fuoco su
   * una scheda: sulla lavagna senza una scheda a fuoco, e fuori, restano
   * Indietro e Avanti dello Scrittoio (`shell.pane.back`/`forward`,
   * DECISIONS.md, T56). Il tasto preso non arriva al registro della shell.
   * `true` se il tasto è suo.
   */
  _nearestKey(this: CanvasEngine, event: KeyboardEvent): boolean {
    if (!event.altKey || event.shiftKey || event.ctrlKey || event.metaKey) return false;
    const direction = NEAREST_CARD_KEYS.get(event.key);
    if (direction === undefined || !this._onCardOrBoard(event.target)) return false;
    if (CARD_ONLY_NEAREST_KEYS.has(event.key) && this._nodeAt(event.target) === null) return false;
    const reading = this._boardReading();
    if (!reading || reading.order.length === 0) return false;
    event.preventDefault();
    event.stopPropagation();
    const fromId = this._nodeAt(event.target) ?? (this._selection.length === 1 ? this._selection[0]! : null);
    const from = fromId === null ? undefined : reading.byId.get(fromId);
    const next = from ? nearestCard(from, reading, direction) : stepInOrder(reading, null, 1);
    if (next) this._focusCard(next);
    else this._sayGesture(t("canvas.a11y.none_that_way"));
    return true;
  },

  _keydown(this: CanvasEngine, event: KeyboardEvent): void {
    if (!this._doc || event.defaultPrevented || composingKey(event) || this._shellKeys.has(event)) return;
    // Col ritaglio aperto Invio lo scrive ed Esc lo chiude, da ogni punto della lavagna (T78).
    if (this._crop?.editor?.key(event)) {
      event.preventDefault();
      return;
    }
    // Spazio tenuto sulla lavagna sposta la vista, anche in una lavagna troppo
    // grande (T53); in un campo o dentro la scheda attiva resta uno spazio.
    if (!(this._activeId !== null && this._insideActive(event.target, false)) && this._holdSpace(event)) return;
    if (this._isSceneOversized()) return;
    // Esc mentre si tira un filo lo lascia, e nient'altro (T67).
    if (event.key === "Escape" && this._connect) {
      event.preventDefault();
      this._cancelConnect();
      return;
    }
    // Esc mentre si trascina o si ridimensiona una scheda ferma il gesto: le
    // schede tornano dov'erano e il file non cambia (T24).
    if (event.key === "Escape" && (this._drag !== null || this._resize !== null)) {
      event.preventDefault();
      this._cancelGestures();
      return;
    }
    // Esc mentre si trascina il rettangolo lo annulla, e la scelta torna com'era (N6 T20b).
    if (event.key === "Escape" && this._marquee !== null) {
      event.preventDefault();
      this._cancelMarquee();
      return;
    }
    // D da solo, fuori dai campi: il mouse scrive finché il tasto è giù
    // (regola 1). La ripetizione del tasto non cambia niente.
    if (isInkKey(event) && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey
      && !isTextTarget(event.target)) {
      if (!event.repeat && !this._inkKeyDown) {
        this._inkKeyDown = true;
        this._applyInkMouse();
      }
      return;
    }
    // Dentro la scheda attiva i tasti sono del contenuto; Esc, se il
    // contenuto non lo usa (un rettangolo di celle che si sta scegliendo),
    // esce e rimette il fuoco sulla scheda.
    if (this._activeId !== null && this._insideActive(event.target, false)) {
      if (event.key === "Escape") {
        event.preventDefault();
        this._leaveCard(true);
      } else if (isCommandSearchKey(event)) {
        // Ctrl+/ si apre anche da dentro la scheda, ed Esc ci torna.
        event.preventDefault();
        this._openCommandSearch();
      }
      return;
    }
    // Il tasto Menu o Maiusc+F10 su una scheda o sulla lavagna: il menu del
    // tasto destro, sulla scelta e accanto a lei (IMP-6301). In un campo resta
    // quello del campo.
    if (isMenuKey(event) && !isTextTarget(event.target)) {
      event.preventDefault();
      this._keyboardMenu(event.target);
      return;
    }
    this._recordPending();
    // Tab e Alt+frecce muovono il fuoco fra le schede (T61): non sono comandi,
    // non cambiano il file.
    if (this._tabKey(event) || this._nearestKey(event)) return;
    const commands = this.commands();
    const where = { writing: isTextTarget(event.target), onBoard: this._onCardOrBoard(event.target) };
    // Prima i tasti con Ctrl o Alt: valgono anche col fuoco in un campo.
    const held = commandForKey(commands, event, { ...where, writing: true });
    if (held) {
      this._runKey(event, held);
      return;
    }
    const focus = this._selectionFocus();
    // La scheda scelta e non attiva riceve le pagine (il PDF), se li vuole.
    if (focus && this._selection.length === 1 && CARD_KEYS.has(event.key) && this._onCardOrBoard(event.target)) {
      const view = this._cards.get(focus.id)?.view;
      let used = false;
      try {
        used = view?.key?.(event) === true;
      } catch (error) {
        console.warn(`canvas: la scheda ${focus.id} non prende il tasto`, error);
      }
      if (used) {
        event.preventDefault();
        return;
      }
    }
    // Poi i tasti che scrivono (Canc, le frecce, Invio, i segni): mai mentre
    // si scrive in un campo.
    const bare = commandForKey(commands, event, where);
    if (bare) this._runKey(event, bare);
  },

  /** Il tasto è del comando `command`: lo prende, e il comando parte se si può. */
  _runKey(this: CanvasEngine, event: KeyboardEvent, command: CanvasCommand): void {
    // Esc senza niente da togliere resta a chi sta fuori (la shell).
    if (command.id === "canvas.escape" && command.disabled() !== null) return;
    event.preventDefault();
    if (command.disabled() === null) command.run();
    this._statusSettle();
  },

  /**
   * Annulla e Ripeti fuori dalla vista (la colonna, la riga delle opzioni, la
   * barra della scelta, il navigatore), come i tasti dello zoom (IMP-6300). Un
   * campo che scrive tiene il suo Ctrl+Z; dentro la vista lo prende `_keydown`.
   */
  _historyKeydown(this: CanvasEngine, event: KeyboardEvent): void {
    if (event.defaultPrevented || composingKey(event) || !this._doc || this._isSceneOversized()) return;
    if (event.target instanceof Node && this._viewport.contains(event.target)) return;
    if (keepsItsUndo(event.target)) return;
    const history = this.commands().filter((command) => HISTORY_COMMANDS.has(command.id));
    const command = commandForKey(history, event, { writing: false, onBoard: false });
    if (command) this._runKey(event, command);
  },

  /**
   * Il menu del tasto destro aperto dalla tastiera (IMP-6301): lo stesso
   * `contextmenu` che il riquadro apre col tasto destro, ma senza un punto
   * (`clientX`/`clientY` a zero, nessun tasto del mouse), così il menu va sulla
   * scelta e si apre accanto a lei. Un `contextmenu` che il sistema mandasse
   * subito dopo per lo stesso tasto non ne apre un secondo.
   */
  _keyboardMenu(this: CanvasEngine, target: EventTarget | null): void {
    const from = target instanceof Element && this._viewport.contains(target) ? target : this._viewport;
    const menu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, composed: true, button: 0 });
    this._ownMenu = menu;
    try {
      from.dispatchEvent(menu);
    } finally {
      this._ownMenu = null;
    }
    this._menuEchoUntil = performance.now() + MENU_ECHO_MS;
  },

  /**
   * Stretta (la finestra fino a 700 px, o il riquadro fino a 480): la colonna
   * va sotto la lavagna, in riga, come nel disegno.
   */
  _syncNarrow(this: CanvasEngine): void {
    const width = this._root.clientWidth;
    if (width === 0) return;
    const narrow = width <= NARROW_PANE || window.innerWidth <= NARROW_WIDTH;
    if (narrow === this._root.hasAttribute("data-narrow")) return;
    this._root.toggleAttribute("data-narrow", narrow);
    this._rail.setNarrow(narrow);
    // «Apri a lato» diventa «Apri qui» e al contrario (T45).
    this._canvasOptions.sync();
  },
};
export type KeysMethods = typeof keysMethods;
