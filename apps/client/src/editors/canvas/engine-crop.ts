// Il motore della lavagna: il ritaglio di un'immagine (T78). Metodi della
// classe `CanvasEngine`, montati sul suo prototipo da `engine.ts`
// (`editors/core/mix-methods.ts`).

import { cardKindOf } from "../core/cards/contract";
import { PARTS_KEY, cardParts, nodeParts, writeParts, type PartsExtra } from "./parts";
import { cardTarget } from "./sources";
import { WHOLE_ZONE, isWholeZone, openCropEditor, zoneOf, zoneParts, zoneRatio, type CropPicture, type ImageZone } from "./crop";
import { noteExcerptOf } from "./excerpt";
import { type CanvasNode } from "./model";
import { type CanvasIntentOp } from "./wasm/core";
import { CANVAS_MIN_SIZE } from "./engine-options";
import { CropSession, CardEntry } from "./engine-parts";
import { isVaultPath } from "./engine-geometry";
import { setOp } from "./engine-names";
import type { CanvasEngine } from "./engine";

export const cropMethods = {
  // --- il ritaglio di un'immagine (T78) ------------------------------------------

  /** C'è chi mostra le immagini nelle schede: senza, niente da ritagliare. */
  _cropRenderer(this: CanvasEngine): boolean {
    return this._options.cards?.registry.rendererFor("image") != null;
  },

  /** La scheda è un'immagine del vault, che si può ritagliare. */
  _cropImage(this: CanvasEngine, node: CanvasNode): node is CanvasNode & { file: string } {
    return node.type === "file" && cardKindOf(node) === "image" && isVaultPath(cardTarget(node).path);
  },

  /** La scheda `id` dice che il suo file manca o non si legge. */
  _cropUnreadable(this: CanvasEngine, id: string): boolean {
    const entry = this._cards.get(id);
    if (!entry) return false;
    if (entry.missingFor !== null) return true;
    const state = entry.body.querySelector<HTMLElement>(".canvas-card-image")?.dataset.cardState;
    return state === "unreadable" || state === "too-large" || state === "missing";
  },

  /**
   * La parte della chiave del corpo che dice la vista: le parti che la scheda
   * mostra, così una zona nuova (o tolta) rimonta la vista. Col ritaglio
   * aperto la scheda mostra l'immagine intera.
   */
  _viewKeyOf(this: CanvasEngine, node: CanvasNode): string {
    const parts = this._crop?.node === node.id ? null : (node[PARTS_KEY] ?? null);
    // L'avviso di un estratto ha i suoi pulsanti solo fuori dalla sola lettura (T75).
    const reading = this._readOnly && noteExcerptOf(node) !== null ? ":read" : "";
    return parts === null ? `view${reading}` : `view${reading}:${JSON.stringify(parts)}`;
  },

  /** L'altezza che la scheda mostra: la sua, o col ritaglio aperto quella dell'immagine intera. */
  _shownHeight(this: CanvasEngine, node: CanvasNode): number {
    const crop = this._crop;
    return crop?.node === node.id && crop.height !== null ? crop.height : node.height;
  },

  /**
   * Apre «Ritaglia e ruota» sulla scheda `id`: la scheda mostra l'immagine
   * intera, viva, con sopra la zona e le maniglie e sotto la barra
   * (`crop.ts`). Non scrive niente: lo fa `_finishCrop`.
   */
  _beginCrop(this: CanvasEngine, id: string): void {
    const node = this._doc?.nodes.find((one) => one.id === id);
    if (!node || !this._cropImage(node) || this._readOnly || this._destroyed || this._isSceneOversized()) return;
    if (!this._cropRenderer() || this._cropUnreadable(id)) return;
    if (this._crop) this._finishCrop(null);
    if (this._activeId !== null) this._leaveCard(true, false);
    const entry = this._cards.get(id);
    if (!entry) return;
    if (this._selection.length !== 1 || this._selection[0] !== id || this._edgeSelection.length > 0) {
      this._selection = [id];
      this._edgeSelection = [];
      this._options.onSelectionChange();
      this._displaySelection();
    }
    const crop: CropSession = { node: id, path: cardTarget(node).path, editor: null, height: null };
    this._crop = crop;
    // Con una zona la vista si rimonta sull'immagine intera.
    this._refreshCard(entry, node, true);
    entry.article.dataset.cardCropping = "";
    const ink = (this._inkCards.get(id)?.length ?? 0) > 0;
    crop.editor = openCropEditor({
      frame: entry.body,
      chrome: this._area,
      zone: zoneOf(cardParts(node)),
      ink,
      picture: () => entry.body.querySelector<CropPicture & HTMLElement>(".canvas-card-image .canvas-card-picture"),
      lifetime: this._life,
      onTurn: () => this._fitCropHeight(),
      onMeasured: () => this._fitCropHeight(),
      onDone: (zone) => this._finishCrop("done", zone),
      onCancel: () => this._finishCrop(null),
      onRemove: () => this._finishCrop("remove"),
    });
    this._fitCropHeight();
    this._refreshLive();
    this._syncSelectionBar();
    this._placeCropBar();
    crop.editor.focus();
  },

  /**
   * Col ritaglio aperto la scheda tiene la larghezza e prende le proporzioni
   * dell'immagine intera ruotata, per mostrarla tutta; solo sullo schermo.
   */
  _fitCropHeight(this: CanvasEngine): void {
    const crop = this._crop;
    const entry = crop ? this._cards.get(crop.node) : undefined;
    const natural = crop?.editor?.natural() ?? null;
    if (!crop?.editor || !entry || !natural) return;
    const height = this._cropHeightFor(entry, zoneRatio({ rect: WHOLE_ZONE.rect, turn: crop.editor.zone().turn }, natural));
    if (height === crop.height) return;
    crop.height = height;
    entry.article.style.height = `${height}px`;
    crop.editor.layout();
    this._placeCropBar();
  },

  /**
   * Posa la barra del ritaglio sotto la sua scheda, nella vista, come la barra
   * della selezione: la stessa misura a ogni zoom, sopra la scheda se sotto
   * non c'è posto (`selectionBarPlaceBelow`). Passa di qui a ogni camera.
   */
  _placeCropBar(this: CanvasEngine): void {
    const crop = this._crop;
    const node = crop ? this._doc?.nodes.find((one) => one.id === crop.node) : undefined;
    if (!crop?.editor || crop.editor.closed || !node) return;
    const zoom = this._camera.zoom;
    const height = crop.height ?? node.height;
    const rect = this._viewport.getBoundingClientRect();
    crop.editor.place(
      {
        left: node.x * zoom + this._camera.x,
        top: node.y * zoom + this._camera.y,
        right: (node.x + node.width) * zoom + this._camera.x,
        bottom: (node.y + height) * zoom + this._camera.y,
      },
      { width: rect.width || 800, height: rect.height || 600 },
      { left: this._viewport.offsetLeft, top: this._viewport.offsetTop },
    );
  },

  /**
   * L'altezza della scheda `entry` che dà al suo contenuto le proporzioni
   * `ratio` (larghezza su altezza) alla larghezza di adesso: il corpo senza
   * il suo margine interno, e la testata com'è (come `_contentSize`).
   */
  _cropHeightFor(this: CanvasEngine, entry: CardEntry, ratio: number): number {
    const node = entry.node;
    const shown = this._shownHeight(node);
    const style = getComputedStyle(entry.body);
    const padX = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
    const padY = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
    const innerWidth = entry.body.clientWidth - padX;
    const innerHeight = entry.body.clientHeight - padY;
    const known = innerWidth > 0 && innerHeight > 0;
    const width = known ? innerWidth : node.width;
    const rest = known ? shown - innerHeight : 0;
    return Math.max(CANVAS_MIN_SIZE, Math.round(rest + width / ratio));
  },

  /**
   * Chiude il ritaglio. `done`: la zona diventa `fub:parts` `image` (T73) e
   * la scheda, tenendo la larghezza, prende le proporzioni della zona
   * ruotata, in un commit solo; `remove`: il campo si toglie e la scheda
   * prende le proporzioni dell'immagine intera; `null` (Esc): tutto com'era.
   * Il file dell'immagine non si scrive mai: cambia solo la lavagna.
   */
  _finishCrop(this: CanvasEngine, how: "done" | "remove" | null, zone?: ImageZone): void {
    const crop = this._crop;
    if (!crop) return;
    const editor = crop.editor;
    const entry = this._cards.get(crop.node);
    const doc = this._doc;
    const node = doc?.nodes.find((one) => one.id === crop.node);
    let op: CanvasIntentOp | null = null;
    if (how !== null && doc && node && entry && node.type === "file" && cardTarget(node).path === crop.path && !this._readOnly) {
      const chosen = how === "remove" ? WHOLE_ZONE : zone ?? editor?.zone() ?? WHOLE_ZONE;
      const next: CanvasNode = { ...node };
      delete next[PARTS_KEY];
      let ok = true;
      if (!isWholeZone(chosen)) {
        // I campi sconosciuti di una zona valida restano.
        const read = nodeParts(node);
        const extra: PartsExtra = read?.state === "ok" && read.parts.kind === "image" ? read.parts.extra : {};
        const written = writeParts(crop.path, zoneParts(chosen, extra));
        if (written.outcome === "written") {
          delete next.subpath;
          if (written.subpath !== null) next.subpath = written.subpath;
          if (written.parts !== null) next[PARTS_KEY] = written.parts;
        } else {
          ok = false;
        }
      }
      const natural = editor?.natural() ?? null;
      if (ok && natural) next.height = this._cropHeightFor(entry, zoneRatio(chosen, natural));
      op = ok ? setOp(node, next) : null;
    }
    const focused = editor !== null && entry !== undefined && entry.article.contains(document.activeElement);
    this._crop = null;
    editor?.close();
    if (entry) delete entry.article.dataset.cardCropping;
    if (op) this._writeOps([op]);
    // Senza commit (Esc, niente di cambiato) la scheda torna com'era: la sua
    // altezza e, se aveva una zona, la sua vista.
    const now = this._doc?.nodes.find((one) => one.id === crop.node);
    if (entry && now && this._cards.get(crop.node) === entry) this._refreshCard(entry, now, true);
    this._refreshLive();
    this._syncSelectionBar();
    if (focused && entry.article.isConnected) entry.article.focus({ preventScroll: true });
  },

  /** Chiude il ritaglio (com'era) se la sua scheda non c'è più, mostra un altro file o la lavagna non si scrive. */
  _syncCrop(this: CanvasEngine): void {
    const crop = this._crop;
    if (!crop) return;
    const node = this._doc?.nodes.find((one) => one.id === crop.node);
    const entry = this._cards.get(crop.node);
    const alive = node !== undefined && this._cropImage(node) && cardTarget(node).path === crop.path
      && entry !== undefined && entry.missingFor === null && entry.body.querySelector(".canvas-crop") !== null;
    if (alive && !this._readOnly && !this._destroyed && !this._isSceneOversized()) return;
    this._finishCrop(null);
  },
};
export type CropMethods = typeof cropMethods;
