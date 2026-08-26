import { describe, expect, it } from "vitest";
import type { Organization, VaultFolder } from "../host/contract";
import { folderNoteCandidates, folderNoteIn, orderedNames, sortContent } from "./organizer";

const meta = (order: Record<string, string[]> = {}): Organization => ({
  icons: {},
  pinned: [],
  order,
  spaces: [],
});

const folder = (path: string, folders = 0, entries = 0): VaultFolder => ({
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
      folders: [folder("Progetti/Zeta", 0, 2), folder("Progetti/Archivio")],
      notes: ["Progetti/beta.md", "Progetti/Alfa.md"],
      otherFolders: 0,
      otherNote: 0,
    };
    const ordered = sortContent(content, meta());
    expect(ordered.folders.map((f) => f.path)).toEqual([
      "Progetti/Archivio",
      "Progetti/Zeta",
    ]);
    expect(ordered.notes).toEqual(["Progetti/Alfa.md", "Progetti/beta.md"]);
    expect(orderedNames(ordered)).toEqual(["Archivio", "Zeta", "Alfa.md", "beta.md"]);
  });

  it("l'ordine scelto a mano vale per i nomi che nomina, e non fa sparire gli altri", () => {
    const content = {
      path: "",
      folders: [folder("b"), folder("a")],
      notes: ["z.md", "k.md"],
      otherFolders: 0,
      otherNote: 0,
    };
    const ordered = sortContent(content, meta({ "": ["b", "z.md"] }));
    expect(ordered.folders.map((f) => f.path)).toEqual(["b", "a"]);
    expect(ordered.notes).toEqual(["z.md", "k.md"]);
  });

  it("la folder note di una cartella non aperta si sa dai path che esistono", () => {
    // È la domanda che rimpiazza «carica il contenuto per guardarci dentro»:
    // i candidati sono pochi e noti, e quali esistano lo dice il kernel.
    const candidates = folderNoteCandidates("a/Diario", ["md", "canvas"]);
    expect(candidates).toEqual([
      "a/Diario/Diario.md",
      "a/Diario/Diario.canvas",
      "a/Diario/index.md",
      "a/Diario/index.canvas",
    ]);

    const existing = new Set(["a/Diario/index.md", "a/Diario/Diario.canvas"]);
    expect(folderNoteIn("a/Diario", ["md", "canvas"], existing)).toBe("a/Diario/Diario.canvas");
    expect(folderNoteIn("a/Vuota", ["md"], existing)).toBeNull();
    // La radice non ha una folder note: non è una cartella con un nome.
    expect(folderNoteCandidates("", ["md"])).toEqual([]);
  });
});
