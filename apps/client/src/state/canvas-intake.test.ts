// Le porte della lavagna per portare dentro (T10 di N6): dall'albero arrivano
// solo gli id che il vault conferma, dal computer lo stesso file non si copia
// due volte, e le notifiche dicono cosa è successo. Porte finte, nessun host.
import { describe, expect, it, vi } from "vitest";
import { ENTRIES_DRAG_TYPE, NOTE_DRAG_TYPE } from "../ui/drag-types";
import type { AttachmentDeposit } from "../editors/media/attachment-target";
import type { ResourcePort } from "../editors/media/resource-port";
import type { NoticeAction } from "../ui/notify";
import { ATTACHMENTS_NOTICED_KEY, depositCanvasFiles, resolveCanvasPaths, type CanvasDepositDeps, type CanvasPathDeps } from "./canvas-intake";

function transfer(values: Record<string, string>): DataTransfer {
  return { getData: (type: string) => values[type] ?? "" } as unknown as DataTransfer;
}

function entries(...list: [string, boolean][]): string {
  return JSON.stringify(list.map(([id, note]) => ({ id, note })));
}

/// Un vault finto: i documenti che l'indice conosce, e tutte le voci.
function pathDeps(documents: string[], files: string[]) {
  const all = new Set([...documents, ...files]);
  const deps = {
    existingDocuments: vi.fn(async (ids: string[]) => new Set(ids.filter((id) => documents.includes(id)))),
    folderEntries: vi.fn(async (folder: string) => new Set([...all].filter((id) => (id.includes("/") ? id.slice(0, id.lastIndexOf("/")) : "") === folder))),
  } satisfies CanvasPathDeps;
  return deps;
}

describe("resolveCanvasPaths (dall'albero)", () => {
  it("tiene solo gli id che il vault conferma, note e file insieme, nell'ordine del trascinamento", async () => {
    const deps = pathDeps(["Note/a.md", "Fogli/voti.xlsx"], ["Foto/x.png"]);
    const data = transfer({
      [ENTRIES_DRAG_TYPE]: entries(["Foto/x.png", false], ["Note/a.md", true], ["Note/cancellata.md", true], ["Fogli/voti.xlsx", false], ["Foto/sparita.png", false]),
      "text/plain": "Foto/x.png\nNote/a.md",
    });
    expect(await resolveCanvasPaths(data, deps)).toEqual(["Foto/x.png", "Note/a.md", "Fogli/voti.xlsx"]);
    // I file che l'indice dei documenti non conosce si chiedono alla loro
    // cartella; una nota non confermata no: non c'è più.
    expect(deps.folderEntries.mock.calls.map(([folder]) => folder)).toEqual(["Foto"]);
  });

  it("500 voci: una domanda sola per i documenti, una per cartella per gli altri file", async () => {
    const notes = Array.from({ length: 300 }, (_, i) => `Note/n${i}.md`);
    const images = Array.from({ length: 200 }, (_, i) => `Foto/f${i}.png`);
    const deps = pathDeps(notes, images);
    const data = transfer({ [ENTRIES_DRAG_TYPE]: JSON.stringify([...notes.map((id) => ({ id, note: true })), ...images.map((id) => ({ id, note: false }))]) });
    const found = await resolveCanvasPaths(data, deps);
    expect(found).toHaveLength(500);
    expect(deps.existingDocuments).toHaveBeenCalledTimes(1);
    expect(deps.existingDocuments.mock.calls[0]![0]).toHaveLength(500);
    expect(deps.folderEntries).toHaveBeenCalledTimes(1);
  });

  it("senza le voci, una nota sola; mai il text/plain", async () => {
    const deps = pathDeps(["a.md"], []);
    expect(await resolveCanvasPaths(transfer({ [NOTE_DRAG_TYPE]: "a.md" }), deps)).toEqual(["a.md"]);
    expect(await resolveCanvasPaths(transfer({ "text/plain": "a.md" }), deps)).toEqual([]);
    expect(await resolveCanvasPaths(transfer({ [ENTRIES_DRAG_TYPE]: "non è json", "text/plain": "a.md" }), deps)).toEqual([]);
  });

  it("un file nella radice si chiede alla radice; un host che non risponde scarta", async () => {
    const deps = pathDeps([], ["foto.png"]);
    expect(await resolveCanvasPaths(transfer({ [ENTRIES_DRAG_TYPE]: entries(["foto.png", false]) }), deps)).toEqual(["foto.png"]);
    expect(deps.folderEntries).toHaveBeenCalledWith("");
    const broken: CanvasPathDeps = {
      existingDocuments: async () => { throw new Error("giù"); },
      folderEntries: async () => { throw new Error("giù"); },
    };
    expect(await resolveCanvasPaths(transfer({ [ENTRIES_DRAG_TYPE]: entries(["a.md", true], ["foto.png", false]) }), broken)).toEqual([]);
  });
});

/// Un vault finto per i depositi: le scritture atomiche, le letture con la
/// porta dei byte, lo stato di vista e le notifiche.
function depositVault(options: { noticed?: unknown; readFails?: boolean } = {}) {
  const files = new Map<string, Uint8Array>();
  const state = new Map<string, unknown>();
  if (options.noticed !== undefined) state.set(ATTACHMENTS_NOTICED_KEY, options.noticed);
  const notices: { message: string; action?: NoticeAction }[] = [];
  const reads: string[] = [];
  const closes: string[] = [];
  const changeFolder = vi.fn();
  const deposit: AttachmentDeposit = {
    folder: "attachments",
    fromDocument: "Lavagne/studio.canvas",
    write: async (id, bytes) => {
      if (files.has(id)) throw Object.assign(new Error("exists"), { kind: "already_exists" });
      files.set(id, bytes);
      return { id, revision: "1" };
    },
  };
  const deps: CanvasDepositDeps = {
    deposit: async () => deposit,
    open: async (id): Promise<ResourcePort> => {
      const bytes = files.get(id);
      if (!bytes) throw new Error(`manca ${id}`);
      return {
        descriptor: { handle: id, id, len: bytes.byteLength, mime: "application/octet-stream", kind: "other", revision: "7" },
        readAll: async () => { reads.push(id); return bytes; },
        close: async () => { closes.push(id); },
      };
    },
    notify: (message, _tone, action) => notices.push({ message, ...(action ? { action } : {}) }),
    readState: async (key) => {
      if (options.readFails) throw new Error("stato illeggibile");
      return state.get(key) ?? null;
    },
    writeState: (key, value) => { state.set(key, value); },
    changeFolder,
  };
  return { files, state, notices, reads, closes, changeFolder, deps };
}

function file(name: string, ...bytes: number[]): File {
  return new File([new Uint8Array(bytes)], name);
}

describe("depositCanvasFiles (dal computer)", () => {
  it("la prima volta copia e dice dove, con «Cambia cartella»; la seconda no", async () => {
    const vault = depositVault();
    expect(await depositCanvasFiles([file("foto.png", 1, 2)], "Lavagne/studio.canvas", vault.deps)).toEqual(["attachments/foto.png"]);
    expect(vault.notices).toHaveLength(1);
    expect(vault.notices[0]!.message).toBe("Copiati in attachments/");
    expect(vault.notices[0]!.action?.label).toBe("Cambia cartella");
    await vault.notices[0]!.action!.run();
    expect(vault.changeFolder).toHaveBeenCalledTimes(1);
    expect(vault.state.get(ATTACHMENTS_NOTICED_KEY)).toBe(true);

    vault.notices.length = 0;
    await depositCanvasFiles([file("altra.png", 3)], "Lavagne/studio.canvas", vault.deps);
    expect(vault.notices).toEqual([]);
    expect(vault.files.has("attachments/altra.png")).toBe(true);
  });

  it("lo stesso file trascinato due volte si riusa, con una notifica sola col numero", async () => {
    const vault = depositVault({ noticed: true });
    await depositCanvasFiles([file("a.png", 1, 2), file("b.png", 3)], "Lavagne/studio.canvas", vault.deps);
    expect(vault.notices).toEqual([]);
    const again = await depositCanvasFiles([file("a.png", 1, 2), file("b.png", 3), file("c.png", 4)], "Lavagne/studio.canvas", vault.deps);
    expect(again).toEqual(["attachments/a.png", "attachments/b.png", "attachments/c.png"]);
    expect([...vault.files.keys()].sort()).toEqual(["attachments/a.png", "attachments/b.png", "attachments/c.png"]);
    expect(vault.notices.map((notice) => notice.message)).toEqual(["2 file già nel vault, uso quelli"]);
    expect(vault.closes.sort()).toEqual(["attachments/a.png", "attachments/b.png"]);

    vault.notices.length = 0;
    await depositCanvasFiles([file("c.png", 4)], "Lavagne/studio.canvas", vault.deps);
    expect(vault.notices.map((notice) => notice.message)).toEqual(["Già nel vault, uso quello"]);
  });

  it("un file con lo stesso nome e altri byte non si legge se è più lungo, e diventa «nome 1»", async () => {
    const vault = depositVault({ noticed: true });
    vault.files.set("attachments/foto.png", new Uint8Array(70 * 1024 * 1024));
    expect(await depositCanvasFiles([file("foto.png", 1, 2)], "Lavagne/studio.canvas", vault.deps)).toEqual(["attachments/foto 1.png"]);
    expect(vault.reads).toEqual([]);
    expect(vault.closes).toEqual(["attachments/foto.png"]);
    expect(vault.notices).toEqual([]);
  });

  it("stessa lunghezza ma byte diversi: un file nuovo", async () => {
    const vault = depositVault({ noticed: true });
    vault.files.set("attachments/foto.png", new Uint8Array([9, 9]));
    expect(await depositCanvasFiles([file("foto.png", 1, 2)], "Lavagne/studio.canvas", vault.deps)).toEqual(["attachments/foto 1.png"]);
    expect(vault.reads).toEqual(["attachments/foto.png"]);
  });

  it("uno stato di vista che non si legge mostra la notifica lo stesso", async () => {
    const vault = depositVault({ readFails: true });
    await depositCanvasFiles([file("foto.png", 1)], "Lavagne/studio.canvas", vault.deps);
    expect(vault.notices.map((notice) => notice.message)).toEqual(["Copiati in attachments/"]);
  });

  it("un file oltre i 64 MiB si rifiuta senza leggerlo, e ciò che era fatto prima si dice", async () => {
    const vault = depositVault();
    const big = { name: "enorme.bin", size: 65 * 1024 * 1024, arrayBuffer: vi.fn() } as unknown as File;
    await expect(depositCanvasFiles([file("foto.png", 1), big], "Lavagne/studio.canvas", vault.deps)).rejects.toThrow();
    expect((big.arrayBuffer as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    expect(vault.notices.map((notice) => notice.message)).toEqual(["Copiati in attachments/"]);
  });
});
