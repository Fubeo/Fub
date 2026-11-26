// Il motore della lavagna: ciò che entra (file trascinati o incollati,
// depositi). Metodi della classe `CanvasEngine`, montati sul suo prototipo
// da `engine.ts` (`editors/core/mix-methods.ts`).

import { errorText } from "../../host/errors";
import { t } from "../../i18n/strings";
import { parseTsv } from "../core/tsv";
import { DROP_GROUP_THRESHOLD, markdownTable, sortedDrop, type DropFile } from "./drop-layout";
import { ENTRIES_DRAG_TYPE, NOTE_DRAG_TYPE } from "../../ui/drag-types";
import { cardKindOf, type Rect } from "../core/cards/contract";
import { CANVAS_CLIPBOARD_TYPE } from "./clipboard";
import { CanvasDepositError } from "../../state/canvas-intake";
import { CanvasCoreError, type CanvasCompiled, type CanvasIntentOp } from "./wasm/core";
import { MEASURE_IMAGE_PARALLEL, MAX_DROP_GHOSTS, CanvasDepositCards } from "./engine-options";
import { DropGhost } from "./engine-parts";
import { snap, measuredImage, isVaultPath, externalUrl } from "./engine-geometry";
import { setOp, lostCore } from "./engine-names";
import type { CanvasEngine } from "./engine";

export const intakeMethods = {
  _showIntakeError(this: CanvasEngine, error: unknown): void {
    if (this._destroyed) return;
    // Qui arrivano anche i messaggi che l'editor scrive di proposito (il
    // deposito, un allegato troppo grande): `errorText` li tiene, e legge
    // l'errore tipizzato dell'host senza «[object Object]».
    this._intakeError = errorText(error).slice(0, 300);
    this._drawToolbar();
  },

  async _intake(this: CanvasEngine, event: DragEvent | ClipboardEvent): Promise<void> {
    if (event.target instanceof Element && event.target.closest("input,textarea,[contenteditable=true]")) return;
    const drop = event.type === "drop" && "dataTransfer" in event;
    const data = drop ? event.dataTransfer : "clipboardData" in event ? event.clipboardData : null;
    const port = this._options.attachments;
    const documentId = this._options.documentId;
    if (!data || this._readOnly || !this._doc || this._destroyed || this._isSceneOversized()) return;
    // Le schede di Fub negli appunti (T68) vincono sul loro Markdown; una
    // forma rotta si incolla come testo.
    const cards = drop ? "" : data.getData(CANVAS_CLIPBOARD_TYPE) || "";
    if (cards && this._pasteCards(event, cards)) return;
    if (!port && data.files.length) return;
    const text = data.getData("text/plain") || cards;
    if (!port && !text) return;
    this._intakeError = "";
    this._drawToolbar();
    event.preventDefault();
    const before = this._source;
    const epoch = this._epoch;
    const stale = (): boolean => this._destroyed || this._readOnly || this._source !== before
      || this._epoch !== epoch || !this._doc;
    // Il punto e la scheda sotto si prendono subito: durante il deposito il
    // puntatore si muove.
    const point = this._intakePoint(event, drop);
    const existing = drop ? this._nodeAt(this._elementAt(event.clientX, event.clientY) ?? null) : null;
    const files = [...new Set(port?.expandFiles ? await port.expandFiles(data) : [...data.files])];
    if (files.length && (!port || !documentId)) return;
    // Le schede che questo gesto fa nascere, per percorso: «Fanne una copia»
    // le ripunta per id (T32b).
    const born = new Map<string, string[]>();
    const bear = (path: string, id: string): void => { born.set(path, [...(born.get(path) ?? []), id]); };
    // External bytes pass the explicit deposit. Internal folder paths resolve
    // only via the host port; never trust a raw DataTransfer path.
    // Un deposito fermato a metà porta i percorsi già fatti: le loro schede
    // nascono lo stesso, e l'errore si mostra dopo, in ogni uscita (T15b).
    let paths: readonly string[] = [];
    let failure: CanvasDepositError | null = null;
    if (files.length) {
      try {
        paths = await port!.deposit(files, documentId!, this._depositCards(born));
      } catch (error) {
        if (!(error instanceof CanvasDepositError)) throw error;
        paths = error.paths;
        failure = error;
      }
    } else if (port?.resolvePaths && documentId) {
      paths = await port.resolvePaths(data, documentId);
    }
    try {
      if (stale()) return;
      const unique = [...new Set(paths)].filter(isVaultPath);
      if ((!unique.length && !text) || (paths.length > 0 && !unique.length)) return;
      const ops: CanvasIntentOp[] = [];
      // Una nota sola rilasciata dal vault, senza Alt: dopo il commit si apre
      // il selettore delle sezioni (T74). Un file depositato dal computer non
      // è ancora nell'indice: lo si sceglie dopo, con «Parti…».
      const single = drop && !files.length && unique.length === 1 && !(event as DragEvent).altKey ? unique[0]! : null;
      const file = this._doc!.nodes.find((node) => node.id === existing && node.type === "file");
      // Su una scheda di file il primo file ne prende il posto (A-8): una `set`.
      if (file && unique.length) {
        const path = unique.shift()!;
        const op = setOp(file, { ...file, file: path, subpath: undefined });
        if (op) ops.push(op);
        bear(path, file.id);
      }
      if (unique.length) {
        const items = await this._bornItems(unique);
        if (stale()) return;
        ops.push(...this._dropOps(items, point, bear));
      }
      // Gli appunti diventano testo solo se non c'era un file da depositare:
      // un file rifiutato non si trasforma in una scheda di testo (T15b).
      if (!paths.length && text && !failure) {
        const table = await this._pastedTable(data, text);
        if (stale()) return;
        const url = table === null ? externalUrl(text.trim()) : null;
        // La forma breve di `add_card` (T9): la misura la dà il nucleo.
        ops.push({ op: "add_card", ...(url ? { url } : { text: table ?? text }), x: snap(point.x), y: snap(point.y) });
      }
      // Una lista sola: un annulla toglie tutto ciò che è nato.
      const committed = this._writeOps(ops) !== null;
      const card = single === null ? undefined : born.get(single)?.[0];
      if (committed && card !== undefined && this._partsPickerSetting) void this._openParts(card, "drop");
    } finally {
      // Dopo le schede, e in ogni uscita: uscire presto non deve perdere l'errore.
      if (failure) this._showIntakeError(failure);
    }
  },

  /**
   * La porta con cui un gesto dopo il deposito ripunta le schede che il
   * deposito ha fatto nascere (`born`: percorso → id, riempita quando nascono).
   * Ogni scheda si cerca per id e cambia solo se mostra ancora il file di
   * prima: tolta, o già puntata altrove, resta com'è. Tutte in un commit solo.
   */
  _depositCards(this: CanvasEngine, born: ReadonlyMap<string, readonly string[]>): CanvasDepositCards {
    const live = (): boolean => !this._destroyed && !this._readOnly && this._doc !== null;
    return {
      live,
      repoint: (changes) => {
        if (!live()) return 0;
        const doc = this._doc!;
        const ops: CanvasIntentOp[] = [];
        const touched = new Set<string>();
        for (const { from, to } of changes) {
          if (!isVaultPath(to)) continue;
          for (const id of born.get(from) ?? []) {
            const node = doc.nodes.find((candidate) => candidate.id === id);
            if (!node || touched.has(id) || node.type !== "file" || node.file !== from) continue;
            ops.push({ op: "set", id, fields: { file: to } });
            touched.add(id);
          }
        }
        return ops.length > 0 && this._writeOps(ops) !== null ? ops.length : 0;
      },
    };
  },

  /**
   * Il punto della lavagna in cui nasce ciò che arriva: quello del rilascio;
   * per un incolla, l'ultimo punto in cui il puntatore è stato visto sulla
   * vista, sennò il centro della vista.
   */
  _intakePoint(this: CanvasEngine, event: DragEvent | ClipboardEvent | null, drop: boolean): { x: number; y: number } {
    if (drop && event && "clientX" in event) return this._screenToWorld(event.clientX, event.clientY);
    if (this._pointerSeen) return this._screenToWorld(this._pointerSeen.x, this._pointerSeen.y);
    const rect = this._viewport.getBoundingClientRect();
    return this._screenToWorld(rect.left + this._viewport.clientWidth / 2, rect.top + this._viewport.clientHeight / 2);
  },

  /**
   * I file lasciati cadere, ognuno con le dimensioni del suo contenuto quando
   * si sanno: le immagini chiedono i loro pixel alla porta, poche alla volta;
   * una misura che non c'è, fallisce o non arriva in tempo non si dà, e il
   * nucleo prende la misura di serie della specie.
   */
  async _bornItems(this: CanvasEngine, paths: readonly string[]): Promise<DropFile[]> {
    const items: DropFile[] = paths.map((path) => ({ path }));
    const measure = this._options.measureImage;
    if (!measure) return items;
    const images = items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => cardKindOf({ id: "", type: "file", file: item.path, x: 0, y: 0, width: 0, height: 0 }) === "image");
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < images.length && !this._destroyed) {
        const { item, index } = images[next++]!;
        const size = await measuredImage(measure, item.path);
        if (size) items[index] = { ...item, contentSize: [size.width, size.height] };
      }
    };
    await Promise.all(Array.from({ length: Math.min(MEASURE_IMAGE_PARALLEL, images.length) }, worker));
    return items;
  },

  /**
   * Le operazioni dei file lasciati cadere in `at` (T24): la tela li ordina
   * per nome (`sortedDrop`), poi un `add_card` per file, con il suo `id` e
   * `content_size` quando la misura si sa; con più file la griglia del
   * nucleo (`layout` `grid`) dal punto del rilascio, agganciato a 8, e oltre
   * `DROP_GROUP_THRESHOLD` il gruppo che li tiene (`group`). Un file solo
   * nasce già lì: la griglia di una scheda è il suo angolo agganciato.
   * `bear` riceve ogni scheda che nasce, col suo percorso; `newId` dà gli id.
   */
  _dropOps(
    this: CanvasEngine,
    items: readonly DropFile[],
    at: { readonly x: number; readonly y: number },
    bear: (path: string, id: string) => void,
    newId: () => string = () => this._newId(),
  ): CanvasIntentOp[] {
    const x = snap(at.x);
    const y = snap(at.y);
    const sorted = sortedDrop(items);
    const ops: CanvasIntentOp[] = [];
    const ids: string[] = [];
    for (const item of sorted) {
      const id = newId();
      ids.push(id);
      bear(item.path, id);
      ops.push({
        op: "add_card",
        id,
        file: item.path,
        ...(item.contentSize ? { content_size: [...item.contentSize] } : {}),
        ...(sorted.length === 1 ? { x, y } : {}),
      });
    }
    if (sorted.length > 1) ops.push({ op: "layout", ids, kind: "grid", x, y });
    if (sorted.length > DROP_GROUP_THRESHOLD) {
      ops.push({ op: "group", ids, label: t("canvas.intake.group", { count: String(sorted.length) }) });
    }
    return ops;
  },

  /**
   * Le celle copiate come tabella Markdown: l'HTML con una tabella, tramite
   * la porta; sennò il testo a tabulazioni su più righe. `null` se non sono
   * celle.
   */
  async _pastedTable(this: CanvasEngine, data: DataTransfer, text: string): Promise<string | null> {
    const convert = this._options.clipboardMarkdown;
    if (convert && /<table[\s>]/i.test(data.getData("text/html") ?? "")) {
      const markdown = await convert(data).catch(() => null);
      if (markdown && markdown.trim()) return markdown;
    }
    if (!text.includes("\t")) return null;
    const rows = parseTsv(text);
    if (rows.length < 2) return null;
    return markdownTable(rows) || null;
  },

  /**
   * I rettangoli tratteggiati dove nasceranno le schede di un trascinamento
   * di file o di voci dell'albero: uno per file, se si sa quanti sono, sennò
   * uno (le voci dell'albero non si leggono prima del rilascio).
   */
  _showDropGhosts(this: CanvasEngine, event: DragEvent): void {
    const data = event.dataTransfer;
    if (!data || !this._options.attachments) return;
    const types = [...(data.types ?? [])];
    // Senza tipi leggibili (WebKit durante il trascinamento) può essere un file.
    const carries = types.length === 0 || types.includes("Files")
      || types.includes(ENTRIES_DRAG_TYPE) || types.includes(NOTE_DRAG_TYPE);
    if (!carries) {
      this._hideDropGhosts();
      return;
    }
    const count = Math.max(1, [...(data.items ?? [])].filter((item) => item.kind === "file").length);
    const pointer = this._screenToWorld(event.clientX, event.clientY);
    // I riquadri si calcolano una volta, all'entrata (o quando cambia il
    // numero dei file): poi seguono il puntatore sulla griglia, senza
    // chiamare il nucleo a ogni movimento.
    if (this._dropGhostCount !== count) {
      this._dropGhost = this._dropGhostShape(count, pointer);
      this._dropGhostCount = count;
    }
    const ghost = this._dropGhost;
    if (!ghost) {
      this._dropGhosts?.remove();
      this._dropGhosts = null;
      return;
    }
    const shiftX = snap(pointer.x) - ghost.x;
    const shiftY = snap(pointer.y) - ghost.y;
    let layer = this._dropGhosts;
    if (!layer) {
      layer = document.createElement("div");
      layer.className = "canvas-drop-ghosts";
      layer.setAttribute("aria-hidden", "true");
      this._viewport.append(layer);
      this._dropGhosts = layer;
    }
    layer.style.transform = `translate(${this._camera.x}px, ${this._camera.y}px) scale(${this._camera.zoom})`;
    // Il filo e il numero restano della stessa misura sullo schermo (la pelle divide per lo zoom).
    layer.style.setProperty("--canvas-zoom", String(this._camera.zoom));
    // Oltre i dodici (prototipo T25), la cornice del gruppo che li terrà col
    // numero in mezzo: mentre si trascina si sa quanti sono, non come si chiamano.
    const rects = ghost.group ? [ghost.group] : ghost.cards;
    const grouped = ghost.group !== null;
    while (layer.children.length > rects.length) layer.lastElementChild!.remove();
    rects.forEach((card, index) => {
      let ghost = layer.children[index] as HTMLElement | undefined;
      if (!ghost) {
        ghost = document.createElement("div");
        ghost.className = "canvas-drop-ghost";
        layer.append(ghost);
      }
      ghost.classList.toggle("canvas-drop-ghost-group", grouped);
      if (grouped) {
        let name = ghost.firstElementChild as HTMLElement | null;
        if (!name) {
          name = document.createElement("span");
          name.className = "canvas-drop-ghost-name";
          ghost.append(name);
        }
        const text = t("canvas.intake.group", { count });
        if (name.textContent !== text) name.textContent = text;
      } else {
        ghost.replaceChildren();
      }
      ghost.style.transform = `translate(${card.x + shiftX}px, ${card.y + shiftY}px)`;
      ghost.style.width = `${card.width}px`;
      ghost.style.height = `${card.height}px`;
    });
  },

  /**
   * I riquadri di `count` file che nascerebbero in `at`: le operazioni del
   * rilascio (`_dropOps`, con nomi che tengono l'ordine dato e la misura di
   * serie di un file) compilate dal nucleo senza scrivere niente, così la
   * griglia e il gruppo sono quelli che il rilascio farà. `null` se il nucleo
   * non c'è o le rifiuta (una lavagna piena): allora nessun riquadro.
   */
  _dropGhostShape(this: CanvasEngine, count: number, at: { readonly x: number; readonly y: number }): DropGhost | null {
    const core = this._core;
    if (!core || this._destroyed || count > MAX_DROP_GHOSTS) return null;
    const items = Array.from({ length: count }, (_, index) => ({ path: String(index).padStart(8, "0") }));
    // Gli id dei riquadri sono suoi: non consumano quelli di `newId`.
    const ids: string[] = [];
    const ops = this._dropOps(items, at, (_path, id) => ids.push(id), () => `drop-ghost-${ids.length}`);
    let compiled: CanvasCompiled;
    try {
      compiled = core.compile(ops, this._seed());
    } catch (error) {
      if (lostCore(error)) {
        this._lose();
        return null;
      }
      if (error instanceof CanvasCoreError) return null;
      throw error;
    }
    const placed = new Map<string, Rect>();
    for (const patch of compiled.patches) {
      if (patch.kind === "upsert-node") {
        const { x, y, width, height } = patch.after;
        placed.set(patch.after.id, { x, y, width, height });
      }
    }
    const cards = ids.flatMap((id) => placed.get(id) ?? []);
    const groupId = count > DROP_GROUP_THRESHOLD ? compiled.created[compiled.created.length - 1] : undefined;
    const group = groupId === undefined ? null : placed.get(groupId) ?? null;
    return { count, x: snap(at.x), y: snap(at.y), cards, group };
  },

  _hideDropGhosts(this: CanvasEngine): void {
    this._dropGhosts?.remove();
    this._dropGhosts = null;
    this._dropGhost = null;
    this._dropGhostCount = null;
  },

  /**
   * Ciò che la lavagna vuota riceve, dagli appunti o dal selettore dei file: lo
   * stesso evento di Ctrl+V sulla vista, così passa dalla stessa strada
   * (`_intake`) e dal deposito, come un rilascio.
   */
  _receive(this: CanvasEngine, data: DataTransfer): void {
    this._viewport.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  },
};
export type IntakeMethods = typeof intakeMethods;
