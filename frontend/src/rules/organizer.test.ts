import { describe, expect, it } from "vitest";
import type { Organization, VaultFolder } from "../host/contract";
import { folderNoteCandidates, folderNoteIn, orderedNames, sortContent } from "./organizer";

const meta = (order: Record<string, string[]> = {}): Organization => ({
  icons: {},
  pinned: [],
  order,
  spaces: [],
});

const cartella = (path: string, folders = 0, entries = 0): VaultFolder => ({
  path,
  folders,
  entries,
});

describe("l'organizzazione di un livello (§14.3, §14.4)", () => {
  it("ordina un livello per volta, e una cartella vuota resta nell'elenco", () => {
    // Una cartella senza niente dentro non ha path di note che la nominino: con
    // l'albero costruito dai path non poteva nemmeno essere passata qui.
    const content = {
      path: "Progetti",
      folders: [cartella("Progetti/Zeta", 0, 2), cartella("Progetti/Archivio")],
      notes: ["Progetti/beta.md", "Progetti/Alfa.md"],
    };
    const ordinato = sortContent(content, meta());
    expect(ordinato.folders.map((f) => f.path)).toEqual([
      "Progetti/Archivio",
      "Progetti/Zeta",
    ]);
    expect(ordinato.notes).toEqual(["Progetti/Alfa.md", "Progetti/beta.md"]);
    expect(orderedNames(ordinato)).toEqual(["Archivio", "Zeta", "Alfa.md", "beta.md"]);
  });

  it("l'ordine scelto a mano vale per i nomi che nomina, e non fa sparire gli altri", () => {
    const content = {
      path: "",
      folders: [cartella("b"), cartella("a")],
      notes: ["z.md", "k.md"],
    };
    const ordinato = sortContent(content, meta({ "": ["b", "z.md"] }));
    expect(ordinato.folders.map((f) => f.path)).toEqual(["b", "a"]);
    expect(ordinato.notes).toEqual(["z.md", "k.md"]);
  });

  it("la folder note di una cartella non aperta si sa dai path che esistono", () => {
    // È la domanda che rimpiazza «carica il contenuto per guardarci dentro»:
    // i candidati sono pochi e noti, e quali esistano lo dice il kernel.
    const candidati = folderNoteCandidates("a/Diario", ["md", "canvas"]);
    expect(candidati).toEqual([
      "a/Diario/Diario.md",
      "a/Diario/Diario.canvas",
      "a/Diario/index.md",
      "a/Diario/index.canvas",
    ]);

    const esistenti = new Set(["a/Diario/index.md", "a/Diario/Diario.canvas"]);
    expect(folderNoteIn("a/Diario", ["md", "canvas"], esistenti)).toBe("a/Diario/Diario.canvas");
    expect(folderNoteIn("a/Vuota", ["md"], esistenti)).toBeNull();
    // La radice non ha una folder note: non è una cartella con un nome.
    expect(folderNoteCandidates("", ["md"])).toEqual([]);
  });
});
