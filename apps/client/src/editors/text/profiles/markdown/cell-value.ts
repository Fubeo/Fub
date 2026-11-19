// Un valore di cella nel testo (E23, T53): `![[Conti.xlsx#Budget!C7]]` in
// mezzo a un paragrafo si legge come il valore della cella, col formato del
// foglio («2.520 €»), e un tratteggio d'accento sotto. Il clic apre il foglio
// su quella cella.
//
// - **Che cosa è un valore**: l'embed di un foglio (`formatKindOf` dice
//   `sheet`) la cui parte è una cella sola in A1 (`Budget!C7`, `'Conti
//   2025'!$B$2`, `C7` sul foglio attivo). In mezzo al testo è sempre un
//   valore; da solo nel paragrafo è la scheda di foglio (T43), a meno che
//   l'embed dica `|value` («Mostra come» → «Valore nel testo», T42), una parola
//   del formato come `|row`: un altro programma la ignora e mostra l'embed.
// - **Da dove viene**: il valore lo legge il provider del foglio, come la
//   scheda: una sessione di sola lettura sul giornale della linguetta aperta
//   (anche non salvato) o sui byte del disco, la parte trovata con `fub.part`
//   e la finestra di una cella sola (`editors/grid/cell-reader.ts`, caricato
//   con un `import()` al primo valore, mai all'apertura della nota). Si legge
//   il valore salvato: niente ricalcola e niente scrive.
// - **Segue il file**: un valore si rilegge quando il suo file cambia (un
//   evento della porta, `watch`), mai a giro. I valori di una nota che
//   nominano la stessa cella si leggono una volta; quelli dello stesso file
//   in una sessione sola.
// - **La battuta**: la decorazione è un'espressione regolare su un embed già
//   trovato, e il widget si confronta per riferimento (`eq`): una battuta non
//   rimonta i valori e non chiede niente al provider.
// - **In Lettura** il valore è testo come il resto, senza tratteggio e senza
//   clic (`hostCellSlot`, chiamato dalla resa: `mount.ts`, opzione
//   `cellValue`).
//
// Gli stati: il valore; la cella vuota («—»); un errore di formula
// (`#DIV/0!`, col colore dell'errore); il file mancante e la cella che non
// c'è (il riferimento, col colore dell'errore e il perché al passaggio); il
// valore che non si legge (un'altra finestra, un formato senza griglia).
import { WidgetType, type EditorView } from "@codemirror/view";
import { formatKindOf } from "../../../../ui/format-kind";
import type { Lifetime } from "../../../../ui/lifetime";
import { liveStrings } from "./strings";

/// La parola dopo la barra che mostra un embed di una cella, da solo nel
/// paragrafo, come valore nel testo invece che come scheda.
export const CELL_VALUE_DISPLAY = "value";

/// Una cella che la nota nomina: il file com'è scritto, la parte com'è
/// scritta (`Budget!C7`), il foglio (o `null`: quello attivo) e la cella in A1,
/// in maiuscolo e senza `$`.
export interface CellRef {
  readonly page: string;
  readonly part: string;
  readonly sheet: string | null;
  readonly cell: string;
}

/// `Budget!C7`, `'Conti 2025'!$B$2`, `C7`: una cella sola, col foglio o senza.
const CELL_PART = /^(?:(?:'((?:[^']|'')+)'|([^!'"\s][^!]*?))\s*!\s*)?\$?([A-Za-z]{1,3})\$?([1-9]\d{0,6})$/;
/// L'ultima colonna e l'ultima riga di Excel: oltre non è una cella.
const MAX_COLUMN = 16_384;
const MAX_ROW = 1_048_576;

/// Il numero di una colonna (`A` = 1).
function columnNumber(letters: string): number {
  let column = 0;
  for (const letter of letters.toUpperCase()) column = column * 26 + letter.charCodeAt(0) - 64;
  return column;
}

/// La cella che l'embed `![[page#heading]]` nomina, se è una cella sola di un
/// foglio; `null` per tutto il resto (un intervallo, un nome, un foglio
/// intero, un file che non è un foglio).
export function cellValueRef(page: string, heading: string | null): CellRef | null {
  if (heading === null || page === "" || formatKindOf(page) !== "sheet") return null;
  const part = heading.trim();
  if (part.length > 300) return null;
  const match = CELL_PART.exec(part);
  if (!match) return null;
  const letters = match[3]!.toUpperCase();
  const row = Number(match[4]);
  if (columnNumber(letters) > MAX_COLUMN || row > MAX_ROW) return null;
  const sheet = match[1] !== undefined ? match[1].replaceAll("''", "'") : match[2]?.trim() ?? null;
  return { page, part, sheet: sheet === "" ? null : sheet, cell: `${letters}${row}` };
}

/// Se il dopo-barra chiede il valore nel testo (`|value`).
export function cellShownAsValue(alias: string | null): boolean {
  return alias !== null && alias.trim().toLowerCase() === CELL_VALUE_DISPLAY;
}

const EMBED = /!\[\[([^\]\n]+)\]\]/g;

/// Un paragrafo fatto soltanto di embed (`onlyMedia` della Scrittura) che sono
/// tutti valori di cella: resta testo, coi valori in riga. Un embed solo di
/// una cella senza `|value` è la scheda di foglio, e non conta.
export function onlyCellValues(source: string): boolean {
  if (source.length > 4096) return false;
  const found = [...source.matchAll(EMBED)];
  if (found.length === 0) return false;
  return found.every(([, inner]) => {
    const bar = inner!.indexOf("|");
    const target = bar < 0 ? inner! : inner!.slice(0, bar);
    const alias = bar < 0 ? null : inner!.slice(bar + 1);
    const hash = target.indexOf("#");
    if (hash < 0 || target.includes("^")) return false;
    const ref = cellValueRef(target.slice(0, hash).trim(), target.slice(hash + 1));
    return ref !== null && (found.length > 1 || cellShownAsValue(alias));
  });
}

/// Ciò che il provider dice di una cella.
export type CellReading =
  /// Il valore col formato del foglio; `kind` dice se è un errore di formula;
  /// `stale`: il valore salvato nel file, che Fub non ha ricalcolato.
  | { readonly state: "value"; readonly text: string; readonly error: boolean; readonly stale: boolean }
  /// La cella non ha niente.
  | { readonly state: "empty" }
  /// Il file non c'è.
  | { readonly state: "missing" }
  /// Il file c'è, ma il foglio o la cella no.
  | { readonly state: "lost" }
  /// Il valore non si legge: un formato senza griglia, un errore dell'host.
  | { readonly state: "unavailable" };

/// Chi legge le celle di un file: il lettore dei fogli
/// (`editors/grid/cell-reader.ts`). Le parti sono scritte come nell'embed; la
/// risposta ha una lettura per ognuna.
export interface CellValueReader {
  read(path: string, parts: readonly string[]): Promise<ReadonlyMap<string, CellReading>>;
}

/// Ciò che la shell dà ai valori di una nota. Senza, un embed di una cella
/// resta la resa di sempre.
export interface CellValuePort {
  /// Il lettore, con un `import()` la prima volta; `null` se non c'è.
  load(): Promise<CellValueReader | null>;
  /// Il file del vault che il nome scritto nella nota `from` nomina, o `null`.
  resolve(page: string, from: string): Promise<string | null>;
  /// Avvisa quando il file `path` cambia, sparisce o cambia nome.
  watch(path: string, changed: () => void): () => void;
  /// Apre il file nella sua linguetta, alla parte (`#Budget!C7`).
  open(path: string, subpath: string | null): void;
}

/// Che cosa la nota mostra di un valore: il testo, lo stato (in
/// `data-cell-state`) e il perché al passaggio.
export interface CellValueLook {
  readonly text: string;
  readonly state: "loading" | "value" | "error" | "empty" | "missing" | "lost" | "unavailable";
  readonly title: string;
}

/// Il nome del file, senza cartelle.
function fileName(page: string): string {
  return page.split("/").pop() || page;
}

/// Il riferimento come si legge: «Budget!C7», o «C7» sul foglio attivo.
function where(ref: CellRef): string {
  return ref.sheet === null ? ref.cell : `${ref.sheet}!${ref.cell}`;
}

/// Ciò che si vede di `ref` letta come `reading` (`null`: in lettura).
export function cellValueLook(ref: CellRef, reading: CellReading | null, interactive = true): CellValueLook {
  const name = fileName(ref.page);
  const at = where(ref);
  const click = interactive ? ` ${liveStrings.t("cell_value.click")}` : "";
  if (reading === null) {
    return { text: "…", state: "loading", title: liveStrings.t("cell_value.loading", { name, cell: at }) };
  }
  switch (reading.state) {
    case "value": {
      if (reading.error) {
        return { text: reading.text, state: "error", title: liveStrings.t("cell_value.error", { name, cell: at, error: reading.text }) + click };
      }
      const from = ref.sheet === null
        ? liveStrings.t("cell_value.from_active", { name, cell: ref.cell })
        : liveStrings.t("cell_value.from", { name, sheet: ref.sheet, cell: ref.cell });
      const stale = reading.stale ? ` ${liveStrings.t("cell_value.stale")}` : "";
      return { text: reading.text, state: "value", title: `${from}${stale}${click}` };
    }
    case "empty":
      return { text: "—", state: "empty", title: liveStrings.t("cell_value.empty", { name, cell: at }) + click };
    case "missing":
      return { text: `${name} › ${at}`, state: "missing", title: liveStrings.t("cell_value.missing", { name }) };
    case "lost":
      return { text: `${name} › ${at}`, state: "lost", title: liveStrings.t("cell_value.lost", { name, cell: at }) + click };
    case "unavailable":
      return { text: `${name} › ${at}`, state: "unavailable", title: liveStrings.t("cell_value.unavailable", { name }) };
  }
}

/// Due letture dicono la stessa cosa.
function sameReading(a: CellReading | null, b: CellReading | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.state !== b.state) return false;
  if (a.state === "value" && b.state === "value") return a.text === b.text && a.error === b.error && a.stale === b.stale;
  return true;
}

/// Un valore seguito: la cella di una nota, chi la guarda, l'ultima lettura.
interface Entry {
  readonly key: string;
  readonly ref: CellRef;
  /// Il documento da cui il nome del file si risolve.
  readonly from: string;
  readonly listeners: Set<(reading: CellReading | null) => void>;
  reading: CellReading | null;
  /// Il file risolto all'ultima lettura (`null`: mancante, o non ancora letto).
  path: string | null;
  /// Cresce a ogni richiesta di lettura: una risposta vecchia non vale.
  version: number;
}

/// Ciò che chi guarda un valore tiene: la lettura di adesso e come smettere.
export interface CellValueWatch {
  current(): CellReading | null;
  stop(): void;
}

/// I valori di cella di una superficie: chi li guarda, una lettura per cella e
/// un ascolto per file. Le letture chieste nello stesso giro vanno insieme.
export class CellValues {
  readonly #port: CellValuePort;
  readonly #hostDoc: () => string;
  readonly #entries = new Map<string, Entry>();
  /// Per ogni file risolto: come smettere di ascoltarlo e i valori che lo
  /// nominano.
  readonly #paths = new Map<string, { readonly stop: () => void; readonly entries: Set<Entry> }>();
  readonly #queue = new Set<Entry>();
  #scheduled = false;
  #reader: Promise<CellValueReader | null> | null = null;
  #destroyed = false;

  constructor(options: { readonly port: CellValuePort; hostDoc(): string }) {
    this.#port = options.port;
    this.#hostDoc = options.hostDoc;
  }

  /// Guarda la cella `ref` della nota di adesso; `listener` riceve ogni
  /// lettura nuova che dice qualcosa di diverso.
  watch(ref: CellRef, listener: (reading: CellReading | null) => void): CellValueWatch {
    if (this.#destroyed) return { current: () => ({ state: "unavailable" }), stop: () => {} };
    const from = this.#hostDoc();
    const key = `${from}\u0000${ref.page}\u0000${ref.part}`;
    let entry = this.#entries.get(key);
    if (!entry) {
      entry = { key, ref, from, listeners: new Set(), reading: null, path: null, version: 0 };
      this.#entries.set(key, entry);
      this.#request(entry);
    }
    const held = entry;
    held.listeners.add(listener);
    let stopped = false;
    return {
      current: () => held.reading,
      stop: () => {
        if (stopped) return;
        stopped = true;
        held.listeners.delete(listener);
        if (held.listeners.size === 0) this.#drop(held);
      },
    };
  }

  /// Apre il foglio sulla cella: il file come lo risolve la nota di adesso.
  open(ref: CellRef): void {
    if (this.#destroyed) return;
    const subpath = `#${ref.part}`;
    void this.#port.resolve(ref.page, this.#hostDoc()).then(
      (path) => {
        if (path !== null && !this.#destroyed) this.#port.open(path, subpath);
      },
      () => {},
    );
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    for (const { stop } of this.#paths.values()) stop();
    this.#paths.clear();
    this.#entries.clear();
    this.#queue.clear();
  }

  #drop(entry: Entry): void {
    if (this.#entries.get(entry.key) !== entry) return;
    this.#entries.delete(entry.key);
    this.#queue.delete(entry);
    entry.version += 1;
    this.#unlink(entry);
  }

  /// Toglie `entry` dall'ascolto del suo file; l'ultimo spegne l'ascolto.
  #unlink(entry: Entry): void {
    const path = entry.path;
    if (path === null) return;
    entry.path = null;
    const watched = this.#paths.get(path);
    if (!watched) return;
    watched.entries.delete(entry);
    if (watched.entries.size > 0) return;
    this.#paths.delete(path);
    watched.stop();
  }

  /// Mette `entry` nella prossima lettura, che parte alla fine del giro.
  #request(entry: Entry): void {
    entry.version += 1;
    this.#queue.add(entry);
    if (this.#scheduled) return;
    this.#scheduled = true;
    queueMicrotask(() => {
      this.#scheduled = false;
      void this.#flush();
    });
  }

  /// Il file `path` è cambiato: i suoi valori si rileggono.
  #changed(path: string): void {
    const watched = this.#paths.get(path);
    if (!watched || this.#destroyed) return;
    for (const entry of watched.entries) this.#request(entry);
  }

  async #flush(): Promise<void> {
    if (this.#destroyed || this.#queue.size === 0) return;
    const batch = [...this.#queue].map((entry) => ({ entry, version: entry.version }));
    this.#queue.clear();
    const reader = await this.#loadReader();
    // Il nome di ogni file si risolve una volta per documento.
    const resolving = new Map<string, Promise<string | null>>();
    const resolved = await Promise.all(batch.map(({ entry }) => {
      const key = `${entry.from}\u0000${entry.ref.page}`;
      let path = resolving.get(key);
      if (!path) {
        path = this.#port.resolve(entry.ref.page, entry.from).catch(() => null);
        resolving.set(key, path);
      }
      return path;
    }));
    if (this.#destroyed) return;
    const byPath = new Map<string, { entry: Entry; version: number }[]>();
    batch.forEach((item, index) => {
      const path = resolved[index] ?? null;
      if (!this.#current(item.entry, item.version)) return;
      this.#link(item.entry, path);
      if (path === null) {
        this.#apply(item.entry, item.version, { state: "missing" });
        return;
      }
      if (reader === null) {
        this.#apply(item.entry, item.version, { state: "unavailable" });
        return;
      }
      const list = byPath.get(path) ?? [];
      list.push(item);
      byPath.set(path, list);
    });
    if (reader === null) return;
    await Promise.all([...byPath].map(async ([path, items]) => {
      const parts = [...new Set(items.map(({ entry }) => entry.ref.part))];
      let answers: ReadonlyMap<string, CellReading>;
      try {
        answers = await reader.read(path, parts);
      } catch (error) {
        console.warn(`note: i valori di ${path} non si leggono`, error);
        answers = new Map();
      }
      for (const { entry, version } of items) {
        this.#apply(entry, version, answers.get(entry.ref.part) ?? { state: "unavailable" });
      }
    }));
  }

  #loadReader(): Promise<CellValueReader | null> {
    // Un caricamento fallito si riprova alla lettura dopo.
    this.#reader ??= this.#port.load().catch(() => null).then((reader) => {
      if (reader === null) this.#reader = null;
      return reader;
    });
    return this.#reader;
  }

  #current(entry: Entry, version: number): boolean {
    return !this.#destroyed && this.#entries.get(entry.key) === entry && entry.version === version;
  }

  /// `entry` nomina adesso il file `path`: l'ascolto passa a lui.
  #link(entry: Entry, path: string | null): void {
    if (entry.path === path) return;
    this.#unlink(entry);
    if (path === null) return;
    entry.path = path;
    let watched = this.#paths.get(path);
    if (!watched) {
      const stop = this.#port.watch(path, () => this.#changed(path));
      watched = { stop, entries: new Set() };
      this.#paths.set(path, watched);
    }
    watched.entries.add(entry);
  }

  #apply(entry: Entry, version: number, reading: CellReading): void {
    if (!this.#current(entry, version)) return;
    if (sameReading(entry.reading, reading)) return;
    entry.reading = reading;
    for (const listener of [...entry.listeners]) {
      try {
        listener(reading);
      } catch (error) {
        console.error(error);
      }
    }
  }
}

/// Scrive in `element` ciò che si vede del valore.
function paint(element: HTMLElement, ref: CellRef, reading: CellReading | null, interactive: boolean): boolean {
  const look = cellValueLook(ref, reading, interactive);
  const changed = element.textContent !== look.text;
  if (changed) element.textContent = look.text;
  element.dataset.cellState = look.state;
  element.title = look.title;
  return changed;
}

const widgetWatches = new WeakMap<HTMLElement, CellValueWatch>();

/// Il valore di una cella in mezzo al testo della Scrittura, fuori dal
/// cursore: il valore col tratteggio d'accento. Un clic apre il foglio sulla
/// cella; col cursore accanto torna l'embed scritto.
export class CellValueWidget extends WidgetType {
  constructor(readonly ref: CellRef, readonly values: CellValues) {
    super();
  }

  eq(other: CellValueWidget): boolean {
    return other.values === this.values && other.ref.page === this.ref.page && other.ref.part === this.ref.part;
  }

  toDOM(view: EditorView): HTMLElement {
    const root = document.createElement("span");
    root.className = "cm-fub-cell-value";
    root.setAttribute("role", "link");
    root.dataset.cellPart = this.ref.part;
    let watch: CellValueWatch | null = null;
    watch = this.values.watch(this.ref, (reading) => {
      // La larghezza cambia: la riga può andare a capo diversamente.
      if (paint(root, this.ref, reading, true)) view.requestMeasure();
    });
    paint(root, this.ref, watch.current(), true);
    widgetWatches.set(root, watch);
    root.addEventListener("click", (event) => {
      if (event.button !== 0 || event.altKey || event.shiftKey) return;
      event.preventDefault();
      this.values.open(this.ref);
    });
    return root;
  }

  destroy(dom: HTMLElement): void {
    widgetWatches.get(dom)?.stop();
    widgetWatches.delete(dom);
  }

  /// Il clic è del valore (apre il foglio): CodeMirror non ci mette il
  /// cursore. La tastiera ci arriva con le frecce, e allora torna l'embed.
  ignoreEvent(event: Event): boolean {
    return event instanceof MouseEvent;
  }
}

/// Il valore di una cella nella resa (la Lettura, e i blocchi resi della
/// Scrittura come le tabelle): `slot` è l'embed reso (`.embed` coi suoi
/// `data-embed-*`). Se nomina una cella sola di un foglio diventa il valore,
/// testo come il resto, e la resa non lo idrata (`true`).
export function hostCellSlot(slot: HTMLElement, life: Lifetime, values: CellValues): boolean {
  const page = slot.dataset.embedPage ?? "";
  if (slot.dataset.embedBlock) return false;
  const ref = cellValueRef(page, slot.dataset.embedHeading ?? null);
  if (ref === null) return false;
  slot.classList.add("fub-cell-value");
  slot.dataset.cellValue = "true";
  const watch = values.watch(ref, (reading) => {
    if (!life.closed) paint(slot, ref, reading, false);
  });
  paint(slot, ref, watch.current(), false);
  life.add(() => watch.stop());
  return true;
}
