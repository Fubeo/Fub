import { describe, expect, it } from "vitest";
import type { FolderContent } from "../rules/organizer";
import { changedOnlyInside, signatureOf, type View } from "./explorer-view";

function content(path: string, parts: Partial<FolderContent> = {}): FolderContent {
  return { path, folders: [], notes: [], files: [], otherFolders: 0, otherNote: 0, ...parts };
}

/// La radice con `docs` (due note e una sottocartella) e `zeta`; con `open`,
/// anche il contenuto di `docs`.
function view(open: boolean, existing: string[] = []): View {
  const folders = new Map<string, FolderContent>([
    [
      "",
      content("", {
        folders: [
          { path: "docs", folders: 1, entries: 2 },
          { path: "zeta", folders: 0, entries: 1 },
        ],
        notes: ["Benvenuto.md"],
      }),
    ],
  ]);
  if (open) {
    folders.set("docs", content("docs", { folders: [{ path: "docs/sotto", folders: 0, entries: 1 }], notes: ["docs/a.md", "docs/b.md"] }));
  }
  return { folders, existing: new Set(existing) };
}

const outside = { folder: "docs", pinned: [] as string[] };

describe("l'impronta dell'albero", () => {
  it("aprire o chiudere una cartella cambia soltanto il suo contenuto", () => {
    expect(changedOnlyInside(view(false), view(true), "name-asc", outside)).toBe(true);
    expect(changedOnlyInside(view(true), view(false), "name-asc", outside)).toBe(true);
    // L'impronta intera invece cambia: il ridisegno serve.
    expect(signatureOf(view(false), "name-asc")).not.toBe(signatureOf(view(true), "name-asc"));
  });

  it("le folder note delle sottocartelle sono contenuto della cartella; la sua no", () => {
    // `docs/sotto/sotto.md` la chiede solo `docs` aperta.
    expect(changedOnlyInside(view(false), view(true, ["docs/sotto/sotto.md"]), "name-asc", outside)).toBe(true);
    // `docs/docs.md` è la pagina della cartella stessa: la sua riga cambia.
    expect(changedOnlyInside(view(false), view(true, ["docs/docs.md"]), "name-asc", outside)).toBe(false);
  });

  it("un'appuntata sotto la cartella conta: si vede fra le appuntate", () => {
    const pinned = { folder: "docs", pinned: ["docs/sotto/Fissata.md"] };
    expect(changedOnlyInside(view(false, ["docs/sotto/Fissata.md"]), view(true), "name-asc", pinned)).toBe(false);
  });

  it("un cambiamento fuori, anche nel conto della cartella, chiede il ridisegno intero", () => {
    const grown = view(true);
    grown.folders.get("")!.notes.push("Nuova.md");
    expect(changedOnlyInside(view(false), grown, "name-asc", outside)).toBe(false);

    const counted = view(true);
    counted.folders.get("")!.folders[0] = { path: "docs", folders: 1, entries: 3 };
    expect(changedOnlyInside(view(false), counted, "name-asc", outside)).toBe(false);

    const truncated = view(true);
    truncated.folders.get("")!.otherNote = 4;
    expect(changedOnlyInside(view(false), truncated, "name-asc", outside)).toBe(false);
  });

  it("una cartella dal nome che comincia come lei non è dentro di lei", () => {
    const near = { folder: "doc", pinned: [] as string[] };
    expect(changedOnlyInside(view(false), view(true), "name-asc", near)).toBe(false);
  });
});
