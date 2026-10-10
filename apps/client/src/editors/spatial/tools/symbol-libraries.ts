// Le librerie di simboli del vault, dalla parte del disegno: i disegni che
// stanno direttamente nella cartella che l'impostazione `draw.symbols` dice,
// letti uno per uno e tenuti finché il file non cambia.
//
// - **La shell** elenca i file, li legge e dice quando cambiano
//   ([`SymbolLibraryPort`]); il disegno non sa niente del vault.
// - **Il disegno aperto** non è una libreria per sé stesso, anche se sta
//   nella cartella: i suoi simboli il pannello li mostra già.
// - **Si legge soltanto quando serve:** la prima volta che il pannello lo
//   chiede, poi a ogni cambiamento della cartella, di un suo file o
//   dell'impostazione. Un file che non è cambiato, con la stessa dimensione
//   e la stessa data, non si rilegge.
// - **Nessun limite muto:** un file troppo grande, che non è un disegno o che
//   non si legge resta nell'elenco col suo perché.

import { LIBRARY_MAX_BYTES, readLibrary, type Library, type LibraryProblem } from "./symbol-library";

/// L'impostazione che dice la cartella delle librerie, e il suo valore
/// quando nessuno ha scelto.
export const SYMBOLS_SETTING = "draw.symbols";
export const SYMBOLS_FOLDER = "Symbols";

/// Un file del vault che può essere una libreria: il percorso dalla radice,
/// i byte e l'ultima modifica.
export interface LibraryFile {
  readonly path: string;
  readonly size: number;
  readonly mtime: number;
}

/// Che cosa è cambiato: un file, un'impostazione, o tutto (`null`).
export type LibraryChange = { readonly path: string } | { readonly setting: string } | null;

/// Le librerie dalla parte della shell.
export interface SymbolLibraryPort {
  /// Il disegno che chiede, che per sé stesso non è una libreria.
  readonly here?: string;
  /// Il valore dell'impostazione `key` dei disegni; `undefined` se non c'è.
  setting(key: string): Promise<unknown>;
  /// I file che stanno direttamente nella cartella `folder` del vault (`""`
  /// la radice); lancia se la cartella non si legge.
  files(folder: string): Promise<readonly LibraryFile[]>;
  /// Il testo del disegno `path`; lancia se non si legge.
  read(path: string): Promise<string>;
  /// Chiama `changed` a ogni cambiamento, finché non si ferma.
  watch(changed: (change: LibraryChange) => void): () => void;
}

/// Perché una libreria non si mostra: quelli di [`readLibrary`], o il file
/// non si è letto.
export type LibraryTrouble = LibraryProblem | "unreadable";

/// Lo stato di una libreria.
export type LibraryState =
  | { readonly kind: "reading" }
  | { readonly kind: "read"; readonly library: Library }
  | { readonly kind: "trouble"; readonly trouble: LibraryTrouble };

/// Una libreria nell'elenco: il file, il nome, e ciò che se n'è letto.
export interface LibraryEntry {
  readonly path: string;
  /// Il nome del file senza `.svg`.
  readonly name: string;
  readonly state: LibraryState;
}

/// La cartella che l'impostazione `value` dice, senza `/` ai bordi; `""` è
/// la radice del vault.
export function symbolsFolder(value: unknown): string {
  if (typeof value !== "string") return SYMBOLS_FOLDER;
  return value.trim().replace(/^\/+|\/+$/g, "");
}

/// I file di `files` che sono librerie in `folder`: gli `.svg` che stanno
/// direttamente lì, tranne `here`, per nome.
export function libraryFiles(files: readonly LibraryFile[], folder: string, here?: string): LibraryFile[] {
  const prefix = folder === "" ? "" : `${folder}/`;
  return files
    .filter((file) => /\.svg$/i.test(file.path) && file.path.startsWith(prefix) && !file.path.slice(prefix.length).includes("/") && file.path !== here)
    .sort((a, b) => stem(a.path).localeCompare(stem(b.path), undefined, { numeric: true }) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/// Il nome del file `path`, senza cartella e senza `.svg`.
export function stem(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1).replace(/\.svg$/i, "");
}

/// Ciò che si è letto di un file, con la dimensione e la data di allora.
interface Known {
  readonly size: number;
  readonly mtime: number;
  readonly state: LibraryState;
}

const READING: LibraryState = { kind: "reading" };

/// Le librerie di un disegno aperto.
export class SymbolLibraries {
  readonly #port: SymbolLibraryPort;
  readonly #changed: () => void;
  readonly #known = new Map<string, Known>();
  #entries: readonly LibraryEntry[] = [];
  #folder = SYMBOLS_FOLDER;
  /// Se la cartella si è letta l'ultima volta.
  #listed = false;
  #started = false;
  #stop: (() => void) | null = null;
  #running = false;
  #again = false;
  #disposed = false;

  /// `changed` si chiama a ogni cambiamento dell'elenco o di una libreria.
  constructor(port: SymbolLibraryPort, changed: () => void) {
    this.#port = port;
    this.#changed = changed;
  }

  /// La cartella delle librerie, com'era all'ultima lettura.
  get folder(): string {
    return this.#folder;
  }

  /// Se la cartella si è letta: `false` prima della prima lettura e quando
  /// la cartella non c'è.
  get listed(): boolean {
    return this.#listed;
  }

  /// Le librerie, per nome.
  get entries(): readonly LibraryEntry[] {
    return this.#entries;
  }

  /// Se qualcosa si sta ancora leggendo.
  get busy(): boolean {
    return this.#running || this.#entries.some((entry) => entry.state.kind === "reading");
  }

  /// La libreria `path`, se si è letta.
  library(path: string): Library | null {
    const state = this.#known.get(path)?.state;
    return state?.kind === "read" ? state.library : null;
  }

  /// Comincia a leggere, la prima volta, e a seguire i cambiamenti.
  start(): void {
    if (this.#started || this.#disposed) return;
    this.#started = true;
    this.#stop = this.#port.watch((change) => {
      if (change === null || ("path" in change ? this.#concerns(change.path) : change.setting === SYMBOLS_SETTING)) this.refresh();
    });
    this.refresh();
  }

  /// Rilegge la cartella, e i file che sono cambiati. Una richiesta che
  /// arriva mentre si legge si fa dopo, una volta sola.
  refresh(): void {
    if (!this.#started || this.#disposed) return;
    if (this.#running) {
      this.#again = true;
      return;
    }
    this.#running = true;
    void this.#run().finally(() => {
      this.#running = false;
      if (this.#again && !this.#disposed) {
        this.#again = false;
        this.refresh();
      } else if (!this.#disposed) this.#changed();
    });
  }

  dispose(): void {
    this.#disposed = true;
    this.#stop?.();
    this.#stop = null;
  }

  /// Se un cambiamento di `path` tocca le librerie: un file della cartella,
  /// o uno che si conosce.
  #concerns(path: string): boolean {
    if (this.#known.has(path)) return true;
    if (path === this.#port.here) return false;
    const prefix = this.#folder === "" ? "" : `${this.#folder}/`;
    return path.startsWith(prefix) && !path.slice(prefix.length).includes("/");
  }

  async #run(): Promise<void> {
    const folder = symbolsFolder(await this.#port.setting(SYMBOLS_SETTING).catch(() => undefined));
    let files: LibraryFile[];
    try {
      files = libraryFiles(await this.#port.files(folder), folder, this.#port.here);
      this.#listed = true;
    } catch {
      files = [];
      this.#listed = false;
    }
    if (this.#disposed) return;
    this.#folder = folder;
    const kept = new Set(files.map((file) => file.path));
    for (const path of [...this.#known.keys()]) if (!kept.has(path)) this.#known.delete(path);
    const stale = files.filter((file) => {
      const known = this.#known.get(file.path);
      return known === undefined || known.size !== file.size || known.mtime !== file.mtime || known.state.kind === "reading";
    });
    for (const file of stale) this.#known.set(file.path, { size: file.size, mtime: file.mtime, state: READING });
    this.#publish(files);
    for (const file of stale) {
      if (this.#disposed || this.#again) return;
      const state = await this.#read(file);
      if (this.#disposed) return;
      this.#known.set(file.path, { size: file.size, mtime: file.mtime, state });
      this.#publish(files);
    }
  }

  async #read(file: LibraryFile): Promise<LibraryState> {
    if (file.size > LIBRARY_MAX_BYTES) return { kind: "trouble", trouble: "too-large" };
    let text: string;
    try {
      text = await this.#port.read(file.path);
    } catch {
      return { kind: "trouble", trouble: "unreadable" };
    }
    const read = readLibrary(file.path, text);
    return typeof read === "string" ? { kind: "trouble", trouble: read } : { kind: "read", library: read };
  }

  #publish(files: readonly LibraryFile[]): void {
    this.#entries = files.map((file) => ({ path: file.path, name: stem(file.path), state: this.#known.get(file.path)?.state ?? READING }));
    this.#changed();
  }
}
