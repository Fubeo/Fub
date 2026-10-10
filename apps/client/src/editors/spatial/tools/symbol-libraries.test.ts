// Le librerie di simboli del vault: la cartella che l'impostazione dice, i
// file che sono librerie, la lettura che si fa quando serve e una volta sola
// per versione, e i perché dei file che non si mostrano.

import { describe, expect, it, vi } from "vitest";
import { doc } from "../scene/test-support";
import { LIBRARY_MAX_BYTES } from "./symbol-library";
import { libraryFiles, stem, SymbolLibraries, symbolsFolder, SYMBOLS_FOLDER, SYMBOLS_SETTING, type LibraryChange, type LibraryFile, type SymbolLibraryPort } from "./symbol-libraries";
import { LAYER } from "./test-support";

const PUNTO = doc('<defs id="fub-defs"><symbol id="rpunto000" overflow="visible"><title>Punto</title><circle id="oppppppp1" r="5"/></symbol></defs>' + `${LAYER}</g>`);

/// Un vault finto: i file coi loro testi, l'impostazione, chi ascolta e le
/// letture fatte.
class Vault implements SymbolLibraryPort {
  readonly here?: string;
  folder: unknown = undefined;
  readonly texts = new Map<string, string>();
  readonly files_ = new Map<string, LibraryFile>();
  readonly reads: string[] = [];
  readonly unreadable = new Set<string>();
  listener: ((change: LibraryChange) => void) | null = null;
  private clock = 1;

  constructor(here?: string) {
    if (here !== undefined) this.here = here;
  }

  put(path: string, text: string, size = text.length): void {
    this.texts.set(path, text);
    this.files_.set(path, { path, size, mtime: this.clock++ });
  }

  setting(key: string): Promise<unknown> {
    return Promise.resolve(key === SYMBOLS_SETTING ? this.folder : undefined);
  }

  files(folder: string): Promise<readonly LibraryFile[]> {
    const prefix = folder === "" ? "" : `${folder}/`;
    if (folder !== "" && ![...this.files_.keys()].some((path) => path.startsWith(prefix))) return Promise.reject(new Error("no folder"));
    return Promise.resolve([...this.files_.values()].filter((file) => file.path.startsWith(prefix) && !file.path.slice(prefix.length).includes("/")));
  }

  read(path: string): Promise<string> {
    this.reads.push(path);
    if (this.unreadable.has(path)) return Promise.reject(new Error("unreadable"));
    return Promise.resolve(this.texts.get(path)!);
  }

  watch(changed: (change: LibraryChange) => void): () => void {
    this.listener = changed;
    return () => {
      this.listener = null;
    };
  }
}

async function settled(libraries: SymbolLibraries): Promise<void> {
  await vi.waitFor(() => expect(libraries.busy).toBe(false));
}

describe("la cartella e i file", () => {
  it("la cartella è quella dell'impostazione, senza / ai bordi; senza, Symbols", () => {
    expect(symbolsFolder(undefined)).toBe(SYMBOLS_FOLDER);
    expect(symbolsFolder(3)).toBe(SYMBOLS_FOLDER);
    expect(symbolsFolder(" /Disegni/Simboli/ ")).toBe("Disegni/Simboli");
    expect(symbolsFolder("")).toBe("");
  });

  it("sono librerie i disegni che stanno direttamente nella cartella, tranne quello aperto, per nome", () => {
    const file = (path: string): LibraryFile => ({ path, size: 1, mtime: 1 });
    const files = ["S/Libreria 10.svg", "S/Libreria 2.svg", "S/sotto/Altro.svg", "S/nota.md", "S/Aperto.svg", "Altrove.svg", "S/Archi.SVG"].map(file);
    expect(libraryFiles(files, "S", "S/Aperto.svg").map((each) => each.path)).toEqual(["S/Archi.SVG", "S/Libreria 2.svg", "S/Libreria 10.svg"]);
    expect(libraryFiles(files, "").map((each) => each.path)).toEqual(["Altrove.svg"]);
    expect(stem("S/Archi.SVG")).toBe("Archi");
  });
});

describe("leggere le librerie", () => {
  it("non legge niente prima che il pannello lo chieda, poi ogni file una volta, col suo perché", async () => {
    const vault = new Vault("Symbols/Questo.svg");
    vault.put("Symbols/Impianti.svg", PUNTO);
    vault.put("Symbols/Enorme.svg", PUNTO, LIBRARY_MAX_BYTES + 1);
    vault.put("Symbols/Pagina.svg", "<html><body/></html>");
    vault.put("Symbols/Rotto.svg", PUNTO);
    vault.put("Symbols/Questo.svg", PUNTO);
    vault.unreadable.add("Symbols/Rotto.svg");
    const changed = vi.fn();
    const libraries = new SymbolLibraries(vault, changed);
    await Promise.resolve();
    expect(vault.listener).toBeNull();
    expect(libraries.entries).toEqual([]);
    expect(libraries.listed).toBe(false);

    libraries.start();
    await settled(libraries);
    expect(libraries.listed).toBe(true);
    expect(libraries.folder).toBe("Symbols");
    const states = Object.fromEntries(libraries.entries.map((entry) => [entry.name, entry.state.kind === "trouble" ? entry.state.trouble : entry.state.kind]));
    expect(states).toEqual({ Enorme: "too-large", Impianti: "read", Pagina: "not-drawing", Rotto: "unreadable" });
    expect(libraries.library("Symbols/Impianti.svg")!.symbols.map((symbol) => symbol.name)).toEqual(["Punto"]);
    // Il file troppo grande non si legge; quello aperto nemmeno.
    expect(vault.reads.sort()).toEqual(["Symbols/Impianti.svg", "Symbols/Pagina.svg", "Symbols/Rotto.svg"]);
    expect(changed).toHaveBeenCalled();
    libraries.dispose();
    expect(vault.listener).toBeNull();
  });

  it("un file che non è cambiato non si rilegge; uno cambiato sì; uno tolto se ne va", async () => {
    const vault = new Vault();
    vault.put("Symbols/A.svg", PUNTO);
    vault.put("Symbols/B.svg", PUNTO);
    const libraries = new SymbolLibraries(vault, () => undefined);
    libraries.start();
    await settled(libraries);
    expect(vault.reads.sort()).toEqual(["Symbols/A.svg", "Symbols/B.svg"]);

    vault.reads.length = 0;
    vault.put("Symbols/B.svg", PUNTO.replace("Punto", "Punto pieno"));
    vault.files_.delete("Symbols/A.svg");
    vault.listener!({ path: "Symbols/B.svg" });
    await settled(libraries);
    expect(vault.reads).toEqual(["Symbols/B.svg"]);
    expect(libraries.entries.map((entry) => entry.name)).toEqual(["B"]);
    expect(libraries.library("Symbols/B.svg")!.symbols[0]!.name).toBe("Punto pieno");
    expect(libraries.library("Symbols/A.svg")).toBeNull();
    libraries.dispose();
  });

  it("un cambiamento fuori dalla cartella non rilegge niente; l'impostazione cambia la cartella", async () => {
    const vault = new Vault();
    vault.put("Symbols/A.svg", PUNTO);
    vault.put("Altre/C.svg", PUNTO);
    const files = vi.spyOn(vault, "files");
    const libraries = new SymbolLibraries(vault, () => undefined);
    libraries.start();
    await settled(libraries);
    expect(files).toHaveBeenCalledTimes(1);

    vault.listener!({ path: "Note/una.md" });
    vault.listener!({ path: "Symbols/sotto/D.svg" });
    vault.listener!({ setting: "draw.level" });
    await settled(libraries);
    expect(files).toHaveBeenCalledTimes(1);

    vault.folder = "/Altre/";
    vault.listener!({ setting: SYMBOLS_SETTING });
    await settled(libraries);
    expect(libraries.folder).toBe("Altre");
    expect(libraries.entries.map((entry) => entry.path)).toEqual(["Altre/C.svg"]);
    libraries.dispose();
  });

  it("una cartella che non c'è non ha librerie, e lo si sa", async () => {
    const vault = new Vault();
    vault.folder = "Mancante";
    const libraries = new SymbolLibraries(vault, () => undefined);
    libraries.start();
    await settled(libraries);
    expect(libraries.listed).toBe(false);
    expect(libraries.folder).toBe("Mancante");
    expect(libraries.entries).toEqual([]);
    libraries.dispose();
  });

  it("le richieste che arrivano mentre si legge si fanno dopo, una volta", async () => {
    const vault = new Vault();
    vault.put("Symbols/A.svg", PUNTO);
    const files = vi.spyOn(vault, "files");
    const libraries = new SymbolLibraries(vault, () => undefined);
    libraries.start();
    for (let i = 0; i < 5; i++) vault.listener!(null);
    await settled(libraries);
    expect(files).toHaveBeenCalledTimes(2);
    libraries.dispose();
  });
});
