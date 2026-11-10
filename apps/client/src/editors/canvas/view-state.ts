// Riaprire dove eri (N6 T36): la vista di una lavagna, ricordata da Fub su
// questo computer e non nel file. Riaprendo la lavagna tornano la camera, le
// schede scelte e la pagina di ogni scheda PDF; il `.canvas` non cambia.
//
// Lo stato sta nello stato di vista `canvas.view:<documentId>`:
//
//   { "version": 1, "camera": { "x", "y", "zoom" }, "selection": [id…],
//     "pages": { nodeId: pagina }, "navigator": false, "grid": true }
//
// `"navigator": false` c'è solo quando «Nascondi il navigatore» l'ha spento per
// questa lavagna (T55); senza, il navigatore è acceso. `"grid"` c'è solo quando
// Ctrl+' ha scelto la griglia per questa lavagna (T71); senza, vale
// `canvas.grid` delle impostazioni.
//
// Al più 500 schede scelte e 1000 pagine (le più recenti). Una versione che
// questo client non conosce si ignora e non si riscrive mai; i campi in più
// della versione 1 (il tema per scheda dei passi dopo) si conservano a ogni
// riscrittura. Uno stato rotto vale come nessuno
// stato: la lavagna parte come se non ci fosse, e la prima scrittura lo
// sostituisce.
//
// La scrittura è una comodità: aspetta 500 ms dopo l'ultimo cambio, parte
// subito alla chiusura, e se non riesce lascia una riga nel registro e basta.

/// La versione della forma che questo client legge e scrive.
export const CANVAS_VIEW_VERSION = 1;
/// Quante schede scelte si ricordano, al più (le prime della scelta).
export const CANVAS_VIEW_SELECTION_MAX = 500;
/// Quante pagine di PDF si ricordano, al più (le più recenti).
export const CANVAS_VIEW_PAGES_MAX = 1000;
/// Quanto aspetta la scrittura dopo l'ultimo cambio.
export const CANVAS_VIEW_WRITE_DELAY_MS = 500;

/// La chiave dello stato di vista della lavagna `documentId`.
export function canvasViewKey(documentId: string): string {
  return `canvas.view:${documentId}`;
}

/// La camera della lavagna: lo spostamento in pixel della vista e lo zoom.
export interface CanvasViewCamera {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

/// La vista ricordata di una lavagna.
export interface CanvasView {
  /// `null`: nessuna camera ricordata (si inquadra tutto).
  readonly camera: CanvasViewCamera | null;
  readonly selection: readonly string[];
  /// La pagina (da 1) di ogni scheda PDF, dalla meno alla più recente.
  readonly pages: ReadonlyMap<string, number>;
  /// «Nascondi il navigatore» per questa lavagna (T55); assente vale acceso.
  readonly navigatorHidden?: boolean;
  /// La griglia scelta con Ctrl+' per questa lavagna (T71); assente vale `canvas.grid`.
  readonly grid?: boolean;
}

/// Ciò che si legge dallo stato di vista.
export type CanvasViewRead =
  /// Uno stato della versione 1: la vista e i campi che questo client non usa.
  | { readonly kind: "state"; readonly view: CanvasView; readonly extra: Readonly<Record<string, unknown>> }
  /// Nessuno stato, o uno stato rotto: si parte come oggi, e si può scrivere.
  | { readonly kind: "empty" }
  /// Una versione che questo client non conosce: si parte come oggi, e non si scrive.
  | { readonly kind: "foreign" };

const KNOWN_FIELDS = new Set(["version", "camera", "selection", "pages", "navigator", "grid"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/// La camera di `value`, o `null` se non è una camera (numeri finiti, zoom
/// positivo).
function cameraOf(value: unknown): CanvasViewCamera | null {
  if (!isRecord(value)) return null;
  const { x, y, zoom } = value;
  if (typeof x !== "number" || typeof y !== "number" || typeof zoom !== "number") return null;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(zoom) || !(zoom > 0)) return null;
  return { x, y, zoom };
}

/// `value` come stato di vista. Un oggetto con una `version` diversa da 1 è
/// di un'altra versione; ogni altra cosa che non è un oggetto della versione
/// 1 è rotta. Dentro la versione 1 un campo che non si legge vale vuoto, e
/// una voce sbagliata della scelta o delle pagine si salta.
export function parseCanvasView(value: unknown): CanvasViewRead {
  if (!isRecord(value)) return { kind: "empty" };
  if (!("version" in value)) return { kind: "empty" };
  if (value.version !== CANVAS_VIEW_VERSION) return { kind: "foreign" };
  const camera = cameraOf(value.camera);
  const selection: string[] = [];
  if (Array.isArray(value.selection)) {
    const seen = new Set<string>();
    for (const id of value.selection) {
      if (typeof id !== "string" || id === "" || seen.has(id)) continue;
      seen.add(id);
      selection.push(id);
      if (selection.length >= CANVAS_VIEW_SELECTION_MAX) break;
    }
  }
  const pages = new Map<string, number>();
  if (isRecord(value.pages)) {
    for (const [id, page] of Object.entries(value.pages)) {
      if (id !== "" && typeof page === "number" && Number.isSafeInteger(page) && page >= 1) pages.set(id, page);
    }
    trimPages(pages);
  }
  const extra: Record<string, unknown> = {};
  for (const [field, entry] of Object.entries(value)) {
    if (!KNOWN_FIELDS.has(field)) extra[field] = entry;
  }
  const view: CanvasView = {
    camera,
    selection,
    pages,
    ...(value.navigator === false ? { navigatorHidden: true } : {}),
    ...(typeof value.grid === "boolean" ? { grid: value.grid } : {}),
  };
  return { kind: "state", view, extra };
}

/// Toglie le pagine più vecchie oltre il limite.
function trimPages(pages: Map<string, number>): void {
  for (const id of pages.keys()) {
    if (pages.size <= CANVAS_VIEW_PAGES_MAX) break;
    pages.delete(id);
  }
}

/// Lo stato di vista da scrivere: i campi in più per primi, poi quelli di
/// questo client, nei limiti. Le pagine vanno dalla meno alla più recente
/// (un id fatto di sole cifre, in JavaScript, va comunque in testa: conta
/// solo quando si superano le 1000 pagine).
export function serializeCanvasView(
  view: CanvasView,
  extra: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  const pages: Record<string, number> = {};
  const recent = [...view.pages].slice(-CANVAS_VIEW_PAGES_MAX);
  for (const [id, page] of recent) pages[id] = page;
  const out: Record<string, unknown> = {};
  for (const [field, entry] of Object.entries(extra)) {
    if (!KNOWN_FIELDS.has(field)) out[field] = entry;
  }
  out.version = CANVAS_VIEW_VERSION;
  if (view.camera) out.camera = { x: view.camera.x, y: view.camera.y, zoom: view.camera.zoom };
  out.selection = view.selection.slice(0, CANVAS_VIEW_SELECTION_MAX);
  out.pages = pages;
  if (view.navigatorHidden === true) out.navigator = false;
  if (view.grid !== undefined) out.grid = view.grid;
  return out;
}

/// La porta degli stati di vista di questo computer (`api.viewState` e
/// `api.setViewState`).
export interface CanvasViewStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}

/// Dove la lavagna legge e scrive la sua vista ricordata.
export interface CanvasViewMemory {
  /// Lo stato grezzo della lavagna; legge dopo le scritture già chieste.
  read(documentId: string): Promise<unknown>;
  /// Scrive lo stato grezzo; le scritture vanno in fila, così resta l'ultima.
  write(documentId: string, value: unknown): Promise<void>;
}

/// La memoria sopra `store`: per ogni lavagna una fila, così una lettura
/// (la lavagna riaperta) vede la scrittura dell'ultima chiusura. Una
/// scrittura che fallisce non ferma la fila.
export function createCanvasViewMemory(store: CanvasViewStore): CanvasViewMemory {
  const queues = new Map<string, Promise<unknown>>();
  const enqueue = <T>(key: string, work: () => Promise<T>): Promise<T> => {
    const before = queues.get(key) ?? Promise.resolve();
    const run = before.then(work, work);
    const tail = run.then(() => undefined, () => undefined);
    queues.set(key, tail);
    // La fila finita non resta nella mappa.
    void tail.then(() => {
      if (queues.get(key) === tail) queues.delete(key);
    });
    return run;
  };
  return {
    read: (documentId) => {
      const key = canvasViewKey(documentId);
      return enqueue(key, () => store.get(key));
    },
    write: (documentId, value) => {
      const key = canvasViewKey(documentId);
      return enqueue(key, () => store.set(key, value));
    },
  };
}

/// Ciò che la tela ha adesso: la camera e la scelta; `null` se non mostra
/// niente da ricordare (nessun documento aperto).
export type CanvasViewSnapshot = {
  readonly camera: CanvasViewCamera;
  readonly selection: readonly string[];
  /// Il navigatore spento per questa lavagna (T55).
  readonly navigatorHidden?: boolean;
  /// La griglia scelta con Ctrl+' per questa lavagna (T71); assente se non l'ha scelta.
  readonly grid?: boolean;
} | null;

type RecorderStatus = "idle" | "reading" | "ready" | "frozen" | "closed";

/// Il registratore della vista di una lavagna: legge lo stato all'apertura,
/// tiene le pagine dei PDF, e scrive con un ritardo. Ogni apertura (`begin`)
/// è un giro: la lettura di un giro vecchio non vale più. Prima che la
/// lettura arrivi non si scrive niente (si coprirebbe lo stato ricordato con
/// la vista intera), e dopo la chiusura nessuna scrittura parte più.
export class CanvasViewRecorder {
  readonly #memory: CanvasViewMemory;
  readonly #documentId: string;
  readonly #snapshot: () => CanvasViewSnapshot;
  #status: RecorderStatus = "idle";
  #round = 0;
  #extra: Readonly<Record<string, unknown>> = {};
  /// Le pagine dei PDF, dalla meno alla più recente.
  #pages = new Map<string, number>();
  /// Le pagine cambiate in questo giro prima che la lettura arrivasse: vincono su quelle lette.
  #touched = new Map<string, number>();
  /// Lo stato scritto (o letto) per ultimo, per non riscrivere lo stesso.
  #last: string | null = null;
  #timer: ReturnType<typeof setTimeout> | undefined = undefined;

  constructor(memory: CanvasViewMemory, documentId: string, snapshot: () => CanvasViewSnapshot) {
    this.#memory = memory;
    this.#documentId = documentId;
    this.#snapshot = snapshot;
  }

  /// Un'apertura: scrive subito ciò che c'era, poi legge. Dà la vista da
  /// riprendere, o `null` (niente stato, stato rotto o di un'altra
  /// versione, lettura fallita, giro superato, registratore chiuso).
  async begin(): Promise<CanvasView | null> {
    if (this.#status === "closed") return null;
    this.flush();
    const round = ++this.#round;
    this.#status = "reading";
    this.#touched = new Map();
    let raw: unknown;
    try {
      raw = await this.#memory.read(this.#documentId);
    } catch (error) {
      if (this.#stale(round)) return null;
      // Senza sapere che cosa c'è non si scrive: potrebbe essere di un'altra versione.
      this.#status = "frozen";
      console.warn("canvas: la vista ricordata non si legge", error);
      return null;
    }
    if (this.#stale(round)) return null;
    const read = parseCanvasView(raw);
    if (read.kind === "foreign") {
      this.#status = "frozen";
      this.#pages = new Map(this.#touched);
      return null;
    }
    const pages = read.kind === "state" ? new Map(read.view.pages) : new Map<string, number>();
    for (const [id, page] of this.#touched) {
      pages.delete(id);
      pages.set(id, page);
    }
    trimPages(pages);
    this.#pages = pages;
    this.#extra = read.kind === "state" ? read.extra : {};
    this.#last = read.kind === "state" ? JSON.stringify(serializeCanvasView(read.view, read.extra)) : null;
    this.#status = "ready";
    // Una pagina voltata mentre si leggeva è già un cambio da scrivere.
    if (this.#touched.size > 0) this.changed();
    return read.kind === "state" ? { ...read.view, pages } : null;
  }

  /// La lettura del giro `round` non vale più: un'apertura dopo, o la chiusura.
  #stale(round: number): boolean {
    return round !== this.#round || this.#status === "closed";
  }

  /// La pagina ricordata della scheda `id`, o `null`.
  page(id: string): number | null {
    return this.#pages.get(id) ?? null;
  }

  /// La scheda `id` mostra la pagina `page`: diventa la più recente.
  pageChanged(id: string, page: number): void {
    if (this.#status === "closed" || !Number.isSafeInteger(page) || page < 1) return;
    this.#pages.delete(id);
    this.#pages.set(id, page);
    trimPages(this.#pages);
    if (this.#status === "reading") this.#touched.set(id, page);
    this.changed();
  }

  /// La camera o la scelta sono cambiate: si scrive dopo il ritardo.
  changed(): void {
    if (this.#status !== "ready") return;
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      this.#write();
    }, CANVAS_VIEW_WRITE_DELAY_MS);
  }

  /// Scrive adesso ciò che aspettava il ritardo.
  flush(): void {
    if (this.#timer === undefined) return;
    clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#write();
  }

  /// La lavagna si chiude: l'ultimo stato si scrive, e dopo niente.
  close(): void {
    if (this.#status === "closed") return;
    this.flush();
    clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#status = "closed";
  }

  #write(): void {
    if (this.#status !== "ready") return;
    const snapshot = this.#snapshot();
    if (snapshot === null) return;
    const value = serializeCanvasView({
      camera: snapshot.camera,
      selection: snapshot.selection,
      pages: this.#pages,
      ...(snapshot.navigatorHidden === true ? { navigatorHidden: true } : {}),
      ...(snapshot.grid !== undefined ? { grid: snapshot.grid } : {}),
    }, this.#extra);
    const text = JSON.stringify(value);
    if (text === this.#last) return;
    this.#last = text;
    void this.#memory.write(this.#documentId, value).catch((error: unknown) => {
      // Una comodità: la lavagna va avanti, e la prossima scrittura riprova.
      if (this.#last === text) this.#last = null;
      console.warn("canvas: la vista non si ricorda", error);
    });
  }
}
