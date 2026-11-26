// Il motore della lavagna: le schede (render, testata, gemelle, schede vive).
// Metodi della classe `CanvasEngine`, montati sul suo prototipo da
// `engine.ts` (`editors/core/mix-methods.ts`).

import { t } from "../../i18n/strings";
import { openLifetime } from "../../ui/lifetime";
import { mediaKindOfId } from "../media/media-types";
import {
  cardKindOf,
  liveCardIds,
  updateLiveCards,
  type CardContext,
  type CardKind,
  type CardRenderer,
  type CardSnapshots,
  type CardView,
  type Rect,
} from "../core/cards/contract";
import { cardTitle } from "./a11y";
import { applyCardDetails, cardDetail, detailLevel, farTitle } from "./lod";
import { applyFindMarks } from "./find";
import { watchWholeLines } from "./whole-lines";
import { cardFilePath, syncCardHead, twinGroups } from "./card-head";
import { inkReflowWidth, syncInkReflow } from "./ink-reflow";
import { cardParts } from "./parts";
import { cardTarget } from "./sources";
import { noteExcerptOf, syncExcerptHead } from "./excerpt";
import { type CanvasNode } from "./model";
import { DOUBLE_CLICK_ENTERS, CanvasEngineOptions, CanvasCards } from "./engine-options";
import { CardEntry, Viewport } from "./engine-parts";
import {
  overlaps,
  RESIZE_CORNERS,
  resizeHandle,
  markHandles,
  paintColor,
  paintTextStyle,
  isVaultPath,
  externalUrl,
} from "./engine-geometry";
import { setOp, cardBodyKey, fileName, relinkedFile, nodeTitle } from "./engine-names";
import type { CanvasEngine } from "./engine";

export const cardsMethods = {
  // --- la testata: «↩ N» e le gemelle (T22) ----------------------------------

  /** Rifà la testata di ogni scheda: un conto nuovo dall'indice, la lingua. */
  _syncHeads(this: CanvasEngine): void {
    if (this._destroyed) return;
    for (const entry of this._cards.values()) this._syncHead(entry);
  },

  /** «↩ N» e «×N» nella testata di `entry`, e `data-card-twin` se le sue gemelle sono illuminate. */
  _syncHead(this: CanvasEngine, entry: CardEntry): void {
    const path = cardFilePath(entry.node);
    const cites = path !== "" && this._citations ? this._citations.get(path) : 0;
    const twins = path !== "" ? this._twins.get(path)?.length ?? 0 : 0;
    syncCardHead(entry.title, cites, twins);
    const lit = twins > 1 && this._litTwins?.path === path;
    if (lit !== entry.article.hasAttribute("data-card-twin")) entry.article.toggleAttribute("data-card-twin", lit);
  },

  /** Illumina le gemelle della scheda che porta il «×N» `button`. */
  _lightTwinsFrom(this: CanvasEngine, button: Element): void {
    const id = button.closest<HTMLElement>(".canvas-node")?.dataset.node;
    this._lightTwins(id ?? null);
  },

  /**
   * Illumina tutte le schede che mostrano il file della scheda `id`, lei
   * compresa, anche fuori dalla vista; `null` le spegne. La banda dice quante
   * sono e le inquadra.
   */
  _lightTwins(this: CanvasEngine, id: string | null): void {
    const node = id === null ? undefined : this._cards.get(id)?.node;
    const path = node ? cardFilePath(node) : "";
    const next = id !== null && path !== "" && this._twins.has(path) ? { from: id, path } : null;
    const now = this._litTwins;
    if (now?.from === next?.from && now?.path === next?.path) return;
    this._litTwins = next;
    const touched = new Set([...(now ? this._twins.get(now.path) ?? [] : []), ...(next ? this._twins.get(next.path) ?? [] : [])]);
    for (const twin of touched) {
      const entry = this._cards.get(twin);
      if (entry) this._syncHead(entry);
    }
    this._statusSettle();
  },

  /**
   * Le gemelle che la banda dice: quelle illuminate, o quelle della sola
   * scheda scelta; `null` se nessuna.
   */
  _shownTwins(this: CanvasEngine): readonly string[] | null {
    let path = this._litTwins?.path ?? null;
    if (path === null && this._selection.length === 1) {
      const node = this._cards.get(this._selection[0]!)?.node;
      path = node ? cardFilePath(node) : null;
    }
    return path ? this._twins.get(path) ?? null : null;
  },

  /** Una firma delle gemelle della banda: se cambia, la banda si rilegge. */
  _twinsKey(this: CanvasEngine): string {
    const ids = this._shownTwins();
    return ids === null ? "" : `${ids.length}\u0000${ids.join("\u0001")}`;
  },

  // --- render -------------------------------------------------------------------

  _renderLive(this: CanvasEngine): void {
    // Drag/resize updates moved nodes and connected edges without replacing cards.
    const moved = this._drag?.origin.keys() ?? this._strokeDrag?.origin.keys() ?? this._resize?.origin.keys() ?? this._selection.values();
    for (const id of moved) {
      const node = this._doc?.nodes.find((n) => n.id === id);
      const el = this._stage.querySelector<HTMLElement>(`[data-node="${CSS.escape(id)}"]`);
      if (node && el) {
        el.style.transform = `translate(${node.x}px, ${node.y}px)`;
        el.style.width = `${node.width}px`;
        el.style.height = `${this._shownHeight(node)}px`;
        markHandles(el, node, this._camera.zoom);
        // L'avviso dei tratti sul testo si vede già mentre si tira il bordo.
        syncInkReflow(el, inkReflowWidth(node, this._inkCards.get(id) ?? []), !this._readOnly);
      }
    }
    this._drawEdges();
    this._syncSelectionFrame();
  },

  _render(this: CanvasEngine): void {
    this._syncEmpty();
    this._syncPartsPicker();
    this._syncReader();
    this._syncCrop();
    // Dopo `destroy` niente rinasce: una vista montata qui non avrebbe padrone.
    if (!this._doc || this._destroyed) return;
    this._syncInkLayer();
    this._applyCamera();
    this._drawToolbar();
    this._viewport.dataset.canvasNodes = String(this._doc.nodes.length);
    this._viewport.dataset.canvasEdges = String(this._doc.edges.length);
    if (this._isSceneOversized()) {
      this._dropCards();
      this._edgeLayer.replaceChildren();
      this._handleLayer.replaceChildren();
      // Il livello dei fili resta il primo figlio dello stage (T91).
      this._stage.replaceChildren(this._edgeLayer);
      delete this._stage.dataset.selection;
      const fallback = document.createElement("p");
      fallback.className = "canvas-large-fallback";
      fallback.textContent = t("canvas.too_large");
      this._stage.append(fallback);
      this._viewport.dataset.canvasProtocol = "source-fallback";
      // L'inchiostro si vede dove si vedono le schede (A8).
      this._inkCards = new Map();
      this._inkBoard = [];
      this._inkPaths.clear();
      return;
    }
    this._drawEdges();
    this._placeCards(this._doc.nodes);
    this._scheduleLabels();
    // La ricerca aperta si rifà col documento di adesso; una scheda nata ora
    // prende il suo segno (T60).
    this._findBar.refresh();
    applyFindMarks(this._cards, this._findMarkOf);
    this._paintInk();
    this._syncSelectionFrame();
    this._viewport.dataset.canvasProtocol = "source";
    this._refreshLive();
  },

  // --- le schede vive ---------------------------------------------------------

  /**
   * Un gesto che muove la vista o le schede: il puntatore è ancora giù. Il
   * rettangolo della Selezione conta da quando si è mosso: finché è un clic, non è
   * ancora un gesto (N6 T20b).
   */
  _gestureMoving(this: CanvasEngine): boolean {
    return this._drag !== null || this._resize !== null || this._pan !== null || this._pinch !== null
      || this._lasso !== null || this._strokeDrag !== null || this._marquee?.moved === true;
  },

  /**
   * Un gesto sulle schede o sui tratti (spostare, ridimensionare, il
   * rettangolo, il lazo): la barra della selezione si toglie. La camera che
   * si muove (lo zoom, lo spostamento della vista, il volo) non lo è: la barra
   * la segue (#411 C-06).
   */
  _cardGestureActive(this: CanvasEngine): boolean {
    return this._drag !== null || this._resize !== null || this._lasso !== null
      || this._strokeDrag !== null || this._marquee?.moved === true;
  },

  /** Un gesto in corso, rotella, volo e inerzia compresi (T53): nessuna scheda cambia modo. */
  _gestureActive(this: CanvasEngine): boolean {
    // Il riquadro del navigatore trascinato è un gesto anche lui (T55).
    return this._gestureMoving() || this._wheelTimer !== undefined || this._motion !== null || this._navigator.dragging();
  },

  /**
   * La lavagna si vede: è nel documento, nessun antenato è `hidden` (la
   * linguetta di un altro riquadro) e, dove il browser lo sa dire, niente la
   * toglie dalla pagina (`display: none`).
   */
  _isShown(this: CanvasEngine): boolean {
    const viewport = this._viewport;
    if (!viewport.isConnected || viewport.closest("[hidden]") !== null) return false;
    return typeof viewport.checkVisibility === "function" ? viewport.checkVisibility() : true;
  },

  /**
   * Sceglie le schede vive con la vista di adesso, in coordinate della
   * lavagna, e lo zoom (`liveCardIds`), poi cambia il modo a chi lo deve
   * cambiare (`updateLiveCards`, nel silenzio della penna: con la penna giù
   * aspetta che si alzi). Non fa niente a gesto in corso (lo rifà la fine del
   * gesto) e con la lavagna nascosta (lo rifà la vista che torna e cambia
   * misura): le schede restano come sono.
   */
  _refreshLive(this: CanvasEngine): void {
    const doc = this._doc;
    if (this._destroyed || !doc) return;
    if (this._gestureActive() || !this._isShown()) return;
    const { view, zoom } = this._viewRect();
    this._askCitations(doc.nodes);
    if (this._views.size === 0) {
      this._refreshDetail(zoom);
      return;
    }
    // Contano solo le schede con una vista: una specie senza renderer non
    // toglie posto a quelle che si accendono.
    const nodes = doc.nodes.filter((node) => this._views.has(node.id));
    // La scheda attiva che esce dalla vista (non da quella allargata) ne esce.
    const active = this._activeId;
    if (active !== null) {
      const node = nodes.find((candidate) => candidate.id === active);
      // Quella che scrive resta finché si scrive (T41).
      if (!node || (!overlaps(node, view) && this._writingId !== active)) this._leaveCard(true, false);
    }
    // La scheda attiva, e quella in cui si sta entrando, restano vive anche
    // se la regola le spegnerebbe (lo zoom, il limite).
    const wanted = liveCardIds(nodes, view, zoom);
    // E quella col ritaglio aperto (T78): l'immagine intera si legge viva.
    for (const id of [this._activeId, this._enteringId, this._crop?.node ?? null]) {
      if (id !== null && this._views.has(id)) wanted.add(id);
    }
    // Prima che le vive si spengano: chi è vivo adesso conta come visto.
    this._refreshDetail(zoom);
    updateLiveCards(this._views, wanted, this._liveModes, this._cardQuiet);
  },

  /**
   * Il livello di dettaglio di ogni scheda allo zoom `zoom` (T54, A-22), a
   * gesto finito: lo chiama solo `_refreshLive`. Un solo giro sulle schede,
   * che scrive `data-card-detail` solo dove cambia, e la misura del titolo
   * grande (`--canvas-detail-zoom`) una volta sulla scena. La scheda attiva,
   * quella in cui si entra, quella che scrive e quella col campo aperto
   * restano come da vicino.
   */
  _refreshDetail(this: CanvasEngine, zoom: number): void {
    for (const [id, mode] of this._liveModes) {
      if (mode === "live") this._seenLive.add(id);
    }
    const level = detailLevel(zoom);
    const kept = new Set<string>();
    for (const id of [this._activeId, this._enteringId, this._writingId, this._editor?.id ?? null]) {
      if (id !== null) kept.add(id);
    }
    const seen = this._seenLive;
    applyCardDetails(this._cards, (id) => cardDetail(level, seen.has(id), kept.has(id)));
    const scale = String(zoom);
    if (this._stage.style.getPropertyValue("--canvas-detail-zoom") !== scale) {
      this._stage.style.setProperty("--canvas-detail-zoom", scale);
    }
  },

  /**
   * La vista di adesso in coordinate della lavagna, e lo zoom. Senza misura
   * (happy-dom, una vista non ancora disposta) vale quella di riserva di
   * `_fitCamera`: la camera è fatta su quella.
   */
  _viewRect(this: CanvasEngine): { readonly view: Rect; readonly zoom: number } {
    return { view: this._viewRectOf(this._camera), zoom: this._camera.zoom };
  },

  /** La vista in coordinate della lavagna con la camera `camera`, con la misura di riserva di `_viewRect`. */
  _viewRectOf(this: CanvasEngine, camera: Viewport): Rect {
    const rect = this._viewport.getBoundingClientRect();
    const width = rect.width || 800;
    const height = rect.height || 600;
    const { x, y, zoom } = camera;
    return { x: -x / zoom, y: -y / zoom, width: width / zoom, height: height / zoom };
  },

  _worldSize(this: CanvasEngine): { w: number; h: number } {
    let w = 2000;
    let h = 2000;
    for (const node of this._doc?.nodes ?? []) {
      w = Math.max(w, node.x + node.width + 400);
      h = Math.max(h, node.y + node.height + 400);
    }
    return { w, h };
  },

  /**
   * Mette sulla scena le schede di `nodes`, tenute per id: chi c'è già si
   * aggiorna (posto, misura, colore, titolo, scelta), chi è nuovo nasce, chi
   * non c'è più si distrugge. Il corpo si rifà solo se cambia la sua chiave
   * (`cardBodyKey`): una vista viva sopravvive a ciò che non la riguarda.
   * L'ordine sulla scena è quello del file: la prima sotto, l'ultima sopra.
   * I gruppi però stanno sempre sotto i fili, quindi sotto ogni scheda (T91).
   */
  _placeCards(this: CanvasEngine, nodes: readonly CanvasNode[]): void {
    // La scheda col campo aperto non si sposta e non rifà il corpo: muoverla
    // toglierebbe il fuoco al campo. Le altre le si mettono attorno; se il
    // documento non l'ha più, resta finché il campo non si chiude.
    const editor = this._editor;
    const keptEntry = editor ? this._cards.get(editor.id) : undefined;
    const kept = keptEntry && keptEntry.article === editor?.article && keptEntry.article.parentElement === this._stage
      ? keptEntry
      : undefined;
    const present = new Set(nodes.map((node) => node.id));
    // Le gemelle col documento di adesso (T22). Se la scheda da cui si erano
    // illuminate non c'è più, o non mostra più quel file, o il file ha ormai
    // una scheda sola, si spengono.
    this._twins = twinGroups(nodes);
    const lit = this._litTwins;
    let unlit = false;
    if (lit !== null) {
      const from = nodes.find((node) => node.id === lit.from);
      if (!from || cardFilePath(from) !== lit.path || !this._twins.has(lit.path)) {
        this._litTwins = null;
        this._twinsHover = null;
        unlit = true;
      }
    }
    for (const [id, entry] of this._cards) {
      if (present.has(id) || entry === kept) continue;
      // La scheda col fuoco che se ne va (Canc, un annulla) lo lascia alla
      // vista: il tasto dopo (Ctrl+Z) arriva ancora alla lavagna (IMP-040).
      const hadFocus = entry.article.contains(document.activeElement);
      this._cards.delete(id);
      this._releaseBody(entry);
      entry.article.remove();
      if (hadFocus && !this._destroyed) this._viewport.focus({ preventScroll: true });
    }
    // Ciò che sulla scena non è una scheda (il messaggio della scena troppo
    // grande) va via; l'inchiostro libero resta, `_paintInk` lo rimette in cima,
    // e il bordo del tratto in corso pure.
    const ours = new Set<Element>([...this._cards.values()].map((entry) => entry.article));
    for (const child of [...this._stage.children]) {
      // Lo strato dei fili (T91, primo figlio della scena: le schede gli
      // vanno dopo), il bordo del tratto in corso (T69) e la
      // cornice della scelta restano: non sono della scena.
      if (child !== this._edgeLayer && !ours.has(child) && !child.classList.contains("canvas-ink-board") && !child.classList.contains("canvas-ink-frames") && child !== this._selectionFrame && child !== this._lassoLayer?.svg) child.remove();
    }
    const children = this._stage.children;
    let index = children[0] === this._edgeLayer ? 1 : 0;
    for (const node of nodes) {
      let entry = this._cards.get(node.id);
      if (!entry) {
        entry = this._createCard(node);
        this._cards.set(node.id, entry);
      }
      if (entry === kept) {
        while (children[index] && children[index] !== entry.article) {
          this._stage.insertBefore(children[index]!, entry.article.nextSibling);
        }
      } else if (children[index] !== entry.article) {
        this._stage.insertBefore(entry.article, children[index] ?? null);
      }
      index++;
      this._refreshCard(entry, node, entry !== kept);
      // La scheda che si scrive tiene la misura a cui è cresciuta, anche
      // prima che il suo commit arrivi (T44).
      const grown = entry === kept ? editor?.grown : null;
      if (grown) {
        entry.article.style.width = `${Math.max(node.width, grown.width)}px`;
        entry.article.style.height = `${Math.max(node.height, grown.height)}px`;
      }
      this._resizeView(entry);
    }
    if (unlit) this._statusSettle();
    this._askCitations(nodes);
  },

  /** L'involucro di una scheda nuova, col corpo ancora vuoto: lo riempie `_refreshCard`. */
  _createCard(this: CanvasEngine, node: CanvasNode): CardEntry {
    const id = node.id;
    const el = document.createElement("article");
    el.className = `canvas-node canvas-node-${node.type}`;
    el.dataset.node = id;
    el.tabIndex = 0;
    // Il ruolo è quello di `article`, che accetta un nome, scritto per chi
    // legge solo l'attributo: `role="group"` su un `article` non è ammesso
    // (axe, `aria-allowed-role`).
    el.setAttribute("role", "article");
    // Una scheda nuova non ha ancora il suo nome (T61).
    this._labelled.stale = true;
    const header = document.createElement("div");
    header.className = "canvas-node-handle";
    header.dataset.drag = id;
    const title = document.createElement("span");
    title.className = "canvas-node-title";
    const connect = document.createElement("button");
    connect.type = "button";
    connect.className = "canvas-connect";
    connect.dataset.connect = id;
    connect.textContent = "→";
    connect.addEventListener("click", (e) => e.stopPropagation());
    header.append(title, connect);
    // ↗ di un estratto (T75): la fonte accanto, alla prima sezione; con
    // Ctrl (Cmd) nel riquadro. Il pulsante lo mette `syncExcerptHead`.
    header.addEventListener("click", (e) => {
      if (!(e.target instanceof Element) || !e.target.closest("[data-excerpt-open]")) return;
      e.stopPropagation();
      this._openExcerptSource(entry.node, e.ctrlKey || e.metaKey ? "pane" : "beside");
    });
    const body = document.createElement("div");
    body.className = "canvas-card-body";
    // Il titolo grande da lontano (T54), prima dell'inchiostro della scheda:
    // è trasparente e l'inchiostro gli resta sopra.
    const far = document.createElement("div");
    far.className = "canvas-node-far";
    far.setAttribute("aria-hidden", "true");
    el.append(header, body, far);
    const entry: CardEntry = {
      id, article: el, title, connect, node, type: node.type, body,
      bodyKey: null, resize: null, teardown: null, view: null, viewLife: null, viewSize: null, missingFor: null,
      far, detail: null, find: null, label: null, titled: null,
    };
    el.addEventListener("focus", () => {
      // Col fuoco il nome dev'essere quello di adesso, anche prima del giro
      // rimandato di `_scheduleLabels`.
      if (!this._labelsCurrent()) this._labelCard(entry);
      if (!this._selection.includes(id)) {
        this._selection = [id];
        this._edgeSelection = [];
        this._options.onSelectionChange();
        this._displaySelection();
      }
    });
    el.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      // Il doppio clic su una maniglia adatta la scheda al contenuto (T66).
      const tap = this._takeHandleTap(e.target);
      if (tap) {
        this._fitToContent(tap);
        return;
      }
      // Il doppio clic sulla testata di un estratto apre la fonte accanto
      // (T75), come ↗; quello su ↗ è già il suo clic.
      if (e.target instanceof Element && e.target.closest(".canvas-node-handle") && noteExcerptOf(entry.node)) {
        if (!e.target.closest("[data-excerpt-open]")) this._openExcerptSource(entry.node, "beside");
        return;
      }
      // Dentro la scheda attiva il doppio clic è del contenuto (una parola);
      // in una nota che si legge comincia a scriverci (T41).
      // L'elemento sotto il gesto, per una scheda che scrive da lì (la cella
      // di un foglio, T42): il bersaglio dell'evento è dove il primo clic è
      // sceso, il corpo della scheda che non prendeva ancora il puntatore; al
      // doppio clic la scheda è attiva e il contenuto lo prende.
      const under = document.elementFromPoint?.(e.clientX, e.clientY) ?? null;
      const from = under !== null && el.contains(under) ? under : e.target;
      if (this._activeId === id) {
        if (this._writingId !== id) this._beginWriting(id, from);
        return;
      }
      const kind = cardKindOf(entry.node);
      // Il visore lo apre la vista dell'immagine, che ascolta il suo doppio clic (T5).
      if (kind === "image" && this._hasLiveContent(entry)) return;
      // Una scheda di file prende il gesto anche senza vista, se manca o non si mostra (T93).
      const takesGesture = entry.node.type === "file" || (kind !== null && DOUBLE_CLICK_ENTERS.has(kind));
      if (takesGesture) this._enterOrEdit(entry.node, from);
      else this._beginCardEdit(entry.node, null, { x: e.clientX, y: e.clientY });
    });
    return entry;
  },

  /**
   * Aggiorna la scheda `entry` a `node`: l'involucro sempre, il corpo
   * (`withBody`) solo se la sua chiave è cambiata.
   */
  _refreshCard(this: CanvasEngine, entry: CardEntry, node: CanvasNode, withBody: boolean): void {
    entry.node = node;
    const el = entry.article;
    if (entry.type !== node.type) {
      el.classList.replace(`canvas-node-${entry.type}`, `canvas-node-${node.type}`);
      entry.type = node.type;
    }
    el.style.transform = `translate(${node.x}px, ${node.y}px)`;
    el.style.width = `${node.width}px`;
    el.style.height = `${this._shownHeight(node)}px`;
    // La carta e il colore li dà la pelle (T47); il nome del colore arriva a
    // chi ascolta.
    paintColor(el, node.color);
    paintTextStyle(el, node);
    if (node.type === "group" && node.backgroundStyle) el.dataset.backgroundStyle = node.backgroundStyle;
    else delete el.dataset.backgroundStyle;
    // Il nome per il lettore di schermo (T61) lo scrive `_scheduleLabels`, solo
    // quando il documento cambia: non qui, a ogni resa.
    el.classList.toggle("selected", this._selection.includes(node.id));
    // I nomi della testata dipendono solo dalla scheda e dalla lingua.
    if (entry.titled?.node !== node || entry.titled.round !== this._languageRound) {
      entry.titled = { node, round: this._languageRound };
      const title = nodeTitle(node);
      if (entry.title.textContent !== title) entry.title.textContent = title;
      const far = farTitle(node);
      if (entry.far.textContent !== far) entry.far.textContent = far;
      // Il nome di → è quello del lettore di schermo: la specie e il nome della scheda.
      const connectLabel = t("canvas.connect", { card: cardTitle(node) });
      if (entry.connect.getAttribute("aria-label") !== connectLabel) entry.connect.setAttribute("aria-label", connectLabel);
    }
    // «↩ N» e «×N» dopo il titolo, e la luce delle gemelle (T22).
    this._syncHead(entry);
    // La testata dell'estratto (T75): le parti e ↗, prima di →.
    const handle = entry.connect.parentElement;
    if (handle) syncExcerptHead(el, handle, entry.connect, node.type === "file" ? node.file ?? null : null, noteExcerptOf(node));
    this._syncPorts(el);
    // Le quattro maniglie (T66): in sola lettura nessuna.
    if (this._readOnly) {
      for (const handle of entry.resize ?? []) handle.remove();
      entry.resize = null;
    } else if (!entry.resize) {
      const handles = RESIZE_CORNERS.map((corner) => resizeHandle(corner, node.id));
      // Dopo il corpo, prima dell'inchiostro della scheda: come quando nasce.
      entry.body.after(...handles);
      entry.resize = handles;
    }
    markHandles(el, node, this._camera.zoom);
    if (!withBody) return;
    const kind = cardKindOf(node);
    const cards = this._options.cards;
    const renderer = kind && cards ? cards.registry.rendererFor(kind) : null;
    // Una vista dipende solo dalla scheda; il corpo di sempre anche dalla
    // lingua, e quello di testo dalle sintassi e dalla sola lettura (il
    // pulsante che ne fa una nota).
    const viewKey = cardBodyKey(node, renderer ? this._viewKeyOf(node)
      : node.type === "text" ? `${this._languageRound}:${this._formsRound}:${this._readOnly}`
      : `${this._languageRound}`);
    // Il file cambiato (o la scheda) non è più quello che mancava: si riprova.
    if (entry.missingFor !== null && entry.missingFor !== viewKey) entry.missingFor = null;
    // Il segnaposto di un file mancante dipende dalla lingua e dalla sola lettura (i gesti).
    const missing = entry.missingFor !== null && cards !== undefined;
    const key = missing ? cardBodyKey(node, `missing:${this._languageRound}:${this._readOnly}`) : viewKey;
    if (key === entry.bodyKey) return;
    this._releaseBody(entry);
    const body = document.createElement("div");
    body.className = "canvas-card-body";
    entry.body.replaceWith(body);
    entry.body = body;
    entry.bodyKey = key;
    if (missing && cards) this._fillMissing(entry, body, node, cards);
    else if (renderer && kind && cards) this._mountView(entry, node, kind, renderer, cards.snapshots);
    else this._fillBody(entry, body, node);
  },

  /**
   * Monta la vista del renderer nel corpo, ferma: chi è vivo lo decide la
   * tela più tardi. Un renderer che lancia lascia il corpo di sempre, e la
   * tela va avanti.
   */
  _mountView(this: CanvasEngine, entry: CardEntry, node: CanvasNode, kind: CardKind, renderer: CardRenderer, snapshots: CardSnapshots): void {
    const body = entry.body;
    const life = openLifetime();
    const target = cardTarget(node);
    // Finché il renderer monta, un «file mancante» si registra a montaggio finito.
    let mounting = true;
    let missingWhileMounting = false;
    const context: CardContext = {
      path: target.path,
      subpath: target.subpath,
      documentId: this._options.documentId ?? "",
      lifetime: life,
      snapshots,
      size: () => ({ width: entry.node.width, height: entry.node.height }),
      zoom: () => this._camera.zoom,
      initialPage: this._viewMemo?.page(node.id) ?? null,
      // Le parti dell'estratto (T73); col ritaglio aperto l'immagine intera (T78).
      parts: this._crop?.node === node.id ? null : cardParts(node),
      // I gesti dell'avviso «Sezione non trovata» (T75), non in sola lettura.
      ...(!this._readOnly && noteExcerptOf(node) !== null ? {
        excerpt: {
          ...(this._options.parts ? { chooseAgain: () => void this._openParts(entry.id, "command") } : {}),
          showWhole: () => this._showWholeFile(entry.id),
        },
      } : {}),
      pageChanged: (page) => {
        // Una vista già smontata non parla più per questa scheda.
        if (life.closed || entry.body !== body) return;
        this._viewMemo?.pageChanged(entry.id, page);
        // «Apri a lato alla pagina 3» segue la pagina della scheda attiva (T45).
        if (this._activeId === entry.id) this._canvasOptions.sync();
      },
      // L'inchiostro di pagina segue la pagina che si vede (T19). Durante il
      // montaggio non c'è ancora la vista: lo disegna il giro della resa.
      pageShown: () => {
        if (life.closed || entry.body !== body || mounting) return;
        this._pageShown(entry);
      },
      // L'inchiostro `scale` segue il contenuto che si vede (T39), come sopra.
      contentShown: () => {
        if (life.closed || entry.body !== body || mounting) return;
        this._pageShown(entry);
      },
      // L'inchiostro di cella segue il foglio che scorre (T38), come sopra.
      cellsShown: () => {
        if (life.closed || entry.body !== body || mounting) return;
        this._pageShown(entry);
      },
      ...(this._options.cards?.editors ? { editors: this._options.cards.editors } : {}),
      writing: (writing) => {
        if (life.closed || entry.body !== body) return;
        this._cardWriting(entry, writing);
      },
      editState: (state, reason) => {
        if (life.closed || entry.body !== body) return;
        this._cardEditState(entry, state, reason ?? null);
      },
      missing: () => {
        // Una vista già distrutta non parla più per questa scheda; un link non manca mai.
        if (life.closed || entry.body !== body || entry.node.type !== "file") return;
        if (mounting) {
          missingWhileMounting = true;
          return;
        }
        this._markMissing(entry);
      },
    };
    let view: CardView;
    try {
      view = renderer.mount(node, body, "snapshot", context);
    } catch (error) {
      life.close();
      console.warn(`canvas: la scheda ${node.id} non si mostra (${kind})`, error);
      if (entry.body === body) {
        body.replaceChildren();
        this._fillBody(entry, body, node);
      }
      return;
    } finally {
      mounting = false;
    }
    entry.view = view;
    entry.viewLife = life;
    entry.viewSize = { width: node.width, height: node.height };
    const article = entry.article;
    article.dataset.cardKind = kind;
    article.dataset.cardMode = "snapshot";
    // Nasce ferma: la tela non le chiede «ferma» di nuovo.
    this._liveModes.set(entry.id, "snapshot");
    this._views.set(entry.id, {
      setMode: (mode) => {
        view.setMode(mode);
        article.dataset.cardMode = mode;
      },
      // Questa voce serve solo al cambio di modo: la vista la smonta `_releaseBody`.
      destroy: () => {},
    });
    if (missingWhileMounting) this._markMissing(entry);
  },

  /**
   * Il renderer dice che il file della scheda non c'è: la vista si smonta, e il
   * corpo diventa «File mancante» con i suoi gesti. La scheda resta così finché
   * il file non torna (o cambia): allora la sua vista si rimonta.
   */
  _markMissing(this: CanvasEngine, entry: CardEntry): void {
    entry.missingFor = cardBodyKey(entry.node, this._viewKeyOf(entry.node));
    this._refreshCard(entry, entry.node, true);
  },

  /**
   * Il file di una scheda mancante è tornato (o è cambiato): la scheda si
   * rimonta da sé, con la sua vista, e la tela decide se si accende.
   */
  _fileBack(this: CanvasEngine, id: string): void {
    const entry = this._cards.get(id);
    if (this._destroyed || !entry || entry.missingFor === null) return;
    entry.missingFor = null;
    this._refreshCard(entry, entry.node, true);
    this._refreshLive();
  },

  /**
   * Il corpo di una scheda il cui file non c'è: il nome del file, e «Ritrova…» e
   * «Togli dalla lavagna» se la lavagna si può cambiare. Il file si ascolta da
   * qui (la vita del corpo): quando torna, `_fileBack` rimonta la vista.
   */
  _fillMissing(this: CanvasEngine, entry: CardEntry, body: HTMLElement, node: CanvasNode, cards: CanvasCards): void {
    const id = node.id;
    const path = cardTarget(node).path;
    const life = openLifetime();
    entry.viewLife = life;
    entry.article.dataset.cardMissing = "true";
    // Il buco nella lavagna (prototipo T25): il messaggio nel riquadro grigio
    // delle schede di file, sotto i due pulsanti del kit.
    const missing = document.createElement("div");
    missing.className = "canvas-card-missing";
    const message = document.createElement("span");
    message.className = "canvas-media-placeholder";
    message.textContent = t("canvas.card.missing", { path });
    // Su una scheda piccola il messaggio sta su una riga, tagliato: intero qui (IMP-045).
    message.title = message.textContent;
    missing.append(message);
    body.append(missing);
    life.add(cards.watch(path, () => this._fileBack(id)));
    if (this._readOnly) return;
    const actions = document.createElement("div");
    actions.className = "canvas-card-missing-actions";
    missing.append(actions);
    const pick = this._options.onPickFile;
    if (pick) {
      const relink = document.createElement("button");
      relink.type = "button";
      relink.className = "kit-button";
      relink.dataset.kind = "primary";
      relink.dataset.cardAction = "relink";
      relink.textContent = t("canvas.card.relink");
    relink.title = relink.textContent;
      life.listen(relink, "click", (event) => {
        event.stopPropagation();
        this._relink(id);
      });
      actions.append(relink);
    }
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "kit-button";
    remove.dataset.kind = "normal";
    remove.dataset.cardAction = "remove";
    remove.textContent = t("canvas.card.remove");
    remove.title = remove.textContent;
    life.listen(remove, "click", (event) => {
      event.stopPropagation();
      this._removeCard(id);
    });
    actions.append(remove);
  },

  /** «Ritrova…» di una scheda mancante, dal pulsante o dal gesto: lo stesso selettore e lo stesso commit (T16, T93). */
  _relink(this: CanvasEngine, id: string): void {
    const pick = this._options.onPickFile;
    if (!pick) return;
    this._relinkCard(id, pick).catch((error: unknown) => this._showIntakeError(error));
  },

  /**
   * «Ritrova…»: il file scelto (con il nome di quello che manca in testa) sostituisce
   * il percorso della scheda, in un commit solo. La scelta vale solo se la scheda è
   * ancora mancante per lo stesso file: se il file è tornato, o la scheda è cambiata
   * mentre il selettore era aperto, la scelta è vecchia e non tocca niente.
   */
  async _relinkCard(this: CanvasEngine, id: string, pick: NonNullable<CanvasEngineOptions["onPickFile"]>): Promise<void> {
    const expected = this._cards.get(id)?.missingFor ?? null;
    const shown = this._doc?.nodes.find((candidate) => candidate.id === id);
    if (expected === null || !shown) return;
    const chosen = await pick(fileName(cardTarget(shown).path));
    if (!isVaultPath(chosen) || this._destroyed || this._readOnly || !this._doc) return;
    if (this._cards.get(id)?.missingFor !== expected) return;
    const now = this._doc.nodes.find((candidate) => candidate.id === id);
    if (!now) return;
    const op = setOp(now, { ...now, file: relinkedFile(now, chosen) });
    if (op) this._writeOps([op]);
  },

  /** «Togli dalla lavagna» di una scheda mancante: come Canc, per quella scheda sola. */
  _removeCard(this: CanvasEngine, id: string): void {
    if (this._removeCards([id], [])) this._options.onSelectionChange();
  },

  /** Smonta ciò che tiene vivo il corpo di `entry` (Markdown, vista) e lo segna da rifare. */
  _releaseBody(this: CanvasEngine, entry: CardEntry): void {
    const teardown = entry.teardown;
    const view = entry.view;
    const life = entry.viewLife;
    entry.teardown = null;
    entry.view = null;
    entry.viewLife = null;
    entry.viewSize = null;
    entry.bodyKey = null;
    if (view) {
      this._views.delete(entry.id);
      this._liveModes.delete(entry.id);
      this._seenLive.delete(entry.id);
    }
    // La scheda attiva che perde il corpo (tolta, un annulla, un file
    // cambiato, il campo che prende il posto della vista) ne esce prima.
    if (this._activeId === entry.id) {
      this._activeId = null;
      this._unmarkActive(entry, false);
      try {
        view?.leave?.();
      } catch (error) {
        console.warn(`canvas: la scheda ${entry.id} non esce`, error);
      }
      this._canvasOptions.sync();
    }
    delete entry.article.dataset.cardKind;
    delete entry.article.dataset.cardMode;
    delete entry.article.dataset.cardMissing;
    // Una vista che lancia nel distruggersi non tiene vive le altre.
    if (teardown) {
      try {
        teardown();
      } catch (error) {
        console.warn(`canvas: la scheda ${entry.id} non si smonta`, error);
      }
    }
    if (view) {
      try {
        view.destroy();
      } catch (error) {
        console.warn(`canvas: la scheda ${entry.id} non si smonta`, error);
      }
    }
    life?.close();
  },

  /** Tutte le schede giù dalla scena: ogni vista si distrugge una volta. */
  _dropCards(this: CanvasEngine): void {
    const entries = [...this._cards.values()];
    this._cards.clear();
    for (const entry of entries) {
      this._releaseBody(entry);
      entry.article.remove();
    }
  },

  /** Il corpo di sempre di `node`, in `body`: testo, file, link o gruppo. */
  _fillBody(this: CanvasEngine, entry: CardEntry, body: HTMLElement, node: CanvasNode): void {
    switch (node.type) {
      case "text": {
        const text = node.text ?? "";
        const render = this._options.renderMarkdownForCard;
        if (render) {
          const host = document.createElement("div");
          host.className = "canvas-markdown";
          const teardown = render(node.id, text, host, this._forms);
          if (typeof teardown === "function") entry.teardown = teardown;
          body.append(host);
        } else {
          // Senza hook: testo non interattivo. Nessuno scanner locale: un
          // secondo parser linkificherebbe codice che il markdown esclude.
          body.textContent = text;
          if (!text) {
            body.classList.add("canvas-empty");
            body.textContent = t("canvas.empty_text");
          }
        }
        if (this._options.notes && !this._readOnly) {
          const convert = document.createElement("button");
          convert.type = "button";
          convert.className = "canvas-convert-note";
          convert.textContent = t("canvas.extract_note");
          convert.addEventListener("click", (event) => {
            event.stopPropagation();
            // Lo stesso gesto di «Estrai in una nota» del menu (T70), sulla
            // scheda di adesso: il corpo resta anche se la si sposta.
            void this._extractNote(entry.id).catch((error: unknown) => this._showIntakeError(error));
          });
          body.append(convert);
        }
        // Un testo che non ci sta si ferma sotto l'ultima riga intera (#411),
        // «Estrai in una nota…» compreso: mai una riga tagliata a metà.
        const lines = openLifetime();
        watchWholeLines(body, lines);
        const unmount = entry.teardown;
        entry.teardown = () => {
          lines.close();
          unmount?.();
        };
        break;
      }
      case "file": {
        const path = node.file ?? "";
        // Lo stesso tipo che decide come l'inchiostro segue la scheda
        // (`inkFitMode`): resa e segnaposto non si contraddicono.
        const media = mediaKindOfId(path);
        const kind = media === "other" ? "file" : media;
        body.dataset.mediaKind = kind;
        if (kind !== "file") {
          const placeholder = document.createElement("span");
          placeholder.className = "canvas-media-placeholder";
          placeholder.textContent = `${kind.toUpperCase()} · ${path}`;
          body.append(placeholder);
        }
        const link = document.createElement("button");
        link.type = "button";
        link.className = "canvas-file-link internal-path";
        link.textContent = node.subpath ? `${path}${node.subpath}` : path;
        link.addEventListener("click", (e) => {
          e.stopPropagation();
          void this._options.onOpenPath?.(`/${path.replace(/^\/+/, "")}${node.subpath ?? ""}`, this._options.documentId);
        });
        body.append(link);
        break;
      }
      case "link": {
        // Anteprima inerte: mai iframe, mai fetch. Apertura via viewer isolato
        // o esterno attraverso la porta media iniettata.
        const url = node.url ?? "";
        const preview = document.createElement("span");
        preview.className = "canvas-url-text";
        preview.textContent = url;
        const open = document.createElement("button");
        open.type = "button";
        const media = this._options.media;
        const destination = externalUrl(url);
        open.className = "canvas-open-url";
        open.textContent = t("canvas.open_url");
        open.disabled = destination === null || !media;
        open.addEventListener("click", (e) => {
          e.stopPropagation();
          if (!destination) return;
          if (media?.openViewer) void media.openViewer(destination);
          else if (media) void media.openExternal(destination);
        });
        body.append(preview, open);
        break;
      }
      case "group": {
        const label = document.createElement("div");
        label.className = "canvas-group-label";
        label.textContent = node.label || t("canvas.ungrouped");
        body.append(label);
        if (node.background) {
          const bg = document.createElement("span");
          bg.className = "canvas-group-bg";
          bg.textContent = node.background;
          body.append(bg);
        }
        break;
      }
    }
  },
};
export type CardsMethods = typeof cardsMethods;
