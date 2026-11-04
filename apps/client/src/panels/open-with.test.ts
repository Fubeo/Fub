// «Apri con un'altra app» (N7, D-6): la voce di sempre senza app Craft
// installate, il sottomenu con l'app di sistema per prima quando ce n'è una.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExternalEditor, OpenedWith } from "../host/ipc";
import type { MenuItem } from "../ui/menu";

const world = vi.hoisted(() => ({
  notified: [] as { text: string; tone: string }[],
  vault: "/vault" as string | undefined,
}));

vi.mock("../ui/notify", () => ({
  notify: (text: string, tone: string) => void world.notified.push({ text, tone }),
}));
vi.mock("../state/store", async (original) => ({
  ...(await original<typeof import("../state/store")>()),
  openVaultRoot: () => world.vault,
}));

import { openWithEntry } from "./open-with";
import type { OpenWithHost } from "../state/external-editors";

const editor = (id: string, name: string, opens: string[], installed: boolean, running = false): ExternalEditor =>
  ({ id, name, opens, installed, running });

const PHOTOCRAFT = editor("photocraft", "PhotoCraft", ["pcraft", "psd"], true);
const VECTORCRAFT = editor("vectorcraft", "VectorCraft", ["vectorcraft", "svg"], false);

/// Un host finto: risponde per estensione come la tabella dell'host, e
/// ricorda le aperture.
function hostWith(installed: boolean, editors: readonly ExternalEditor[], open?: (doc: string, id: string) => Promise<OpenedWith>) {
  const asked: { doc: string; vault: string | undefined }[] = [];
  const opened: { doc: string; editor: string; vault: string | undefined }[] = [];
  const host: OpenWithHost = {
    installed: () => installed,
    editors: async (doc, vault) => {
      asked.push({ doc, vault });
      const extension = doc.includes(".") ? doc.slice(doc.lastIndexOf(".") + 1) : "";
      return editors.filter((each) => each.opens.includes(extension));
    },
    open: async (doc, id, vault) => {
      opened.push({ doc, editor: id, vault });
      return open ? open(doc, id) : { editor: id, how: "new_process" };
    },
  };
  return { host, asked, opened };
}

async function itemsOf(entry: MenuItem): Promise<readonly MenuItem[]> {
  expect(typeof entry.items).toBe("function");
  return (entry.items as () => Promise<readonly MenuItem[]>)();
}

beforeEach(() => {
  world.notified.length = 0;
  world.vault = "/vault";
});

describe("openWithEntry", () => {
  it("senza app Craft installate è la voce di sempre, che chiama l'app di sistema", () => {
    const system = vi.fn();
    const { host, asked } = hostWith(false, [PHOTOCRAFT]);
    const entry = openWithEntry("Foto/ritocco.pcraft", { system, host });
    expect(entry.label).toBe("Apri con un'altra app");
    expect(entry.submenu).toBeUndefined();
    expect(entry.items).toBeUndefined();
    entry.run!();
    expect(system).toHaveBeenCalledTimes(1);
    expect(asked).toEqual([]);
  });

  it("con PhotoCraft installata, il sottomenu di un .pcraft ha l'app di sistema per prima", async () => {
    const system = vi.fn();
    const { host, asked } = hostWith(true, [PHOTOCRAFT, VECTORCRAFT]);
    const entry = openWithEntry("Foto/ritocco.pcraft", { system, host });
    expect(entry.label).toBe("Apri con un'altra app");
    expect(entry.submenu).toBe(true);
    expect(entry.run).toBeUndefined();
    const items = await itemsOf(entry);
    expect(items.map((item) => item.label)).toEqual(["L'app predefinita del sistema", "PhotoCraft"]);
    expect(items[1]!.disabled).toBeUndefined();
    expect(items[1]!.description).toBeUndefined();
    expect(asked).toEqual([{ doc: "Foto/ritocco.pcraft", vault: "/vault" }]);
    items[0]!.run!();
    expect(system).toHaveBeenCalledTimes(1);
  });

  it("un'app che apre il file ma non è installata è spenta e dice perché", async () => {
    const { host } = hostWith(true, [PHOTOCRAFT, VECTORCRAFT]);
    const items = await itemsOf(openWithEntry("Disegni/logo.vectorcraft", { system: () => {}, host }));
    expect(items.map((item) => item.label)).toEqual(["L'app predefinita del sistema", "VectorCraft"]);
    expect(items[1]!.disabled).toBe(true);
    expect(items[1]!.description).toBe("Non installata");
  });

  it("un'app avviata da Fub dice «Già aperta» e resta da scegliere", async () => {
    const { host, opened } = hostWith(true, [editor("photocraft", "PhotoCraft", ["pcraft"], true, true)]);
    const items = await itemsOf(openWithEntry("Foto/ritocco.pcraft", { system: () => {}, host }));
    expect(items[1]!.description).toBe("Già aperta");
    expect(items[1]!.disabled).toBeUndefined();
    items[1]!.run!();
    await vi.waitFor(() => expect(opened).toHaveLength(1));
  });

  it("un .md, che nessuna app Craft apre, ha il sottomenu con la sola app di sistema", async () => {
    const { host } = hostWith(true, [PHOTOCRAFT, VECTORCRAFT]);
    const items = await itemsOf(openWithEntry("Note/idea.md", { system: () => {}, host }));
    expect(items.map((item) => item.label)).toEqual(["L'app predefinita del sistema"]);
  });

  it("un file senza estensione, o un elenco che non arriva, lascia la sola app di sistema", async () => {
    const { host } = hostWith(true, [PHOTOCRAFT]);
    expect((await itemsOf(openWithEntry("LEGGIMI", { system: () => {}, host }))).map((item) => item.label))
      .toEqual(["L'app predefinita del sistema"]);
    const refused: OpenWithHost = { ...host, editors: async () => Promise.reject(new Error("vecchia")) };
    expect((await itemsOf(openWithEntry("Foto/ritocco.pcraft", { system: () => {}, host: refused }))).map((item) => item.label))
      .toEqual(["L'app predefinita del sistema"]);
  });

  it("il clic chiama openWith con l'id dell'app, il file e il vault di quando il menu si è aperto", async () => {
    const { host, opened } = hostWith(true, [PHOTOCRAFT]);
    const items = await itemsOf(openWithEntry("Foto/ritocco.pcraft", { system: () => {}, host }));
    world.vault = undefined;
    items[1]!.run!();
    await vi.waitFor(() => expect(opened).toEqual([{ doc: "Foto/ritocco.pcraft", editor: "photocraft", vault: "/vault" }]));
    expect(world.notified).toEqual([]);
  });

  it("un'apertura che fallisce mostra la frase dell'host", async () => {
    const { host } = hostWith(true, [PHOTOCRAFT], async () => Promise.reject({ kind: "unserved", message: "Il vault è chiuso." }));
    const items = await itemsOf(openWithEntry("Foto/ritocco.pcraft", { system: () => {}, host }));
    items[1]!.run!();
    await vi.waitFor(() => expect(world.notified).toHaveLength(1));
    expect(world.notified[0]!.tone).toBe("guasto");
    expect(world.notified[0]!.text).toContain("Il vault è chiuso.");
  });
});
