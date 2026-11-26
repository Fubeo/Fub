// Il motore della lavagna: entrare e uscire da una scheda, seguire un link.\n// Metodi della\n// classe `CanvasEngine`, montati sul suo prototipo da `engine.ts`\n// (`editors/core/mix-methods.ts`).

import { t } from "../../i18n/strings";
import { cardKindOf, type CardEditorContext, type CardEditorState, type CardWriting } from "../core/cards/contract";
import { saveStateKey } from "../../state/saving";
import { cardTarget } from "./sources";
import { cardFormulaBar } from "../core/formula-bar";
import { noteHeadingOf } from "../core/cards/kinds/note";
import { type CanvasNode } from "./model";
import { FileShowing, CardLinkRef } from "./engine-options";
import { CardEntry, BESIDE_HERE_NAMES, CARD_FLASH_MS } from "./engine-parts";
import { overlaps } from "./engine-geometry";
import { cardLinkOf, linkedCardOf } from "./engine-names";
import type { CanvasEngine } from "./engine";

export const cardOpenMethods = {
  // --- entrare e uscire (T14) ---------------------------------------------------

  /** La scheda ha la vista di un renderer, e non è il segnaposto di un file mancante. */
  _hasLiveContent(this: CanvasEngine, entry: CardEntry): boolean {
    return entry.view !== null && entry.article.dataset.cardMissing === undefined;
  },

  /**
   * `target` sta nella scheda attiva: in tutta la scheda, o solo nel corpo
   * (`bodyOnly`), dove sta il contenuto della vista.
   */
  _insideActive(this: CanvasEngine, target: EventTarget | null, bodyOnly: boolean): boolean {
    const id = this._activeId;
    if (id === null || !(target instanceof Node)) return false;
    const entry = this._cards.get(id);
    if (!entry) return false;
    return (bodyOnly ? entry.body : entry.article).contains(target);
  },

  /** Il tasto arriva alla lavagna o a una scheda col fuoco, non a un campo o al contenuto. */
  _onCardOrBoard(this: CanvasEngine, target: EventTarget | null): boolean {
    return target === this._viewport || (target instanceof HTMLElement && target.classList.contains("canvas-node"));
  },

  /** Il link sotto `target`, se sta nel contenuto della vista di una scheda. */
  _cardLinkAt(this: CanvasEngine, target: EventTarget | null): HTMLAnchorElement | null {
    if (!(target instanceof Element)) return null;
    const id = this._nodeAt(target);
    const entry = id === null ? undefined : this._cards.get(id);
    if (!entry || !this._hasLiveContent(entry)) return null;
    const link = target.closest("a");
    return link !== null && entry.body.contains(link) ? link : null;
  },

  /**
   * Il clic nel contenuto di una scheda, prima che lo veda il contenuto.
   * Dentro la scheda attiva passa. Fuori, Ctrl+clic (Cmd+clic) su un link
   * passa e il link si segue (D-18 (c)); un pulsante della vista passa (il
   * suo «Apri»); ogni altro clic si ferma qui (A-12: sceglie, non segue), e
   * se la scheda era già la sola scelta prima del clic ci entra. Un link che
   * porta a un file del vault lo segue la tela (T57), non la montatura.
   */
  _cardClick(this: CanvasEngine, event: MouseEvent): void {
    const pressed = this._pressedSelected;
    this._pressedSelected = null;
    const target = this._targetOf(event);
    if (event.button !== 0 || !(target instanceof Element)) return;
    const id = this._nodeAt(target);
    const entry = id === null ? undefined : this._cards.get(id);
    if (!id || !entry || !this._hasLiveContent(entry) || !entry.body.contains(target)) return;
    if (this._crop?.editor?.contains(target)) return;
    const modifier = event.ctrlKey || event.metaKey;
    if ((modifier || this._activeId === id) && this._followCardLink(event, entry)) return;
    if (this._activeId === id) return;
    if (modifier && this._cardLinkAt(target) !== null) return;
    const button = target.closest("button");
    if (button !== null && entry.body.contains(button) && !modifier) return;
    event.preventDefault();
    event.stopPropagation();
    if (!modifier && !event.shiftKey && !event.altKey && pressed === id) this._enterCard(id);
  },

  // --- seguire un link (T57) ----------------------------------------------------

  /**
   * Il clic su un link di una scheda che porta a un file del vault (T57): la
   * tela lo prende (`preventDefault`, `stopPropagation`) e lo segue con
   * `_openCardLink`. `false` se il link non è di quelli (un indirizzo web, un
   * link senza `resolveCardLink`): allora vale la montatura di sempre.
   */
  _followCardLink(this: CanvasEngine, event: MouseEvent, entry: CardEntry): boolean {
    const target = this._targetOf(event);
    if (!this._options.resolveCardLink || !(target instanceof Element)) return false;
    const anchor = this._cardLinkAt(target);
    const link = anchor === null ? null : cardLinkOf(anchor);
    if (link === null) return false;
    event.preventDefault();
    event.stopPropagation();
    const node = entry.node;
    const from = node.type === "file" && node.file ? node.file : this._options.documentId;
    void this._openCardLink(link, from).catch((error: unknown) => this._showIntakeError(error));
    return true;
  },

  /**
   * Segue un link di una scheda (T57). Se il file a cui punta ha una scheda su
   * questa lavagna, la vista vola fino a lei e la scheda lampeggia (con
   * `_jumpCamera`, dunque Indietro torna qui). Altrimenti il file si apre
   * accanto, come il wikilink di una nota. Un link rotto va dove va quello delle
   * note: il riquadro, che per un wikilink crea la nota che manca.
   */
  async _openCardLink(this: CanvasEngine, link: CardLinkRef, from: string | undefined): Promise<void> {
    const resolve = this._options.resolveCardLink;
    if (!resolve) return;
    const doc = await resolve(link, from);
    // La lavagna chiusa mentre la shell risolveva: il link non porta più a niente.
    if (this._destroyed) return;
    if (doc === null) {
      if (link.kind === "wiki") await this._options.onOpenWikilink?.(link.page, link.heading, link.block);
      else await this._options.onOpenPath?.(link.path, from);
      return;
    }
    const node = linkedCardOf(this._doc?.nodes ?? [], doc, link, this._viewCenter());
    if (node) {
      this._jumpToCard(node);
      return;
    }
    if (link.kind === "wiki") await (this._options.onOpenWikilinkBeside ?? this._options.onOpenWikilink)?.(link.page, link.heading, link.block);
    else await (this._options.onOpenPathBeside ?? this._options.onOpenPath)?.(link.path, from);
  },

  /** Il centro della vista, in coordinate della lavagna: quale scheda di un file è la più vicina. */
  _viewCenter(this: CanvasEngine): { x: number; y: number } {
    const rect = this._viewport.getBoundingClientRect();
    return {
      x: ((rect.width || 800) / 2 - this._camera.x) / this._camera.zoom,
      y: ((rect.height || 600) / 2 - this._camera.y) / this._camera.zoom,
    };
  },

  /**
   * Il salto a una scheda (T57): la vista la mette al centro col zoom di adesso,
   * come ogni salto (`_jumpCamera`, che lo ricorda per Indietro), e la scheda
   * lampeggia una volta.
   */
  _jumpToCard(this: CanvasEngine, node: CanvasNode): void {
    const rect = this._viewport.getBoundingClientRect();
    const zoom = this._camera.zoom;
    this._jumpCamera({
      x: (rect.width || 800) / 2 - (node.x + node.width / 2) * zoom,
      y: (rect.height || 600) / 2 - (node.y + node.height / 2) * zoom,
      zoom,
    });
    this._flashCard(node.id);
  },

  /**
   * Il lampo di una scheda: `data-card-flash` sulla sua `article`, che il CSS
   * anima una volta (`pulse`), o che resta fermo (`still`) col movimento ridotto.
   * Un solo lampo alla volta: un altro lo spegne. Il timer lo toglie, e la
   * distruzione della lavagna lo ferma.
   */
  _flashCard(this: CanvasEngine, id: string): void {
    const entry = this._cards.get(id);
    if (!entry) return;
    this._endFlash();
    const article = entry.article;
    // Via e poi di nuovo, con una lettura in mezzo: il lampo riparte da capo se
    // la stessa scheda si raggiunge due volte di fila.
    article.removeAttribute("data-card-flash");
    void article.offsetWidth;
    article.dataset.cardFlash = this._reducedMotion ? "still" : "pulse";
    this._flashing = article;
    this._flashTimer = setTimeout(() => this._endFlash(), CARD_FLASH_MS);
  },

  _endFlash(this: CanvasEngine): void {
    clearTimeout(this._flashTimer);
    this._flashTimer = undefined;
    const article = this._flashing;
    if (!article) return;
    this._flashing = null;
    delete article.dataset.cardFlash;
  },

  /**
   * Il mouse giù nel contenuto di una scheda non attiva: il fuoco va alla
   * scheda, non a un link o al testo del contenuto (che fuori non prendono
   * la tastiera), e il testo non si comincia a scegliere. Un pulsante della
   * vista resta suo.
   */
  _keepContentFocus(this: CanvasEngine, event: PointerEvent, id: string): void {
    const target = this._targetOf(event);
    const entry = this._cards.get(id);
    if (!(target instanceof Element) || !entry || this._activeId === id || !this._hasLiveContent(entry)) return;
    if (!entry.body.contains(target)) return;
    const button = target.closest("button");
    if (button !== null && entry.body.contains(button)) return;
    event.preventDefault();
    entry.article.focus({ preventScroll: true });
  },

  /**
   * Invio, o il doppio clic su una scheda: scrive dentro se si può (T41),
   * altrimenti entra, altrimenti ciò che faceva (il campo). Una scheda di file
   * che non si mostra non apre il campo: fa l'azione che serve (T93).
   */
  _enterOrEdit(this: CanvasEngine, node: CanvasNode, from?: EventTarget | null): void {
    if (node.type === "file" && this._fileGesture(node, from)) return;
    if (node.type !== "text" && (this._beginWriting(node.id, from) || this._enterCard(node.id))) return;
    this._beginCardEdit(node);
  },

  /**
   * Il gesto su una scheda di file che non si mostra, al posto del campo del
   * percorso (T93): «File mancante» chiede il file come «Ritrova…» (o lo dice, in
   * sola lettura o senza un selettore); «Non riesco a mostrare» apre il file come
   * «Apri» del menu (T17); mentre carica non fa niente. `false` se la scheda si
   * mostra: il gesto va a entrare o al campo, come prima. Con `from` sul
   * pulsante della scheda, il gesto è del pulsante: il suo clic ha già fatto l'azione.
   */
  _fileGesture(this: CanvasEngine, node: CanvasNode, from?: EventTarget | null): boolean {
    const entry = this._cards.get(node.id);
    if (!entry) return false;
    const showing = this._fileShowing(entry);
    if (showing === "shown") return false;
    const button = from instanceof Element ? from.closest("button") : null;
    if (button !== null && entry.body.contains(button)) return true;
    if (showing === "loading") return true;
    if (showing === "unreadable") {
      this._openFileNode(node);
      return true;
    }
    if (this._readOnly || !this._options.onPickFile) {
      this._showNotice(t("canvas.card.missing", { path: cardTarget(node).path }));
    } else {
      this._relink(node.id);
    }
    return true;
  },

  /**
   * Che cosa mostra una scheda di file (T93): il segnaposto di un file mancante
   * lo dice la tela (`cardMissing`); carica o non si mostra lo dice la radice
   * della vista in `data-card-state`, come fanno la nota, l'immagine, il foglio
   * e il PDF (vedi `docs/reference/canvas-cards.md`).
   */
  _fileShowing(this: CanvasEngine, entry: CardEntry): FileShowing {
    if (entry.article.dataset.cardMissing !== undefined) return "missing";
    const state = entry.body.querySelector<HTMLElement>(":scope > [data-card-state]")?.dataset.cardState;
    if (state === "loading") return "loading";
    if (state === "unreadable" || state === "unavailable" || state === "too-large") return "unreadable";
    return "shown";
  },

  /**
   * Dove porta «Apri a lato per questo» (T45): il file della scheda attiva col
   * punto in cui si è dentro, e il nome della voce che lo dice. Il punto è la
   * cella che si scrive (`#B3`, dal contesto della scheda, T42), la pagina
   * mostrata da un PDF (`#page=3`), la sezione che la scheda di nota mostra
   * (`#Titolo`, il suo `subpath`); senza, il `subpath` della scheda, com'è.
   * `null` senza una scheda di file attiva. La sola lettura non conta: aprire
   * è guardare.
   */
  _besideHere(this: CanvasEngine): { readonly path: string; readonly label: string } | null {
    const id = this._activeId;
    const entry = id === null ? undefined : this._cards.get(id);
    const node = entry?.node;
    if (!entry || node?.type !== "file") return null;
    const target = cardTarget(node);
    const file = target.path.replace(/^\/+/, "");
    if (file === "") return null;
    const at = (subpath: string, label: string) => ({ path: `/${file}${subpath}`, label });
    // Nella finestra stretta si apre nello stesso riquadro, e il nome lo dice.
    const here = this._root.hasAttribute("data-narrow");
    const name = (point: "cell" | "section" | "page" | null, args: Record<string, string> = {}): string =>
      t((here ? BESIDE_HERE_NAMES.here : BESIDE_HERE_NAMES.beside)[point ?? "none"], args);
    const cell = this._writingId === id ? this._writingContext?.cell ?? "" : "";
    if (cell !== "") return at(`#${cell}`, name("cell", { cell }));
    const kind = cardKindOf(node);
    if (kind === "pdf") {
      let page: number | undefined;
      try {
        page = entry.view?.page?.();
      } catch (error) {
        console.warn(`canvas: la scheda ${node.id} non dice la pagina`, error);
      }
      if (page !== undefined && Number.isSafeInteger(page) && page >= 1) {
        return at(`#page=${page}`, name("page", { n: String(page) }));
      }
    }
    const subpath = target.subpath ?? "";
    const heading = kind === "note" ? noteHeadingOf(target.subpath) : null;
    if (heading !== null) return at(subpath, name("section", { name: heading }));
    return at(subpath, name(null));
  },

  /**
   * Chi apre per «Apri a lato per questo» (T45): accanto o, nella finestra
   * stretta, nello stesso riquadro come «Apri»; `null` se da qui non si può.
   */
  _besideOpener(this: CanvasEngine): ((path: string, from?: string) => void | Promise<void>) | null {
    if (this._root.hasAttribute("data-narrow")) return this._options.onOpenPath ?? null;
    return this._options.onOpenPathBeside ?? null;
  },

  /** «Apri» del menu di una scheda di file (T17): il file si apre nel riquadro. */
  _openFileNode(this: CanvasEngine, node: CanvasNode): void {
    if (node.type !== "file" || !node.file) return;
    const path = `/${node.file.replace(/^\/+/, "")}${node.subpath ?? ""}`;
    void this._options.onOpenPath?.(path, this._options.documentId);
  },

  /**
   * Entra nella scheda `id` e ci scrive (T41): la scheda diventa attiva, poi
   * `edit()` monta l'editor vero del file. `false` se la vista non scrive mai
   * (non ha `edit`); se `edit()` dice no la scheda resta attiva, da leggere, e
   * la risposta è `true`. La sola lettura della lavagna non conta (T96): la
   * scheda scrive in un altro file, con la sua sessione e la sua sola
   * lettura, che dice la porta.
   */
  _beginWriting(this: CanvasEngine, id: string, from?: EventTarget | null): boolean {
    if (this._writingId === id) return true;
    const entry = this._cards.get(id);
    const view = entry?.view;
    if (!entry || !view?.edit) return false;
    if (!this._enterCard(id)) return false;
    let started = false;
    try {
      started = view.edit(from) === true;
    } catch (error) {
      console.warn(`canvas: nella scheda ${id} non si scrive`, error);
    }
    if (started) this._writingId = id;
    return true;
  },

  /**
   * La vista dice che scrive (con la sua barra) o che ha smesso: il segno
   * `data-card-editing`, la barra nella riga delle opzioni al posto di quelle
   * dello strumento, il nome nella banda.
   */
  _cardWriting(this: CanvasEngine, entry: CardEntry, writing: CardWriting | null): void {
    if (this._writingId !== entry.id) return;
    if (writing === null) {
      this._writingId = null;
      this._clearWritingContext();
      delete entry.article.dataset.cardEditing;
      this.setCardOptions(null);
      this._statusSettle();
      return;
    }
    entry.article.dataset.cardEditing = "";
    const context = writing.context ?? null;
    if (context !== null) {
      this._showWritingContext(context);
      this._statusSettle();
      return;
    }
    this._clearWritingContext();
    if (writing.toolbar) {
      const item = document.createElement("div");
      item.className = "canvas-options-item";
      item.dataset.option = "format";
      item.append(writing.toolbar);
      this.setCardOptions([{ id: "format", element: item, priority: 1 }]);
    } else {
      this.setCardOptions(null);
    }
    this._statusSettle();
  },

  /**
   * Il contesto della scheda che scrive nella riga delle opzioni (T42, come
   * nel prototipo T27): il nome della cella e la sua formula, nella forma
   * della barra della formula del foglio. Il primo arrivo monta l'elemento,
   * i successivi ne cambiano soltanto il testo.
   */
  _showWritingContext(this: CanvasEngine, context: CardEditorContext): void {
    this._writingContext = context;
    let item = this._formulaItem;
    if (item === null) {
      const element = document.createElement("div");
      element.className = "canvas-options-item";
      element.dataset.option = "formula";
      item = cardFormulaBar();
      element.append(item.element);
      this._formulaItem = item;
      this.setCardOptions([{ id: "formula", element, priority: 1 }]);
    }
    item.show(context);
    // «Apri a lato su B3» segue la cella (T45).
    this._canvasOptions.sync();
  },

  _clearWritingContext(this: CanvasEngine): void {
    this._writingContext = null;
    this._formulaItem = null;
  },

  /**
   * A che punto è ciò che si scrive nella scheda, nella riga del titolo
   * (T41, T96): lo stato del salvataggio con la parola della testata dei
   * riquadri (`.save-state`, `saveStateKey`) o «Sola lettura» col perché
   * (`.canvas-card-lock`).
   */
  _cardEditState(this: CanvasEngine, entry: CardEntry, state: CardEditorState | null, reason: string | null): void {
    const handle = entry.connect.parentElement;
    if (!handle) return;
    handle.querySelector(":scope > .save-state")?.remove();
    handle.querySelector(":scope > .canvas-card-lock")?.remove();
    if (state === null) return;
    const mark = document.createElement("span");
    if (state === "readonly") {
      mark.className = "canvas-card-lock";
      mark.textContent = t("canvas.card.readonly");
      if (reason) mark.title = reason;
    } else {
      mark.className = "save-state";
      mark.dataset.state = state;
      mark.textContent = t(saveStateKey(state));
    }
    entry.connect.before(mark);
  },

  /**
   * Entra nella scheda `id`: se è ferma la accende (passando dalla scelta
   * delle vive, che la tiene accesa con le altre), poi chiama `enter()`. Se
   * dice sì, la scheda è attiva: `data-card-active`, «Esc per uscire» nella
   * testata, il fuoco nel corpo. Una scheda fuori dalla vista, o che non si
   * accende adesso (la penna giù, la lavagna nascosta), non entra.
   */
  _enterCard(this: CanvasEngine, id: string): boolean {
    if (this._activeId === id) return true;
    const entry = this._cards.get(id);
    const view = entry?.view;
    if (this._destroyed || !entry || !view?.enter || !this._hasLiveContent(entry)) return false;
    if (!overlaps(entry.node, this._viewRect().view)) return false;
    this._leaveCard(false);
    if (this._liveModes.get(id) !== "live") {
      // Un clic o un tasto chiudono il gesto della rotella: la scelta si rifà adesso.
      clearTimeout(this._wheelTimer);
      this._wheelTimer = undefined;
      this._enteringId = id;
      try {
        this._refreshLive();
      } finally {
        this._enteringId = null;
      }
      if (this._liveModes.get(id) !== "live") {
        this._refreshLive();
        return false;
      }
    }
    let entered = false;
    try {
      entered = view.enter() === true;
    } catch (error) {
      console.warn(`canvas: non si entra nella scheda ${id}`, error);
    }
    if (!entered) {
      // Accesa per entrare e poi no: torna a ciò che dice la regola.
      this._refreshLive();
      return false;
    }
    this._activeId = id;
    this._syncSelectionBar();
    // La riga delle opzioni offre «Apri a lato» su questa scheda (T45).
    this._canvasOptions.sync();
    const article = entry.article;
    article.dataset.cardActive = "";
    const hint = document.createElement("span");
    hint.className = "canvas-exit-hint";
    hint.textContent = t("canvas.card.exit_hint");
    article.querySelector(":scope > .canvas-node-handle")?.append(hint);
    entry.body.tabIndex = -1;
    entry.body.focus({ preventScroll: true });
    return true;
  },

  /**
   * Esce dalla scheda attiva, se c'è: `leave()`, via segno e suggerimento.
   * Con `refocus` il fuoco che era dentro torna sulla scheda; con `refresh`
   * la scelta delle vive si rifà (la scheda può tornare ferma).
   */
  _leaveCard(this: CanvasEngine, refocus: boolean, refresh = true): void {
    const id = this._activeId;
    if (id === null) return;
    this._activeId = null;
    const entry = this._cards.get(id);
    if (entry) {
      this._unmarkActive(entry, refocus);
      try {
        entry.view?.leave?.();
      } catch (error) {
        console.warn(`canvas: la scheda ${id} non esce`, error);
      }
    }
    if (refresh) this._refreshLive();
    this._syncSelectionBar();
    this._canvasOptions.sync();
  },

  _unmarkActive(this: CanvasEngine, entry: CardEntry, refocus: boolean): void {
    const article = entry.article;
    const focusInside = article.contains(document.activeElement) && document.activeElement !== article;
    delete article.dataset.cardActive;
    article.querySelector(":scope > .canvas-node-handle > .canvas-exit-hint")?.remove();
    // Uscendo si smette anche di scrivere (T41): la riga delle opzioni torna
    // allo strumento, la riga del titolo perde stato e lucchetto.
    this._cardEditState(entry, null, null);
    if (this._writingId === entry.id || article.dataset.cardEditing !== undefined) {
      this._writingId = null;
      this._clearWritingContext();
      delete article.dataset.cardEditing;
      this.setCardOptions(null);
      this._statusSettle();
    }
    entry.body.removeAttribute("tabindex");
    if (refocus && focusInside && article.isConnected) article.focus({ preventScroll: true });
  },

  /**
   * Dice alla vista di `entry` che la scheda ha cambiato misura, a gesto
   * finito: durante un ridimensionamento aspetta il rilascio, e il primo
   * disegno dopo lo dice una volta sola.
   */
  _resizeView(this: CanvasEngine, entry: CardEntry): void {
    const view = entry.view;
    const known = entry.viewSize;
    if (!view || !known || this._resize !== null) return;
    const { width, height } = entry.node;
    if (known.width === width && known.height === height) return;
    entry.viewSize = { width, height };
    try {
      view.resize?.();
    } catch (error) {
      console.warn(`canvas: la scheda ${entry.id} non cambia misura`, error);
    }
  },
};
export type CardOpenMethods = typeof cardOpenMethods;
