// @vitest-environment happy-dom
//
// Il prestito (T17): il registro da solo, poi la shell vera sull'host finto,
// con un Word prestato a WordCraft dal menu dell'albero.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeHost } from "../host/fake";
import type { ExternalEditor } from "../host/ipc";

vi.setConfig({ testTimeout: 20_000 });

const box = vi.hoisted(() => ({ host: null as FakeHost | null }));

let activeStop: (() => void) | null = null;

vi.mock("../host/ipc", () => {
  const now = () => {
    if (!box.host) throw new Error("l'host finto non è stato montato");
    return box.host.module;
  };
  return {
    api: new Proxy(
      {},
      {
        get: (_t, name: string) => (...args: unknown[]) =>
          (now().api as unknown as Record<string, (...a: unknown[]) => unknown>)[name](...args),
      },
    ),
    onKernelEvent: (handler: (n: unknown) => void) => now().onKernelEvent(handler as never),
    onClose: (first: () => Promise<boolean>, onFailure: (reason: unknown) => void) => now().onClose(first, onFailure),
    window: {
      minimize: async () => {},
      toggleMaximize: async () => {},
      close: async () => {},
      isMaximized: async () => false,
      setTitle: async () => {},
      onResize: async () => async () => {},
    },
  };
});

vi.mock("../host/dialog", () => ({
  confirm: () => Promise.resolve(true),
  pickFolder: () => Promise.resolve("/vault"),
  pickFile: () => Promise.resolve(null),
}));

const { createFakeHost } = await import("../host/fake");
const rawHtml = (await import("../../index.html?raw")).default;

function rich(text: string): string {
  return JSON.stringify({
    format: "fub-rich",
    version: 1,
    blocks: [{ t: "para", role: { kind: "body" }, c: [{ t: "text", x: text }] }],
  });
}

const VAULT = {
  "Benvenuto.md": "# Benvenuto\n",
  "Lettera.docx": rich("ciao"),
  "suono.mp3": "mp3",
};

const WORDCRAFT: ExternalEditor = { id: "wordcraft", name: "WordCraft", opens: ["docx"], installed: true, running: false };

async function settle(rounds = 6): Promise<void> {
  for (let i = 0; i < rounds; i += 1) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

async function waitFor(thing: string, cond: () => boolean, within = 3000): Promise<void> {
  const deadline = Date.now() + within;
  while (Date.now() < deadline) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`non è mai successo: ${thing}`);
}

async function start(file: Record<string, string> = VAULT): Promise<FakeHost> {
  vi.resetModules();
  const host = createFakeHost({
    file,
    resources: { "suono.mp3": { bytes: new Uint8Array([73, 68, 51, 3, 0]), mime: "audio/mpeg" } },
    externalEditors: async (doc) => (doc === null || doc.endsWith(".docx") ? [WORDCRAFT] : []),
    openWith: async (_path, editor) => ({ editor, how: "new_process" }),
    revealInSystem: async () => "opened" as never,
  });
  box.host = host;
  const body = /<body[^>]*>([\s\S]*)<\/body>/.exec(rawHtml);
  if (!body) throw new Error("index.html non ha un body");
  document.body.innerHTML = body[1].replace(/<script[\s\S]*?<\/script>/g, "");
  const main = await import("../main");
  activeStop = await main.startup;
  await settle();
  const external = await import("./external-editors");
  await waitFor("le app Craft sono note", () => external.craftEditorsInstalled());
  return host;
}

async function open(doc: string): Promise<void> {
  const { openDocument } = await import("../panels/document");
  await openDocument(doc);
  await settle();
}

const treeRow = (path: string) => document.querySelector<HTMLElement>(`#file-list li[data-path="${path}"] > .tree-row`);
const label = (b: Element) => b.querySelector(".menu-label")?.textContent ?? b.textContent;

/// Apre il menu contestuale su `on` e segue `path`: ogni nome prima
/// dell'ultimo apre un sottomenu, che si riempie quando può (le app Craft si
/// chiedono all'host).
async function menuPath(on: HTMLElement, ...path: string[]): Promise<void> {
  on.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  if (!document.getElementById("context-menu")) throw new Error("il menu contestuale non si è aperto");
  for (const [depth, entry] of path.entries()) {
    const level = () => (depth === 0 ? document.getElementById("context-menu") : document.querySelectorAll(".context-submenu")[depth - 1]);
    const button = () => [...(level()?.querySelectorAll("button") ?? [])].find((b) => label(b) === entry);
    try {
      await waitFor(`nel menu c'è «${entry}»`, () => !!button(), 1500);
    } catch {
      throw new Error(`nel menu non c'è «${entry}»: ${[...(level()?.querySelectorAll("button") ?? [])].map(label)}`);
    }
    button()!.click();
    await settle();
  }
}

/// Dal menu dell'albero: Organizza › Apri con un'altra app › `app`.
async function openWithFromTree(path: string, app: string): Promise<void> {
  await waitFor(`${path} è nell'albero`, () => !!treeRow(path));
  await menuPath(treeRow(path)!, "Organizza", "Apri con un'altra app", app);
}

/// Mette in coda una modifica al documento, come una battuta del riquadro.
async function queueEdit(doc: string, text: string): Promise<void> {
  const { documentSessions } = await import("./document-session");
  const { operationFromText } = await import("../editors/core/text-operation");
  const before = documentSessions.text(doc)!;
  const outcome = documentSessions.acceptSurfaceChange(doc, "test-battuta", { text, operation: operationFromText(before, text) });
  expect(outcome.kind).toBe("accepted");
}

const lentRows = () => [...document.querySelectorAll<HTMLElement>('.sheet-notice[data-notice="lent"]')].filter((row) => !row.closest("[hidden]"));
const editables = () => [...document.querySelectorAll<HTMLElement>(".pane .ProseMirror")];
const readOnly = () => editables().length > 0 && editables().every((el) => el.getAttribute("contenteditable") === "false");
const editable = () => editables().length > 0 && editables().every((el) => el.getAttribute("contenteditable") === "true");

beforeEach(() => {
  activeStop?.();
  activeStop = null;
  document.body.innerHTML = "";
  localStorage.clear();
});

afterEach(async () => {
  const lend = await import("./lend");
  lend.forgetLends();
});

describe("il registro dei prestiti", () => {
  it("presta, dice a chi, riprende e avvisa chi ascolta finché non smette", async () => {
    vi.resetModules();
    const lend = await import("./lend");
    const seen: string[] = [];
    const stop = lend.onLendChanged((doc) => seen.push(doc));
    lend.lend("a.docx", "WordCraft");
    lend.lend("a.docx", "WordCraft");
    expect(lend.lentTo("a.docx")).toBe("WordCraft");
    expect(lend.lentDocuments()).toEqual(["a.docx"]);
    lend.unlend("a.docx");
    lend.unlend("a.docx");
    expect(lend.lentTo("a.docx")).toBeNull();
    expect(seen).toEqual(["a.docx", "a.docx"]);
    stop();
    lend.lend("b.docx", "GridCraft");
    expect(seen).toEqual(["a.docx", "a.docx"]);
    lend.forgetLends();
    expect(lend.lentTo("b.docx")).toBeNull();
  });

  it("la rinomina porta con sé il prestito e la prenotazione", async () => {
    vi.resetModules();
    const lend = await import("./lend");
    lend.lend("a.docx", "WordCraft");
    const reservation = lend.reserveLend("c.docx", () => true);
    lend.renameLend("a.docx", "b.docx");
    lend.renameLend("c.docx", "d.docx");
    expect(lend.lentTo("a.docx")).toBeNull();
    expect(lend.lentTo("b.docx")).toBe("WordCraft");
    expect(reservation.doc).toBe("d.docx");
    expect(reservation.commit("WordCraft")).toBe(true);
    expect(lend.lentTo("d.docx")).toBe("WordCraft");
    lend.forgetLends();
  });

  it("una prenotazione lasciata, o sopravvissuta al vault, non presta", async () => {
    vi.resetModules();
    const lend = await import("./lend");
    const left = lend.reserveLend("a.docx", () => true);
    left.cancel();
    expect(left.commit("WordCraft")).toBe(false);
    const stale = lend.reserveLend("a.docx", () => true);
    lend.forgetLends();
    expect(stale.commit("WordCraft")).toBe(false);
    const closed = lend.reserveLend("a.docx", () => false);
    expect(closed.commit("WordCraft")).toBe(false);
    expect(lend.lentTo("a.docx")).toBeNull();
  });
});

describe("un Word prestato a WordCraft", () => {
  it("salva prima di aprire, resta in sola lettura con la riga, ricarica dal disco, e «Riprendi qui» lo ridà", async () => {
    const host = await start();
    await open("Lettera.docx");
    await waitFor("il Word è modificabile", editable);
    await queueEdit("Lettera.docx", rich("ciao mondo"));

    await openWithFromTree("Lettera.docx", "WordCraft");
    await waitFor("WordCraft apre il file", () => host.atGate("openWith").length === 1);
    const order = host.calls.map((call) => call.gate).filter((gate) => gate === "writeDocument" || gate === "openWith");
    expect(order[0]).toBe("writeDocument");
    expect(order[order.length - 1]).toBe("openWith");
    expect(host.atGate("openWith")[0].args.slice(0, 2)).toEqual(["Lettera.docx", "wordcraft"]);
    expect(host.files()["Lettera.docx"]).toBe(rich("ciao mondo"));

    const lend = await import("./lend");
    await waitFor("la riga del prestito", () => lentRows().length === 1);
    expect(lend.lentTo("Lettera.docx")).toBe("WordCraft");
    const row = lentRows()[0];
    expect(row.dataset.tone).toBe("info");
    expect(row.querySelector(".sheet-notice-text")!.textContent).toContain("Aperto in WordCraft");
    expect(row.querySelector("button")!.textContent).toBe("Riprendi qui");
    await waitFor("il Word è in sola lettura", readOnly);

    // L'app scrive: la scheda ricarica, e non c'è niente in conflitto.
    host.writeFromOutside("Lettera.docx", rich("scritto da WordCraft"));
    await waitFor("la scheda ricarica", () => editables()[0]?.textContent?.includes("scritto da WordCraft") ?? false);
    const { documentSessions } = await import("./document-session");
    expect(documentSessions.text("Lettera.docx")).toBe(rich("scritto da WordCraft"));
    expect(document.querySelector('.sheet-notice[data-notice="conflict"]')).toBeNull();
    expect(readOnly()).toBe(true);

    lentRows()[0].querySelector("button")!.click();
    await settle();
    expect(lend.lentTo("Lettera.docx")).toBeNull();
    await waitFor("la riga se ne va", () => lentRows().length === 0);
    await waitFor("il Word torna modificabile", editable);
  });

  it("un salvataggio fallito non apre l'app e lo dice", async () => {
    const host = await start();
    await open("Lettera.docx");
    await waitFor("il Word è modificabile", editable);
    host.fault("writeDocument", "disco pieno");
    await queueEdit("Lettera.docx", rich("ciao mondo"));

    await openWithFromTree("Lettera.docx", "WordCraft");
    const { recentNotices } = await import("../ui/notify");
    await waitFor("l'avviso", () => recentNotices().some((n) => n.text.includes("Non ho potuto salvare")));
    const notice = recentNotices().find((n) => n.text.includes("Non ho potuto salvare"))!;
    expect(notice.text).toBe("Non ho potuto salvare: «Lettera.docx» non si apre in WordCraft.");
    expect(host.atGate("openWith")).toHaveLength(0);
    const lend = await import("./lend");
    expect(lend.lentTo("Lettera.docx")).toBeNull();
    expect(editable()).toBe(true);
  });

  it("chiudere la scheda finisce il prestito, e la scheda riaperta è modificabile", async () => {
    const host = await start();
    await open("Lettera.docx");
    await openWithFromTree("Lettera.docx", "WordCraft");
    await waitFor("WordCraft apre il file", () => host.atGate("openWith").length === 1);
    const lend = await import("./lend");
    await waitFor("il prestito", () => lend.lentTo("Lettera.docx") !== null);

    const { closeCurrentTab } = await import("./document-controller");
    await closeCurrentTab();
    await settle();
    expect(lend.lentTo("Lettera.docx")).toBeNull();
    await open("Lettera.docx");
    await waitFor("il Word riaperto è modificabile", editable);
    expect(lentRows()).toHaveLength(0);
  });

  it("la cancellazione in sospeso e il prestito tengono ciascuno la sua sola lettura", async () => {
    const host = await start();
    await open("Lettera.docx");
    await openWithFromTree("Lettera.docx", "WordCraft");
    await waitFor("WordCraft apre il file", () => host.atGate("openWith").length === 1);
    await waitFor("il Word è in sola lettura", readOnly);
    const lend = await import("./lend");
    const { documentSessions } = await import("./document-session");

    // La cancellazione comincia e si annulla: il prestito resta.
    expect(documentSessions.beginDeletion("Lettera.docx")).toBe(true);
    await settle();
    expect(readOnly()).toBe(true);
    documentSessions.cancelDeletion("Lettera.docx");
    await settle();
    expect(readOnly()).toBe(true);
    expect(lend.lentTo("Lettera.docx")).toBe("WordCraft");

    // La cancellazione in sospeso, poi «Riprendi qui»: resta in sola lettura.
    expect(documentSessions.beginDeletion("Lettera.docx")).toBe(true);
    lend.unlend("Lettera.docx");
    await settle();
    expect(readOnly()).toBe(true);
    documentSessions.cancelDeletion("Lettera.docx");
    await settle();
    await waitFor("niente lo tiene più fermo", editable);
  });

  it("in due riquadri: tutti e due in sola lettura con la riga, e il prestito segue la rinomina", async () => {
    const host = await start();
    await open("Lettera.docx");
    const { openDocumentBeside } = await import("../panels/document");
    await openDocumentBeside("Lettera.docx", "row");
    await settle();
    await waitFor("due riquadri col Word", () => editables().length === 2);
    await openWithFromTree("Lettera.docx", "WordCraft");
    await waitFor("WordCraft apre il file", () => host.atGate("openWith").length === 1);
    await waitFor("due righe del prestito", () => lentRows().length === 2);
    await waitFor("tutti e due in sola lettura", readOnly);

    const lend = await import("./lend");
    host.renameFromOutside("Lettera.docx", "Lettera nuova.docx");
    await waitFor("il prestito segue il nome", () => lend.lentTo("Lettera nuova.docx") === "WordCraft");
    expect(lend.lentTo("Lettera.docx")).toBeNull();
    await settle();
    expect(lentRows().length).toBe(2);
    expect(readOnly()).toBe(true);
  });

  it("la chiusura del vault dimentica il prestito", async () => {
    const host = await start();
    await open("Lettera.docx");
    await openWithFromTree("Lettera.docx", "WordCraft");
    const lend = await import("./lend");
    await waitFor("il prestito", () => lend.lentTo("Lettera.docx") !== null);
    host.emit({ type: "vault_closed" } as never);
    await settle();
    expect(lend.lentTo("Lettera.docx")).toBeNull();
  });

  it("l'app del sistema, o un documento senza scheda, non presta", async () => {
    const host = await start();
    await open("Lettera.docx");
    await openWithFromTree("Lettera.docx", "L'app predefinita del sistema");
    await waitFor("il sistema apre il file", () => host.atGate("revealInSystem").length === 1);
    const lend = await import("./lend");
    expect(lend.lentTo("Lettera.docx")).toBeNull();

    const { closeCurrentTab } = await import("./document-controller");
    await closeCurrentTab();
    await settle();
    await openWithFromTree("Lettera.docx", "WordCraft");
    await waitFor("WordCraft apre il file", () => host.atGate("openWith").length === 1);
    await settle();
    expect(lend.lentTo("Lettera.docx")).toBeNull();
  });

  it("una risposta di WordCraft arrivata dopo la chiusura della scheda non presta", async () => {
    const host = await start();
    await open("Lettera.docx");
    const release = host.throttle("openWith");
    await openWithFromTree("Lettera.docx", "WordCraft");
    await waitFor("WordCraft è in volo", () => host.atGate("openWith").length === 1);
    const { closeCurrentTab } = await import("./document-controller");
    await closeCurrentTab();
    await settle();
    release();
    await settle();
    const lend = await import("./lend");
    expect(lend.lentTo("Lettera.docx")).toBeNull();
  });
});

describe("il lettore dei file multimediali", () => {
  it("offre «Apri con un'altra app», che passa il file al sistema senza prestarlo", async () => {
    const host = await start();
    await open("suono.mp3");
    const content = () => document.querySelector<HTMLElement>('.pane.focus [role="tabpanel"]');
    await waitFor("il lettore è nel riquadro", () => !!content()?.querySelector(".media-surface"));
    // «Apri con un'altra app» sta fra le voci che si trovano scrivendo.
    content()!.querySelector<HTMLElement>(".media-surface")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    const menu = document.getElementById("context-menu");
    if (!menu) throw new Error("il menu contestuale non si è aperto");
    for (const key of "predefinita") menu.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    const system = () => [...menu.querySelectorAll("button")].find((b) => label(b) === "L'app predefinita del sistema");
    await waitFor("la ricerca trova l'app del sistema sotto «Apri con un'altra app»", () => !!system());
    system()!.click();
    await waitFor("il sistema apre il file", () => host.atGate("revealInSystem").length === 1);
    expect(host.atGate("revealInSystem")[0].args).toEqual(["suono.mp3", true]);
    const lend = await import("./lend");
    expect(lend.lentTo("suono.mp3")).toBeNull();
  });
});
