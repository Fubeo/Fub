// Il motore della lavagna: il selettore delle sezioni e il lettore di una
// scheda. Metodi della classe `CanvasEngine`, montati sul suo prototipo da
// `engine.ts` (`editors/core/mix-methods.ts`).

import { t } from "../../i18n/strings";
import { type Lifetime } from "../../ui/lifetime";
import {
  type PartsPickerHandle,
  type PartsPickerPlace,
  PARTS_PICKER_MIN_SECTIONS,
  openPartsPicker,
  partsSections,
  type PartsHeading,
} from "./parts-picker";
import { type ReaderHandle, READER_TAP_SLOP, openReader } from "./reader";
import type { CanvasNode } from "./model";
import { type CanvasIntentOp } from "./wasm/core";
import { isVaultPath } from "./engine-geometry";
import { setOp, SECTIONS_PROBE, partsChosen } from "./engine-names";
import { PARTS_KEY, nodeParts, partsFit, writeParts, type PartsExtra } from "./parts";
import { excerptSourcePath, noteExcerptOf } from "./excerpt";
import type { CanvasEngine } from "./engine";

export const cardToolsMethods = {
  // --- il selettore delle sezioni (T74) ---------------------------------------

  /** La scheda mostra una nota di cui si possono scegliere le sezioni (`.md`, T73). */
  _partsNote(this: CanvasEngine, node: CanvasNode): node is CanvasNode & { file: string } {
    return node.type === "file" && isVaultPath(node.file) && partsFit(SECTIONS_PROBE, node.file);
  },

  /**
   * Apre il selettore delle sezioni sulla scheda `id`: dopo il rilascio
   * (`drop`, e solo se la scheda mostra ancora la nota intera) o da «Parti…»
   * (`command`, con le sezioni di adesso già spuntate). Il sommario arriva
   * dall'indice; una nota con meno di due titoli non apre niente, e da
   * «Parti…» la barra dice perché. Una risposta arrivata dopo un'altra
   * richiesta, o dopo che la scheda è cambiata o sparita, non apre niente.
   */
  async _openParts(this: CanvasEngine, id: string, from: "drop" | "command"): Promise<void> {
    const port = this._options.parts;
    const node = this._doc?.nodes.find((one) => one.id === id);
    if (!port || !node || !this._partsNote(node) || this._readOnly || this._destroyed) return;
    const path = node.file;
    const round = ++this._partsRound;
    this._closePartsPicker();
    let headings: readonly PartsHeading[];
    try {
      headings = await port.outline(path);
    } catch {
      headings = [];
    }
    if (round !== this._partsRound || this._destroyed || this._readOnly || !this._doc || this._isSceneOversized()) return;
    const now = this._doc.nodes.find((one) => one.id === id);
    if (!now || !this._partsNote(now) || now.file !== path) return;
    if (from === "drop" && (now.subpath !== undefined || Object.prototype.hasOwnProperty.call(now, PARTS_KEY))) return;
    const sections = partsSections(headings);
    this._partsCounts.set(path, sections.length);
    if (sections.length < PARTS_PICKER_MIN_SECTIONS) {
      if (from === "command") this._showNotice(t("canvas.commands.why.no_sections"));
      return;
    }
    let opened: PartsPickerHandle | null = null;
    const forget = (): void => {
      if (opened !== null && this._partsPicker?.handle === opened) this._partsPicker = null;
    };
    const show = port.show;
    opened = openPartsPicker({
      path,
      sections,
      chosen: partsChosen(now),
      place: () => this._partsPlace(id),
      ...(show ? { show: (file: string, heading: string | null, host: HTMLElement, life: Lifetime) => show.call(port, file, heading, host, life) } : {}),
      onPut: (keys) => {
        forget();
        this._putParts(id, path, keys);
      },
      onClose: forget,
      lifetime: this._life,
    });
    if (!opened.closed) this._partsPicker = { handle: opened, node: id, path };
  },

  /**
   * Scrive le sezioni scelte sulla scheda, in un commit (un annulla riporta
   * la nota intera): una sezione è il `subpath` `#Titolo`; due o più anche
   * `fub:parts` `sections` (T73); nessuna toglie l'una e l'altro. I campi
   * sconosciuti di un `fub:parts` di sezioni valido restano.
   */
  _putParts(this: CanvasEngine, id: string, path: string, keys: readonly string[]): void {
    const doc = this._doc;
    const node = doc?.nodes.find((one) => one.id === id);
    if (!doc || !node || node.type !== "file" || node.file !== path || this._readOnly || this._destroyed) return;
    const next: CanvasNode = { ...node };
    delete next.subpath;
    delete next[PARTS_KEY];
    if (keys.length > 0) {
      const read = nodeParts(node);
      const extra: PartsExtra = read?.state === "ok" && read.parts.kind === "sections" ? read.parts.extra : {};
      const written = writeParts(path, { kind: "sections", sections: keys, extra });
      if (written.outcome !== "written") return;
      if (written.subpath !== null) next.subpath = written.subpath;
      if (written.parts !== null) next[PARTS_KEY] = written.parts;
    }
    // I campi cambiati della scheda, con una `set` (T24).
    const op = setOp(node, next);
    if (op) this._writeOps([op]);
  },

  /**
   * «Mostra tutto il file» (T75): la scheda `id` toglie `fub:parts` e il
   * `subpath` in un commit, e mostra la nota intera; un annulla riporta
   * l'estratto. Una scheda che non è un estratto non cambia.
   */
  _showWholeFile(this: CanvasEngine, id: string): void {
    if (this._readOnly || this._destroyed || this._isSceneOversized()) return;
    this._writeOps(this._wholeFileOps(id));
  },

  /** La `set` che toglie `subpath` e `fub:parts` alla scheda-estratto `id`; `null` se non è un estratto. */
  _wholeFileOps(this: CanvasEngine, id: string): CanvasIntentOp[] | null {
    const node = this._doc?.nodes.find((one) => one.id === id);
    if (!node || !noteExcerptOf(node)) return null;
    const next: CanvasNode = { ...node };
    delete next.subpath;
    delete next[PARTS_KEY];
    const op = setOp(node, next);
    return op ? [op] : null;
  },

  /**
   * Apre la fonte di un estratto alla sua prima sezione (T75): accanto
   * (`beside`, nella finestra stretta nello stesso riquadro, come «Apri a
   * lato per questo») o nel riquadro (`pane`, Ctrl+clic). La scheda non
   * cambia.
   */
  _openExcerptSource(this: CanvasEngine, node: CanvasNode, where: "beside" | "pane"): void {
    const excerpt = noteExcerptOf(node);
    if (!excerpt || node.type !== "file" || !node.file) return;
    const path = excerptSourcePath(node.file, excerpt);
    const open = where === "pane" ? this._options.onOpenPath ?? null : this._besideOpener() ?? this._options.onOpenPath ?? null;
    if (!open) return;
    void Promise.resolve(open(path, this._options.documentId)).catch((error: unknown) => this._showIntakeError(error));
  },

  /** Chiude il selettore se la sua scheda non c'è più, mostra un altro file o la lavagna non si scrive. */
  _syncPartsPicker(this: CanvasEngine): void {
    const open = this._partsPicker;
    if (!open) return;
    const node = this._doc?.nodes.find((one) => one.id === open.node);
    const alive = node !== undefined && node.type === "file" && node.file === open.path;
    if (alive && !this._readOnly && !this._destroyed && !this._isSceneOversized()) return;
    this._closePartsPicker();
  },

  _closePartsPicker(this: CanvasEngine): void {
    const open = this._partsPicker;
    this._partsPicker = null;
    open?.handle.close();
  },

  // --- il lettore (T76) ---------------------------------------------------------

  /** Il puntatore si è mosso con Spazio giù: oltre `READER_TAP_SLOP` non è più un tocco. */
  _spaceTapMoved(this: CanvasEngine, x: number, y: number): void {
    const tap = this._spaceTap;
    if (!tap || tap.spoiled) return;
    if (tap.from === null) {
      tap.from = { x, y };
      return;
    }
    if (Math.hypot(x - tap.from.x, y - tap.from.y) > READER_TAP_SLOP) tap.spoiled = true;
  },

  /**
   * Il tocco di Spazio: con una sola scheda di nota scelta (intera o un
   * estratto) apre il lettore sopra l'area della lavagna. Senza niente
   * scelto, con più schede, con una scheda d'altro o un file mancante non fa
   * niente. La vista e la scelta non cambiano; il fuoco va sulla scheda, e
   * ci torna quando il lettore si chiude.
   */
  _openReaderOnChoice(this: CanvasEngine): void {
    const port = this._options.parts;
    if (!port?.show || this._reader || this._destroyed || !this._doc || this._isSceneOversized()) return;
    if (this._selection.length !== 1 || this._edgeSelection.length > 0) return;
    const node = this._doc.nodes.find((one) => one.id === this._selection[0]);
    if (!node || !this._partsNote(node)) return;
    const entry = this._cards.get(node.id);
    if (!entry || entry.article.hasAttribute("data-card-missing")) return;
    const path = node.file;
    this._closePartsPicker();
    // Il fuoco parte dalla scheda: chiuso il lettore, ci torna.
    entry.article.focus({ preventScroll: true });
    const show = port.show;
    const watch = this._options.cards?.watch;
    let opened: ReaderHandle | null = null;
    opened = openReader({
      host: this._area,
      path,
      excerpt: partsChosen(node),
      writable: this._readerWritable(node),
      port: {
        outline: (file) => port.outline(file),
        show: (file, heading, host, life) => show.call(port, file, heading, host, life),
        ...(watch ? { watch: (file: string, changed: () => void) => watch(file, changed) } : {}),
      },
      onAdd: (keys) => {
        if (this._reader?.handle !== opened) return;
        const now = this._doc?.nodes.find((one) => one.id === node.id);
        if (!now || !this._readerWritable(now)) return;
        this._putParts(node.id, path, keys);
      },
      onClose: (reason) => {
        if (opened === null || this._reader?.handle !== opened) return;
        this._reader = null;
        if (reason === "closed" || this._destroyed) return;
        const back = this._cards.get(node.id);
        if (back?.article.isConnected) back.article.focus({ preventScroll: true });
        else this._viewport.focus({ preventScroll: true });
      },
      lifetime: this._life,
    });
    if (!opened.closed) this._reader = { handle: opened, node: node.id, path };
  },

  /** «+ Aggiungi all'estratto» c'è: un estratto, su una lavagna che si scrive. */
  _readerWritable(this: CanvasEngine, node: CanvasNode): boolean {
    return !this._readOnly && !this._isSceneOversized() && noteExcerptOf(node) !== null;
  },

  /**
   * La lavagna è cambiata col lettore aperto: la scheda tolta, o su un altro
   * file, lo chiude; un'altra scelta di sezioni o la sola lettura lo
   * aggiornano.
   */
  _syncReader(this: CanvasEngine): void {
    const open = this._reader;
    if (!open) return;
    const node = this._doc?.nodes.find((one) => one.id === open.node);
    if (!node || node.type !== "file" || node.file !== open.path || this._destroyed || this._isSceneOversized()) {
      this._reader = null;
      open.handle.close();
      return;
    }
    open.handle.update({ excerpt: partsChosen(node), writable: this._readerWritable(node) });
  },
  /** Dove sono la scheda `id` (con la testata sopra, T39) e la lavagna, nella finestra. */
  _partsPlace(this: CanvasEngine, id: string): PartsPickerPlace {
    const rect = this._viewport.getBoundingClientRect();
    const board = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    const node = this._doc?.nodes.find((one) => one.id === id);
    const zoom = this._camera.zoom;
    let card = node
      ? { left: rect.left + this._camera.x + node.x * zoom, top: rect.top + this._camera.y + node.y * zoom, width: node.width * zoom, height: node.height * zoom }
      : { left: rect.left, top: rect.top, width: 0, height: 0 };
    const handle = this._stage.querySelector(`.canvas-node[data-node="${CSS.escape(id)}"] > .canvas-node-handle`)?.getBoundingClientRect();
    if (handle && handle.height > 0 && handle.top < card.top) {
      card = { ...card, top: handle.top, height: card.top + card.height - handle.top };
    }
    return { card, board, narrow: this._root.hasAttribute("data-narrow") };
  },
};
export type CardToolsMethods = typeof cardToolsMethods;
