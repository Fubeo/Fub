// Le porte della lavagna per portare dentro (T10 di N6, T32): dall'albero
// arrivano solo gli id che il vault conferma; dal computer lo stesso file non
// si copia due volte, e la decisione è dell'host (`reuse`), non del client.
// Il deposito passa da `writeResource` verso il finto host vero, come in
// produzione: così le letture del vault si contano sul finto.
import { describe, expect, it, vi } from "vitest";
import { createFakeHost, type FakeHost } from "../host/fake";
import { RESOURCE_WRITE_HEADER, writeResource, type TauriInvoke } from "../editors/media/transport";
import { ENTRIES_DRAG_TYPE, NOTE_DRAG_TYPE } from "../ui/drag-types";
import { DROP_FOLDER_KEY, DROP_FOLDER_PATH_KEY, preferencesOf } from "../editors/canvas/preferences";
import type { SettingEntry } from "../host/contract";
import type { NoticeAction } from "../ui/notify";
import {
  ATTACHMENTS_NOTICED_KEY,
  depositCanvasFiles,
  dropFolderFor,
  resolveCanvasPaths,
  type CanvasDepositDeps,
  type CanvasPathDeps,
  type DropFolderChoice,
} from "./canvas-intake";

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

/// Il valore di serie di `canvas.drop_folder`: le note, con la loro cartella.
const NOTES: DropFolderChoice = { dropFolder: "notes", dropFolderPath: "Allegati" };

/// Un vault finto per i depositi: il finto host vero con i suoi file, le
/// scritture che passano da `writeResource`, lo stato di vista e le notifiche.
/// `notesFolder` è `files.attachment-folder`; `scheme` è la scelta di
/// `canvas.drop_folder` e le cartelle escluse, lette a ogni trascinamento, e il
/// test la può cambiare fra due trascinamenti.
function depositVault(options: {
  files?: Record<string, Uint8Array>;
  noticed?: unknown;
  readFails?: boolean;
  oldHost?: boolean;
  notesFolder?: string;
  choice?: DropFolderChoice;
  excluded?: string[];
} = {}) {
  const host = createFakeHost({
    resources: Object.fromEntries(Object.entries(options.files ?? {}).map(([id, value]) => [id, { bytes: value }])),
  });
  const invoke = hostInvoke(host, options.oldHost === true);
  const state = new Map<string, unknown>();
  if (options.noticed !== undefined) state.set(ATTACHMENTS_NOTICED_KEY, options.noticed);
  const notices: { message: string; action?: NoticeAction }[] = [];
  const revealSetting = vi.fn();
  const scheme = { choice: options.choice ?? NOTES, excluded: options.excluded ?? [] };
  const deps: CanvasDepositDeps = {
    deposit: async (documentId) => ({
      folder: options.notesFolder ?? "attachments",
      fromDocument: documentId,
      write: (id, value, reuse) => writeResource(invoke, id, value, null, undefined, reuse),
    }),
    dropFolder: async () => scheme.choice,
    excludedFolders: async () => scheme.excluded,
    notify: (message, _tone, action) => notices.push({ message, ...(action ? { action } : {}) }),
    readState: async (key) => {
      if (options.readFails) throw new Error("stato illeggibile");
      return state.get(key) ?? null;
    },
    writeState: (key, value) => { state.set(key, value); },
    revealSetting,
  };
  return { host, state, notices, revealSetting, scheme, deps };
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
    expect(vault.revealSetting).toHaveBeenCalledTimes(1);
    expect(vault.revealSetting).toHaveBeenCalledWith("canvas.drop_folder");
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

/// Una voce di `settings()` come la dà il bundle: `preferencesOf` guarda solo la
/// chiave e il valore.
function setting(key: string, value: unknown): SettingEntry {
  return { spec: { key }, value } as unknown as SettingEntry;
}

describe("dropFolderFor: dove vanno i file trascinati", () => {
  const DOC = "Corsi/Statistica/Lezioni.canvas";

  it("notes: la cartella degli allegati delle note, come oggi, anche `./` relativo alla lavagna", () => {
    expect(dropFolderFor(NOTES, DOC, "attachments")).toBe("attachments");
    expect(dropFolderFor(NOTES, DOC, "./img")).toBe("./img");
  });

  it("board: accanto alla lavagna; alla radice del vault il percorso da sé", () => {
    const board: DropFolderChoice = { dropFolder: "board", dropFolderPath: "Allegati" };
    expect(dropFolderFor(board, DOC, "attachments")).toBe("Corsi/Statistica/Allegati");
    expect(dropFolderFor(board, "Lezioni.canvas", "attachments")).toBe("Allegati");
  });

  it("folder: dalla radice del vault, qualunque sia la lavagna", () => {
    expect(dropFolderFor({ dropFolder: "folder", dropFolderPath: "Foto/Lavagne" }, DOC, "attachments")).toBe("Foto/Lavagne");
  });

  it("una lavagna spostata o rinominata prende la cartella della sua nuova posizione", () => {
    const board: DropFolderChoice = { dropFolder: "board", dropFolderPath: "Allegati" };
    expect(dropFolderFor(board, "Archivio/Lezioni.canvas", "attachments")).toBe("Archivio/Allegati");
    expect(dropFolderFor(board, "Corsi/Statistica/Esame.canvas", "attachments")).toBe("Corsi/Statistica/Allegati");
  });

  it("una barra in coda si toglie; un percorso che la pulizia degli allegati non accetta vale la cartella delle note", () => {
    expect(dropFolderFor({ dropFolder: "folder", dropFolderPath: "Foto/" }, DOC, "attachments")).toBe("Foto");
    for (const bad of ["..", "Foto/../x", "Foto//x", "./Foto", "/Foto", "Foto/.fub", ".fub", "Foto\\x", "Foto/.nascosta", "Foto:ferie", "   ", ""]) {
      expect(dropFolderFor({ dropFolder: "folder", dropFolderPath: bad }, DOC, "attachments"), bad).toBe("attachments");
    }
  });

  it("il valore rotto delle Impostazioni vale Allegati (lo specchio di T33), non la cartella delle note", () => {
    const choice = (path: string) => preferencesOf([setting(DROP_FOLDER_KEY, "folder"), setting(DROP_FOLDER_PATH_KEY, path)]);
    for (const bad of ["../fuori", "/assoluta", "Foto:ferie", ".fub", ""]) {
      expect(dropFolderFor(choice(bad), DOC, "attachments"), bad).toBe("Allegati");
    }
    // Una scelta che non esiste vale quella di serie: le note.
    expect(dropFolderFor(preferencesOf([setting(DROP_FOLDER_KEY, "altrove")]), DOC, "attachments")).toBe("attachments");
  });
});

describe("depositCanvasFiles, con la cartella di canvas.drop_folder", () => {
  const BOARD: DropFolderChoice = { dropFolder: "board", dropFolderPath: "Allegati" };

  it("le note continuano a usare files.attachment-folder, anche `./` relativo; la lavagna con board no", async () => {
    const notes = depositVault({ notesFolder: "./img" });
    expect(await depositCanvasFiles([file("foto.png", 1)], "Corsi/Statistica/Lezioni.canvas", notes.deps)).toEqual(["Corsi/Statistica/img/foto.png"]);
    const board = depositVault({ notesFolder: "./img", choice: BOARD });
    expect(await depositCanvasFiles([file("foto.png", 1)], "Corsi/Statistica/Lezioni.canvas", board.deps)).toEqual(["Corsi/Statistica/Allegati/foto.png"]);
  });

  it("board: il file va accanto alla lavagna, la notifica dice dove, e «Cambia cartella» apre canvas.drop_folder", async () => {
    const vault = depositVault({ choice: BOARD });
    expect(await depositCanvasFiles([file("foto.png", 1, 2)], "Corsi/Statistica/Lezioni.canvas", vault.deps)).toEqual(["Corsi/Statistica/Allegati/foto.png"]);
    expect(vault.notices.map((notice) => notice.message)).toEqual(["Copiati in Corsi/Statistica/Allegati/"]);
    await vault.notices[0]!.action!.run();
    expect(vault.revealSetting).toHaveBeenCalledWith("canvas.drop_folder");
  });

  it("board alla radice del vault: Allegati/ alla radice", async () => {
    const vault = depositVault({ choice: BOARD });
    expect(await depositCanvasFiles([file("foto.png", 1)], "Lezioni.canvas", vault.deps)).toEqual(["Allegati/foto.png"]);
    expect(vault.notices.map((notice) => notice.message)).toEqual(["Copiati in Allegati/"]);
  });

  it("folder: la cartella del vault, e ogni trascinamento rilegge la scelta", async () => {
    const vault = depositVault({ choice: BOARD, noticed: true });
    expect(await depositCanvasFiles([file("a.png", 1)], "Corsi/Statistica/Lezioni.canvas", vault.deps)).toEqual(["Corsi/Statistica/Allegati/a.png"]);
    vault.scheme.choice = { dropFolder: "folder", dropFolderPath: "Foto/Lavagne" };
    expect(await depositCanvasFiles([file("b.png", 2)], "Corsi/Statistica/Lezioni.canvas", vault.deps)).toEqual(["Foto/Lavagne/b.png"]);
  });

  it("una lavagna spostata: i file nuovi vanno accanto alla nuova posizione, i vecchi restano dove sono", async () => {
    const vault = depositVault({ choice: BOARD, noticed: true });
    await depositCanvasFiles([file("a.png", 1)], "Corsi/Statistica/Lezioni.canvas", vault.deps);
    expect(await depositCanvasFiles([file("b.png", 2)], "Archivio/Lezioni.canvas", vault.deps)).toEqual(["Archivio/Allegati/b.png"]);
    expect(Object.keys(vault.host.files())).toEqual(expect.arrayContaining(["Corsi/Statistica/Allegati/a.png", "Archivio/Allegati/b.png"]));
  });

  it("un valore rotto nelle Impostazioni: i file vanno in Allegati, e la notifica dice Allegati/", async () => {
    const vault = depositVault({ choice: preferencesOf([setting(DROP_FOLDER_KEY, "folder"), setting(DROP_FOLDER_PATH_KEY, "../fuori")]) });
    expect(await depositCanvasFiles([file("foto.png", 1)], "Corsi/Statistica/Lezioni.canvas", vault.deps)).toEqual(["Allegati/foto.png"]);
    expect(vault.notices.map((notice) => notice.message)).toEqual(["Copiati in Allegati/"]);
  });

  it("un file che il vault ha già non si copia in nessuna cartella, nemmeno in quella della lavagna", async () => {
    const vault = depositVault({ choice: BOARD, files: { "Foto/lavagna.jpg": new Uint8Array([1, 2]) } });
    expect(await depositCanvasFiles([file("IMG_2042.jpg", 1, 2)], "Corsi/Statistica/Lezioni.canvas", vault.deps)).toEqual(["Foto/lavagna.jpg"]);
    expect(Object.keys(vault.host.files()).filter((id) => id.includes("Allegati"))).toEqual([]);
    expect(vault.notices.map((notice) => notice.message)).toEqual(["Già nel vault come Foto/lavagna.jpg, uso quello"]);
  });

  it("una cartella esclusa dall'indice: la notifica lo dice, e «Cambia cartella» resta", async () => {
    const vault = depositVault({ choice: BOARD, excluded: ["Corsi/Statistica/Allegati/"] });
    await depositCanvasFiles([file("foto.png", 1)], "Corsi/Statistica/Lezioni.canvas", vault.deps);
    expect(vault.notices.map((notice) => notice.message)).toEqual([
      "Copiati in Corsi/Statistica/Allegati/: è una cartella esclusa dall'indice, lì i file non si troveranno con la ricerca",
    ]);
    expect(vault.notices[0]!.action?.label).toBe("Cambia cartella");
  });

  it("esclusa vuol dire che la cartella ci sta dentro: una più in basso o di nome simile non la copre", async () => {
    const below = depositVault({ choice: BOARD, excluded: ["Corsi/Statistica/Allegati/Foto"] });
    await depositCanvasFiles([file("foto.png", 1)], "Corsi/Statistica/Lezioni.canvas", below.deps);
    expect(below.notices.map((notice) => notice.message)).toEqual(["Copiati in Corsi/Statistica/Allegati/"]);
    const similar = depositVault({ choice: BOARD, excluded: ["Corsi/Stat"] });
    await depositCanvasFiles([file("foto.png", 1)], "Corsi/Statistica/Lezioni.canvas", similar.deps);
    expect(similar.notices.map((notice) => notice.message)).toEqual(["Copiati in Corsi/Statistica/Allegati/"]);
    const above = depositVault({ choice: BOARD, excluded: ["Corsi"] });
    await depositCanvasFiles([file("foto.png", 1)], "Corsi/Statistica/Lezioni.canvas", above.deps);
    expect(above.notices.map((notice) => notice.message)[0]).toContain("esclusa dall'indice");
  });
});
