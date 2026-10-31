import { beforeEach, describe, expect, it, vi } from "vitest";

// Rinominare una pagina dal titolo (H12): un file, o la cartella di cui la
// nota è la pagina (`X/_index.md`, decisione 0229).

const world = vi.hoisted(() => ({
  pending: [] as string[],
  files: [] as [string, string][],
  folders: [] as [string, string][],
  collision: false,
  folderFails: null as string | null,
  subpages: [] as [string, string][],
  subpageFails: null as string | null,
  notices: [] as [string, string][],
}));

vi.mock("./document-session", () => ({
  flushPendingSave: async () => world.pending,
  renameKeepingBuffer: async (from: string, to: string) => {
    world.files.push([from, to]);
    return { kind: world.collision ? "collision" : "renamed", from, to };
  },
}));
vi.mock("../ui/notify", () => ({
  notify: (message: string, tone: string) => void world.notices.push([message, tone]),
}));
vi.mock("./vault", () => ({
  createSubpage: async (doc: string, name: string) => {
    if (world.subpageFails) throw new Error(world.subpageFails);
    world.subpages.push([doc, name]);
    return { notify: "Creata", undo: { label: "x", steps: [] } };
  },
  undoLastOperation: async () => {},
  renameFolder: async (from: string, to: string) => {
    if (world.folderFails) throw new Error(world.folderFails);
    world.folders.push([from, to]);
  },
}));
vi.mock("../i18n/strings", () => ({
  t: (key: string, args?: Record<string, string>) => (args ? `${key} ${Object.values(args).join(" | ")}` : key),
}));

import { newSubpage, pageRenameTarget, renamePage, renamedPath } from "./page-rename";

beforeEach(() => {
  world.pending = [];
  world.files = [];
  world.folders = [];
  world.collision = false;
  world.folderFails = null;
  world.subpages = [];
  world.subpageFails = null;
  world.notices = [];
});

describe("che cosa cambia nome", () => {
  it("un file resta nella sua cartella e con la sua estensione", () => {
    expect(renamedPath("Viaggi/Roma.md", "Napoli")).toBe("Viaggi/Napoli.md");
    expect(pageRenameTarget("Roma.md", "Napoli")).toEqual({ kind: "file", from: "Roma.md", to: "Napoli.md" });
  });

  it("la pagina di una cartella rinomina la cartella", () => {
    expect(pageRenameTarget("Viaggi/Roma/_index.md", "Napoli")).toEqual({ kind: "folder", from: "Viaggi/Roma", to: "Viaggi/Napoli" });
    expect(pageRenameTarget("Roma/_index.md", "Napoli")).toEqual({ kind: "folder", from: "Roma", to: "Napoli" });
  });

  it("un `_index` alla radice è una nota come le altre", () => {
    expect(pageRenameTarget("_index.md", "Casa")).toEqual({ kind: "file", from: "_index.md", to: "Casa.md" });
  });
});

describe("la rinomina dal titolo", () => {
  it("rinomina il file dalla sessione, che si porta dietro il testo", async () => {
    expect(await renamePage("Roma.md", " Napoli ")).toBeNull();
    expect(world.files).toEqual([["Roma.md", "Napoli.md"]]);
  });

  it("rinomina la cartella, non il file `_index`", async () => {
    expect(await renamePage("Roma/_index.md", "Napoli")).toBeNull();
    expect(world.folders).toEqual([["Roma", "Napoli"]]);
    expect(world.files).toEqual([]);
  });

  it("lo stesso nome, o nessuno, non fa niente", async () => {
    expect(await renamePage("Roma.md", "Roma")).toBeNull();
    expect(await renamePage("Roma/_index.md", "Roma")).toBeNull();
    expect(await renamePage("Roma.md", "  ")).toBeNull();
    expect(world.files).toEqual([]);
    expect(world.folders).toEqual([]);
  });

  it("un nome che non si può usare si rifiuta prima di ogni giro", async () => {
    const problem = await renamePage("Roma.md", "a/../b");
    expect(problem).toContain("explorer.bad_name");
    expect(world.files).toEqual([]);
  });

  it("il testo non salvato ferma la rinomina e lo dice", async () => {
    world.pending = ["Altra.md"];
    expect(await renamePage("Roma.md", "Napoli")).toContain("document.unsaved_blocks");
    expect(world.files).toEqual([]);
  });

  it("un file che esiste già non si sovrascrive", async () => {
    world.collision = true;
    expect(await renamePage("Roma.md", "Napoli")).toContain("explorer.destination_open");
  });

  it("una cartella che esiste già lascia la frase del kernel", async () => {
    world.folderFails = "esiste già";
    expect(await renamePage("Roma/_index.md", "Napoli")).toContain("explorer.folder_move_failed");
  });
});

describe("la sottopagina dalla testata", () => {
  it("mette in salvo, chiede al vault e dice com'è andata", async () => {
    expect(await newSubpage("Viaggio.md", " Tappe ")).toBeNull();
    expect(world.subpages).toEqual([["Viaggio.md", "Tappe"]]);
    expect(world.notices).toEqual([["Creata", "info"]]);
  });

  it("un nome con una cartella, o vuoto, si rifiuta prima di ogni giro", async () => {
    expect(await newSubpage("Viaggio.md", "a/b")).toContain("explorer.bad_name");
    expect(await newSubpage("Viaggio.md", "")).toContain("explorer.bad_name");
    expect(world.subpages).toEqual([]);
  });

  it("il testo non salvato, o il vault che dice no, fermano e lo dicono", async () => {
    world.pending = ["Altra.md"];
    expect(await newSubpage("Viaggio.md", "Tappe")).toContain("document.unsaved_blocks");
    world.pending = [];
    world.subpageFails = "esiste già";
    expect(await newSubpage("Viaggio.md", "Tappe")).toContain("esiste già");
    expect(world.notices).toEqual([]);
  });
});
