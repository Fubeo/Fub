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
import { forgetLends, lendHeld, lentTo, onLendChanged, renameLend, type LendGate } from "../state/lend";

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
  forgetLends();
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

const WORDCRAFT = editor("wordcraft", "WordCraft", ["docx"], true);

/// Chi tiene le schede, finto: `open` sono i documenti con una scheda,
/// `unsaved` quelli che il salvataggio lascia indietro; `steps` ricorda
/// l'ordine di salvataggio e apertura.
function gateWith(open: string[], unsaved: string[] = []) {
  const steps: string[] = [];
  let duringFlush: (() => void) | null = null;
  const gate: LendGate = {
    lendable: (doc) => open.includes(doc),
    flush: async () => {
      steps.push("flush");
      duringFlush?.();
      return [...unsaved];
    },
  };
  return { gate, steps, open, onFlush: (run: () => void) => void (duringFlush = run) };
}

/// Sceglie `app` nel sottomenu di `doc` e aspetta che la scelta finisca.
async function choose(doc: string, app: string, host: OpenWithHost, gate: LendGate | null): Promise<void> {
  const items = await itemsOf(openWithEntry(doc, { system: () => {}, host, lending: () => gate }));
  const item = items.find((each) => each.label === app);
  if (!item) throw new Error(`nel sottomenu non c'è ${app}`);
  item.run!();
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

describe("il prestito da «Apri con»", () => {
  it("salva prima di aprire, e presta all'app col suo nome", async () => {
    const { gate, steps } = gateWith(["Lettera.docx"]);
    const { host, opened } = hostWith(true, [WORDCRAFT], async (_doc, id) => {
      steps.push("open");
      return { editor: id, how: "new_process" };
    });
    await choose("Lettera.docx", "WordCraft", host, gate);
    expect(steps).toEqual(["flush", "open"]);
    expect(opened.map((each) => each.doc)).toEqual(["Lettera.docx"]);
    expect(lentTo("Lettera.docx")).toBe("WordCraft");
    expect(world.notified).toEqual([]);
  });

  it("un salvataggio fallito non apre l'app, non presta, e lo dice una volta", async () => {
    const { gate } = gateWith(["Lettera.docx"], ["Lettera.docx"]);
    const { host, opened } = hostWith(true, [WORDCRAFT]);
    await choose("Lettera.docx", "WordCraft", host, gate);
    expect(opened).toEqual([]);
    expect(lentTo("Lettera.docx")).toBeNull();
    expect(world.notified).toEqual([{ text: "Non ho potuto salvare: «Lettera.docx» non si apre in WordCraft.", tone: "guasto" }]);
  });

  it("un altro documento rimasto da salvare non ferma il prestito", async () => {
    const { gate } = gateWith(["Lettera.docx"], ["Altro.md"]);
    const { host } = hostWith(true, [WORDCRAFT]);
    await choose("Lettera.docx", "WordCraft", host, gate);
    expect(lentTo("Lettera.docx")).toBe("WordCraft");
  });

  it("la prenotazione tiene la sola lettura dal salvataggio all'app, e se l'app non parte la lascia", async () => {
    const tabs = gateWith(["Lettera.docx"]);
    const held: string[] = [];
    const seen: string[] = [];
    const stop = onLendChanged((doc) => seen.push(doc));
    tabs.onFlush(() => held.push(`flush:${lendHeld("Lettera.docx")}`));
    const { host } = hostWith(true, [WORDCRAFT], async () => {
      held.push(`open:${lendHeld("Lettera.docx")}`);
      throw new Error("WordCraft non parte.");
    });
    await choose("Lettera.docx", "WordCraft", host, tabs.gate);
    stop();
    expect(held).toEqual(["flush:true", "open:true"]);
    expect(lendHeld("Lettera.docx")).toBe(false);
    expect(lentTo("Lettera.docx")).toBeNull();
    // Chi tiene le schede lo sa due volte: la prenotazione, e la sua fine.
    expect(seen).toEqual(["Lettera.docx", "Lettera.docx"]);
  });

  it("un'app che non parte non presta", async () => {
    const { gate } = gateWith(["Lettera.docx"]);
    const { host } = hostWith(true, [WORDCRAFT], async () => Promise.reject(new Error("WordCraft non parte.")));
    await choose("Lettera.docx", "WordCraft", host, gate);
    expect(lentTo("Lettera.docx")).toBeNull();
    expect(world.notified.map((each) => each.text)).toEqual(["WordCraft non parte."]);
  });

  it("senza scheda, o senza chi tiene le schede, si apre e basta", async () => {
    const { gate, steps } = gateWith([]);
    const { host, opened } = hostWith(true, [WORDCRAFT]);
    await choose("Lettera.docx", "WordCraft", host, gate);
    await choose("Lettera.docx", "WordCraft", host, null);
    expect(steps).toEqual([]);
    expect(opened).toHaveLength(2);
    expect(lentTo("Lettera.docx")).toBeNull();
  });

  it("l'app del sistema non presta", async () => {
    const { gate, steps } = gateWith(["Lettera.docx"]);
    const { host } = hostWith(true, [WORDCRAFT]);
    const system = vi.fn();
    const items = await itemsOf(openWithEntry("Lettera.docx", { system, host, lending: () => gate }));
    items[0]!.run!();
    expect(system).toHaveBeenCalledTimes(1);
    expect(steps).toEqual([]);
    expect(lentTo("Lettera.docx")).toBeNull();
  });

  it("rinominato durante il salvataggio, apre e presta il nome nuovo", async () => {
    const tabs = gateWith(["Lettera.docx"]);
    tabs.onFlush(() => {
      tabs.open.splice(0, 1, "Nuova.docx");
      renameLend("Lettera.docx", "Nuova.docx");
    });
    const { host, opened } = hostWith(true, [WORDCRAFT]);
    await choose("Lettera.docx", "WordCraft", host, tabs.gate);
    expect(opened.map((each) => each.doc)).toEqual(["Nuova.docx"]);
    expect(lentTo("Nuova.docx")).toBe("WordCraft");
    expect(lentTo("Lettera.docx")).toBeNull();
  });

  it("una risposta arrivata dopo la chiusura della scheda o del vault non presta", async () => {
    const tabs = gateWith(["Lettera.docx"]);
    const closing = hostWith(true, [WORDCRAFT], async (_doc, id) => {
      tabs.open.length = 0;
      return { editor: id, how: "new_process" };
    });
    await choose("Lettera.docx", "WordCraft", closing.host, tabs.gate);
    expect(closing.opened).toHaveLength(1);
    expect(lentTo("Lettera.docx")).toBeNull();

    tabs.open.push("Lettera.docx");
    const vaultGone = hostWith(true, [WORDCRAFT], async (_doc, id) => {
      forgetLends();
      return { editor: id, how: "new_process" };
    });
    await choose("Lettera.docx", "WordCraft", vaultGone.host, tabs.gate);
    expect(lentTo("Lettera.docx")).toBeNull();
  });
});
