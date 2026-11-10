// Le porte della lavagna per portare dentro (T10 di N6, T32): dall'albero
// arrivano solo gli id che il vault conferma; dal computer lo stesso file non
// si copia due volte, e la decisione è dell'host (`reuse`), non del client.
// Il deposito passa da `writeResource` verso il finto host vero, come in
// produzione: così le letture del vault si contano sul finto.
import { describe, expect, it, vi } from "vitest";
import { createFakeHost, type FakeHost } from "../host/fake";
import { RESOURCE_WRITE_HEADER, writeResource, type TauriInvoke } from "../editors/media/transport";
import { ENTRIES_DRAG_TYPE, NOTE_DRAG_TYPE } from "../ui/drag-types";
import type { AttachmentDeposit } from "../editors/media/attachment-target";
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

/// Il `invoke` di Tauri verso il finto host, per il solo `resource_write`: i
/// metadati arrivano nell'intestazione, come in produzione. `oldHost` è un host
/// di prima, che rifiuta il campo `reuse` che non conosce.
function hostInvoke(host: FakeHost, oldHost: boolean): TauriInvoke {
  const invoke = async (cmd: string, body?: unknown, options?: { headers?: Record<string, string> }) => {
    if (cmd !== "resource_write") throw new Error(`comando inatteso: ${cmd}`);
    const meta = JSON.parse(decodeURIComponent(options!.headers![RESOURCE_WRITE_HEADER]!)) as {
      id: string; vault: string | null; expected: string | null; reuse?: "same-content";
    };
    if (oldHost && meta.reuse !== undefined) {
      throw { kind: "bad_args", message: "resource_write metadata has an unknown field `reuse`" };
    }
    const reuse = meta.reuse === undefined ? undefined : { reuse: meta.reuse };
    return host.module.api.resourceWrite(meta.id, body as Uint8Array, meta.expected, meta.vault, reuse);
  };
  return invoke as unknown as TauriInvoke;
}

/// Un vault finto per i depositi: il finto host vero con i suoi file, le
/// scritture che passano da `writeResource`, lo stato di vista e le notifiche.
function depositVault(options: {
  files?: Record<string, Uint8Array>;
  noticed?: unknown;
  readFails?: boolean;
  oldHost?: boolean;
} = {}) {
  const host = createFakeHost({
    resources: Object.fromEntries(Object.entries(options.files ?? {}).map(([id, value]) => [id, { bytes: value }])),
  });
  const invoke = hostInvoke(host, options.oldHost === true);
  const state = new Map<string, unknown>();
  if (options.noticed !== undefined) state.set(ATTACHMENTS_NOTICED_KEY, options.noticed);
  const notices: { message: string; action?: NoticeAction }[] = [];
  const changeFolder = vi.fn();
  const deposit: AttachmentDeposit = {
    folder: "attachments",
    fromDocument: "Lavagne/studio.canvas",
    write: (id, value, reuse) => writeResource(invoke, id, value, null, undefined, reuse),
  };
  const deps: CanvasDepositDeps = {
    deposit: async () => deposit,
    notify: (message, _tone, action) => notices.push({ message, ...(action ? { action } : {}) }),
    readState: async (key) => {
      if (options.readFails) throw new Error("stato illeggibile");
      return state.get(key) ?? null;
    },
    writeState: (key, value) => { state.set(key, value); },
    changeFolder,
  };
  return { host, state, notices, changeFolder, deps };
}

/// Le letture del vault che il client ha fatto sul finto: aprire un file e
/// leggerne le fette. Un deposito dal computer non ne deve fare nessuna.
function vaultReads(host: FakeHost): string[] {
  return [...host.atGate("resourceOpen"), ...host.atGate("resourceReadChunk")].map((call) => call.gate);
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
    expect(Object.keys(vault.host.files())).toContain("attachments/altra.png");
  });

  it("lo stesso file trascinato di nuovo si riusa: la notifica dice il percorso, o il numero se sono più d'uno", async () => {
    const vault = depositVault({ noticed: true });
    await depositCanvasFiles([file("a.png", 1, 2), file("b.png", 3)], "Lavagne/studio.canvas", vault.deps);
    expect(vault.notices).toEqual([]);

    const again = await depositCanvasFiles([file("a.png", 1, 2), file("b.png", 3), file("c.png", 4)], "Lavagne/studio.canvas", vault.deps);
    expect(again).toEqual(["attachments/a.png", "attachments/b.png", "attachments/c.png"]);
    expect(Object.keys(vault.host.files()).filter((id) => id.startsWith("attachments/")).sort())
      .toEqual(["attachments/a.png", "attachments/b.png", "attachments/c.png"]);
    expect(vault.notices.map((notice) => notice.message)).toEqual(["2 file già nel vault, uso quelli"]);

    vault.notices.length = 0;
    await depositCanvasFiles([file("c.png", 4)], "Lavagne/studio.canvas", vault.deps);
    expect(vault.notices.map((notice) => notice.message)).toEqual(["Già nel vault come attachments/c.png, uso quello"]);
  });

  it("il file del vault con un altro nome si riusa: l'host lo trova, e il client non lo apre", async () => {
    const vault = depositVault({ noticed: true, files: { "Foto/lavagna.jpg": new Uint8Array([1, 2]) } });
    const result = await depositCanvasFiles([file("IMG_2042.jpg", 1, 2)], "Lavagne/studio.canvas", vault.deps);
    expect(result).toEqual(["Foto/lavagna.jpg"]);
    expect(vault.notices.map((notice) => notice.message)).toEqual(["Già nel vault come Foto/lavagna.jpg, uso quello"]);
    expect(vaultReads(vault.host)).toEqual([]);
    expect(vault.host.atGate("resourceWrite").map((call) => call.args[4])).toEqual([{ reuse: "same-content" }]);
  });

  it("un file del vault con lo stesso nome e altri byte: nasce «foto 1.png», e nessun file del vault si legge", async () => {
    const vault = depositVault({ noticed: true, files: { "attachments/foto.png": new Uint8Array([9, 9]) } });
    expect(await depositCanvasFiles([file("foto.png", 1, 2)], "Lavagne/studio.canvas", vault.deps)).toEqual(["attachments/foto 1.png"]);
    expect(vaultReads(vault.host)).toEqual([]);
    expect(vault.notices).toEqual([]);
  });

  it("un host che non sa `reuse`: il file si deposita senza, e la prima volta si dice dove", async () => {
    const vault = depositVault({ oldHost: true, files: { "Foto/lavagna.jpg": new Uint8Array([1, 2]) } });
    expect(await depositCanvasFiles([file("IMG_2042.jpg", 1, 2)], "Lavagne/studio.canvas", vault.deps)).toEqual(["attachments/IMG_2042.jpg"]);
    expect(vault.notices.map((notice) => notice.message)).toEqual(["Copiati in attachments/"]);
    expect(vaultReads(vault.host)).toEqual([]);
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

  it("40 foto di cui 10 già nel vault: una notifica sola col numero, e le altre 30 si copiano", async () => {
    const existing = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`Foto/f${i}.png`, new Uint8Array([65 + i, 66, 67])]));
    const vault = depositVault({ files: existing });
    const photos = Array.from({ length: 40 }, (_, i) => (i < 10 ? file(`IMG_${i}.jpg`, 65 + i, 66, 67) : file(`IMG_${i}.jpg`, 100 + i, 101, 102)));
    const paths = await depositCanvasFiles(photos, "Lavagne/studio.canvas", vault.deps);
    expect(paths).toHaveLength(40);
    expect(paths.slice(0, 10)).toEqual(Array.from({ length: 10 }, (_, i) => `Foto/f${i}.png`));
    expect(vault.notices.map((notice) => notice.message)).toEqual(["10 file già nel vault, uso quelli", "Copiati in attachments/"]);
    expect(vaultReads(vault.host)).toEqual([]);
  });
});
