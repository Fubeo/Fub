// @vitest-environment happy-dom
//
// **Il cassetto delle note** sulla shell vera contro l'host finto: il conto
// di ogni cartella, «Tutte le note N» sopra l'albero e il bottone che ordina.
//
// I numeri vengono dal kernel e non da ciò che è disegnato: una cartella dice
// le sue voci dirette anche chiusa (`VaultFolder.entries`), e il totale è
// quello di tutto ciò che si vede, a ogni profondità. Nessuno dei due entra nel
// nome di una riga o di un titolo per chi ascolta più di quanto serva.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeHost } from "../host/fake";
import type { SettingEntry } from "../host/contract";
import { waiter } from "../test-wait";

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

const BYTES = { bytes: new Uint8Array([0x7b, 0x7d]), mime: "application/octet-stream" };

/// Il vault di prova: quattro note e un'immagine, su tre cartelle.
const FILES: Record<string, string> = {
  "Benvenuto.md": "# Benvenuto\n",
  "Guida/Sintassi.md": "# Sintassi\n",
  "Guida/Tasti.md": "# Tasti\n",
  "Progetti/Banco.md": "# Banco\n",
  "Progetti/Archivio/Vecchio.md": "# Vecchio\n",
};
const RESOURCES = { "Guida/schema.png": BYTES };

async function settle(rounds = 6): Promise<void> {
  for (let i = 0; i < rounds; i += 1) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

async function quiet(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await settle();
}

const waitFor = waiter(3000);

interface Start {
  file?: Record<string, string>;
  resources?: Record<string, typeof BYTES>;
  settings?: SettingEntry[];
}

async function start(options: Start = {}): Promise<FakeHost> {
  vi.resetModules();
  const host: FakeHost = createFakeHost({
    file: options.file ?? FILES,
    resources: options.resources ?? RESOURCES,
    settings: options.settings ?? [],
  });
  box.host = host;
  const body = /<body[^>]*>([\s\S]*)<\/body>/.exec(rawHtml);
  if (!body) throw new Error("index.html non ha un body");
  document.body.innerHTML = body[1].replace(/<script[\s\S]*?<\/script>/g, "");
  const main = await import("../main");
  activeStop = await main.startup;
  await quiet();
  return host;
}

const row = (path: string) => document.querySelector<HTMLElement>(`#file-list li[data-path="${CSS.escape(path)}"] > .tree-row`);
const countOf = (path: string) => row(path)?.querySelector<HTMLElement>(":scope > .row-count") ?? null;
const allTitle = () => document.getElementById("all-title")!;
const allCount = () => document.getElementById("all-count")!;
/// Il nome accessibile di un `treeitem`: lo dà l'elemento che `aria-labelledby` indica.
const treeitemName = (path: string): string => {
  const li = document.querySelector<HTMLElement>(`#file-list li[data-path="${CSS.escape(path)}"]`)!;
  return document.getElementById(li.getAttribute("aria-labelledby")!)!.textContent ?? "";
};

beforeEach(() => {
  activeStop?.();
  activeStop = null;
  document.body.innerHTML = "";
  localStorage.clear();
});

afterEach(() => {
  activeStop?.();
  activeStop = null;
  document.querySelector(".context-menu")?.remove();
  vi.restoreAllMocks();
});

describe("i conti delle cartelle", () => {
  it("ogni cartella dice le sue voci dirette, fuori dal nome della riga", async () => {
    await start();
    // Guida: due note e un'immagine. Progetti: una nota e una cartella, che
    // non è una voce.
    expect(countOf("Guida")?.textContent).toBe("3");
    expect(countOf("Progetti")?.textContent).toBe("1");
    expect(countOf("Guida")!.getAttribute("aria-hidden")).toBe("true");
    expect(treeitemName("Guida")).toBe("Guida");
    // Il numero sta dopo il nome: un nome lungo si tronca lui, il numero resta.
    expect(countOf("Guida")!.previousElementSibling?.classList.contains("row-name")).toBe(true);
  });

  it("lo zero non si scrive: una cartella vuota non ha numero", async () => {
    const host = await start();
    await host.module.api.invokeCommand("folder.create", { path: "Vuota" });
    await waitFor("la cartella nuova nell'albero", () => row("Vuota") !== null);
    expect(countOf("Vuota")).toBeNull();
    // Una cartella con dentro soltanto un'altra cartella non ha voci dirette.
    await host.module.api.invokeCommand("folder.create", { path: "Solo cartelle/Dentro" });
    await waitFor("la cartella che ne contiene un'altra", () => row("Solo cartelle") !== null);
    expect(countOf("Solo cartelle")).toBeNull();
  });

  it("mille voci si scrivono come sono", async () => {
    const many = Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`Molte/voce-${String(i).padStart(4, "0")}.bin`, BYTES]));
    await start({ resources: many });
    expect(countOf("Molte")?.textContent).toBe("1000");
    expect(allCount().textContent).toBe(String(1000 + Object.keys(FILES).length));
  });
});

describe("«Tutte le note» sopra l'albero", () => {
  it("dice il totale del vault, a ogni profondità, e il titolo lo legge con il numero", async () => {
    await start();
    expect(allTitle().hidden).toBe(false);
    expect(allTitle().getAttribute("role")).toBe("heading");
    expect(allTitle().textContent?.replace(/\s+/g, " ").trim()).toBe("Tutte le note 6");
    expect(allCount().hidden).toBe(false);
    // Sta subito sopra l'albero.
    expect(allTitle().nextElementSibling?.id).toBe("file-list");
  });

  it("dentro uno spazio il totale è quello dello spazio", async () => {
    await start();
    const { setSpace } = await import("../state/organization");
    await setSpace("Progetti", true);
    await quiet();
    const chip = document.querySelector<HTMLButtonElement>('#space-strip .space-chip[aria-label="Progetti"]');
    expect(chip).not.toBeNull();
    chip!.click();
    await waitFor("lo spazio acceso", () => allCount().textContent === "2");
    // La striscia: un pozzetto con gli spazi, «+» fuori; il nome si vede
    // soltanto sull'acceso, e per chi ascolta resta l'etichetta.
    const lit = document.querySelector<HTMLButtonElement>('#space-strip > .space-well > .space-chip[aria-label="Progetti"]');
    expect(lit).not.toBeNull();
    expect(lit!.getAttribute("aria-pressed")).toBe("true");
    expect(lit!.querySelector(".space-chip-name")!.getAttribute("aria-hidden")).toBe("true");
    expect(lit!.querySelector(".space-chip-name")!.textContent).toBe("Progetti");
    expect(document.querySelector("#space-strip > .space-chip.add")).not.toBeNull();
  });

  it("col filtro aperto il titolo va con l'albero, e torna coi conti veri", async () => {
    await start();
    const input = document.querySelector<HTMLInputElement>(".explorer-filter input")!;
    input.value = "guida";
    input.dispatchEvent(new Event("input"));
    await waitFor("l'elenco filtrato", () => document.getElementById("file-list")!.hidden);
    expect(allTitle().hidden).toBe(true);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await waitFor("l'albero di nuovo", () => !document.getElementById("file-list")!.hidden);
    expect(allTitle().hidden).toBe(false);
    expect(allCount().textContent).toBe("6");
    expect(countOf("Guida")?.textContent).toBe("3");
  });

  it("un file nuovo scritto da fuori entra nell'albero e nel totale, senza riaprire (IMP-6501)", async () => {
    const host = await start();
    expect(allCount().textContent).toBe("6");
    // Il lotto del rilevatore, come lo consegna il ponte vero: il documento
    // nuovo e poi `index_updated` (fuori da un lotto non arriva `batch_ended`).
    host.writeFromOutside("Nuova fuori.md", "# Nuova fuori\n");
    host.emit({ type: "index_updated" });
    await waitFor("la riga nuova", () => row("Nuova fuori.md") !== null);
    expect(allCount().textContent).toBe("7");
    // Anche dentro una cartella aperta che ancora non c'era.
    host.writeFromOutside("Cartella fuori/Dentro.md", "# Dentro\n");
    host.emit({ type: "index_updated" });
    await waitFor("la cartella nuova", () => row("Cartella fuori") !== null);
    expect(allCount().textContent).toBe("8");
  });

  it("un vault senza note: il titolo c'è, il numero no", async () => {
    await start({ file: {}, resources: {} });
    await waitFor("l'albero vuoto", () => document.querySelector("#file-list .tree-empty") !== null);
    expect(allTitle().hidden).toBe(false);
    expect(allCount().hidden).toBe(true);
    expect(allCount().textContent).toBe("");
  });
});

describe("i tasti del mouse sulle righe", () => {
  /// Un clic vero: la pressione col suo tasto, poi il `click`. WebKitGTK manda
  /// il `click` anche dopo il centrale, col `button` del sinistro.
  const press = (target: HTMLElement, button: number): void => {
    target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button }));
    target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, button }));
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, detail: 1 }));
  };
  const expanded = (path: string) =>
    document.querySelector(`#file-list li[data-path="${CSS.escape(path)}"]`)!.getAttribute("aria-expanded");

  it("il tasto centrale non apre né chiude una cartella; il sinistro sì (IMP-002)", async () => {
    await start();
    expect(expanded("Guida")).toBe("false");
    press(row("Guida")!.querySelector<HTMLElement>(".row-name")!, 1);
    await quiet();
    expect(expanded("Guida")).toBe("false");
    press(row("Guida")!.querySelector<HTMLElement>(".row-name")!, 0);
    await waitFor("la cartella aperta", () => expanded("Guida") === "true");
    // Dopo un centrale, Invio sulla riga (un clic senza tasti) la chiude ancora.
    press(row("Guida")!.querySelector<HTMLElement>(".row-name")!, 1);
    row("Guida")!.click();
    await waitFor("la cartella chiusa", () => expanded("Guida") === "false");
  });
});

describe("il contestuale di una voce dell'albero", () => {
  /// Un contestuale con le coordinate di un puntatore, su `target`.
  const contextOn = (target: Element): void => {
    const box = target.getBoundingClientRect();
    target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: box.left + 10, clientY: box.top + 5 }));
  };
  const item = (path: string) => document.querySelector<HTMLElement>(`#file-list li[data-path="${CSS.escape(path)}"]`)!;
  const labels = (): string[] =>
    [...document.querySelectorAll<HTMLElement>('#context-menu [role="menuitem"]')].map((entry) => entry.querySelector(".menu-label")?.textContent ?? "");
  const choose = (label: string): void =>
    [...document.querySelectorAll<HTMLElement>('#context-menu [role="menuitem"]')].find((entry) => entry.querySelector(".menu-label")?.textContent === label)!.click();
  /// La cartella di ogni `note.create` chiesto al kernel.
  const createdIn = (host: FakeHost): unknown[] =>
    host.calls.filter((call) => call.gate === "invokeCommand" && call.args[0] === "note.create")
      .map((call) => (call.args[1] as Record<string, string> | undefined)?.folder);

  // Il contestuale che arriva sul `treeitem` e non sulla sua riga (il tasto
  // Menu della tastiera lo manda alla voce a fuoco, un clic sul margine della
  // voce pure) è quello della voce, non quello della radice (IMP-144).
  it("sulla voce di una cartella apre il menu della cartella, e «Nuova nota qui» nasce lì", async () => {
    const host = await start();
    contextOn(item("Guida"));
    await quiet();
    expect(labels()).toContain("Nuova nota qui");
    expect(labels()).not.toContain("Comprimi tutto");
    choose("Nuova nota qui");
    await waitFor("la nota nuova si chiede", () => createdIn(host).length === 1);
    expect(createdIn(host)).toEqual(["Guida"]);
  });

  it("sulla riga di una cartella, come col puntatore, la nota nasce nella cartella", async () => {
    const host = await start();
    contextOn(row("Progetti")!.querySelector(".row-name")!);
    await quiet();
    choose("Nuova nota qui");
    await waitFor("la nota nuova si chiede", () => createdIn(host).length === 1);
    expect(createdIn(host)).toEqual(["Progetti"]);
  });

  it("sulla voce di una nota apre il menu della nota, con «Sposta in…»", async () => {
    await start();
    contextOn(item("Benvenuto.md"));
    await quiet();
    expect(labels()).toContain("Sposta in…");
    expect(labels()).toContain("Rinomina");
    expect(labels()).not.toContain("Comprimi tutto");
  });

  it("sotto l'ultima voce resta il menu della radice", async () => {
    await start();
    document.getElementById("file-list")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
    await quiet();
    expect(labels()).toContain("Comprimi tutto");
    expect(labels()).not.toContain("Nuova nota qui");
  });
});

describe("le appuntate", () => {
  it("una nota appuntata dal menu compare subito fra le appuntate (IMP-009)", async () => {
    await start();
    const pinnedList = document.getElementById("pinned-list")!;
    expect(pinnedList.hidden).toBe(true);
    const { setPinned } = await import("../state/organization");
    await setPinned("Benvenuto.md", true);
    await waitFor("l'appuntata nella lista", () => pinnedList.querySelector('.tree-row[data-path="Benvenuto.md"]') !== null);
    expect(pinnedList.hidden).toBe(false);
    expect(document.getElementById("pinned-title")!.hidden).toBe(false);
  });

  it("una nota appuntata e rinominata resta fra le appuntate, col nome nuovo", async () => {
    await start();
    const pinnedRow = (path: string) =>
      document.querySelector<HTMLElement>(`#pinned-list .tree-row[data-path="${CSS.escape(path)}"]`);
    const { setPinned } = await import("../state/organization");
    const { renameNote } = await import("../state/vault");
    await setPinned("Benvenuto.md", true);
    await waitFor("l'appuntata nella lista", () => pinnedRow("Benvenuto.md") !== null);

    await renameNote("Benvenuto.md", "Ingresso.md");

    await waitFor("l'appuntata col nome nuovo", () => pinnedRow("Ingresso.md") !== null);
    expect(pinnedRow("Benvenuto.md")).toBeNull();
    expect(document.getElementById("pinned-list")!.hidden).toBe(false);
  });
});

describe("le azioni del titolo", () => {
  it("«nuovo» è una figura col suo nome, che apre un menu", async () => {
    await start();
    const button = document.getElementById("new-note")!;
    expect(button.classList.contains("icon-button")).toBe(true);
    expect(button.querySelector("svg")).not.toBeNull();
    expect(button.getAttribute("aria-label")).toBe("Crea un file nuovo");
    expect(button.getAttribute("aria-haspopup")).toBe("menu");
    expect(button.textContent?.trim()).toBe("");
  });

  it("il «+» apre «Nuovo» sotto di sé dalla tastiera, col fuoco sulla Nota, ed Esc torna al «+»", async () => {
    await start();
    const button = document.getElementById("new-note") as HTMLButtonElement;
    const items = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('#context-menu [role="menuitem"]')];
    // Invio e Spazio su un pulsante sono un clic senza puntatore (detail 0).
    button.focus();
    button.click();
    expect(button.getAttribute("aria-expanded")).toBe("true");
    const menu = document.getElementById("context-menu")!;
    expect(menu.getAttribute("aria-label")).toBe("Nuovo");
    const names = items().map((item) => item.querySelector(".menu-label")?.textContent ?? item.textContent);
    expect(names[0]).toBe("Nota");
    expect(names[names.length - 1]).toBe("Cartella");
    expect(items()[0]!.getAttribute("aria-keyshortcuts")).not.toBeNull();
    expect(document.activeElement).toBe(items()[0]);
    document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await quiet();
    expect(document.getElementById("context-menu")).toBeNull();
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(button);
  });

  it("«Cartella» del «+» apre il campo del nome in cima all'albero", async () => {
    await start();
    document.getElementById("new-note")!.click();
    const folder = [...document.querySelectorAll<HTMLElement>('#context-menu [role="menuitem"]')].find((item) => item.textContent?.includes("Cartella"))!;
    folder.click();
    await quiet();
    expect(document.getElementById("context-menu")).toBeNull();
    const field = document.querySelector<HTMLInputElement>("#file-list > input.new-folder");
    expect(field).not.toBeNull();
    expect(document.activeElement).toBe(field);
  });

  it("il «+» è un interruttore: il secondo clic chiude il menu e lo dice", async () => {
    await start();
    const button = document.getElementById("new-note") as HTMLButtonElement;
    button.click();
    expect(document.getElementById("context-menu")).not.toBeNull();
    expect(button.getAttribute("aria-expanded")).toBe("true");
    button.click();
    await quiet();
    expect(document.getElementById("context-menu")).toBeNull();
    expect(button.getAttribute("aria-expanded")).toBe("false");
    // E il terzo lo riapre.
    button.click();
    expect(document.getElementById("context-menu")).not.toBeNull();
    expect(button.getAttribute("aria-expanded")).toBe("true");
  });

  it("anche «Ordina» è un interruttore", async () => {
    await start();
    const sort = document.getElementById("explorer-sort") as HTMLButtonElement;
    sort.click();
    expect(sort.getAttribute("aria-expanded")).toBe("true");
    sort.click();
    await quiet();
    expect(document.getElementById("context-menu")).toBeNull();
    expect(sort.getAttribute("aria-expanded")).toBe("false");
  });

  it("«Nota» del «+» nasce dove nasce Ctrl+N: con «./» accanto alla nota aperta, anche dentro uno spazio", async () => {
    const host = await start({
      settings: [{
        spec: {
          key: "files.new-note-folder",
          label: "Cartella delle nuove note",
          description: "",
          group: "",
          scope: "vault",
          kind: { kind: "text", default: "" },
          program_writable: false,
        },
        value: "./",
        source: "vault",
      } as SettingEntry],
    });
    const { state } = await import("../state/store");
    const { openDocument } = await import("../state/document-controller");
    const registry = await import("../ui/commands");
    // Uno spazio vero: una cartella che non è fra gli spazi non resta attiva.
    state.meta.spaces = [...state.meta.spaces, "Progetti"];
    state.activeSpace = "Progetti";
    const opened = "Progetti/Archivio/Vecchio.md";

    /// Gli argomenti di ogni `note.create` chiesto al kernel.
    const creations = (): unknown[] =>
      host.calls.filter((call) => call.gate === "invokeCommand" && call.args[0] === "note.create").map((call) => call.args[1]);

    /// Apre la nota, fa partire `create` e restituisce la cartella chiesta al
    /// kernel per la nota nuova (il finto la crea sempre alla radice).
    async function bornFrom(create: () => void): Promise<unknown> {
      await openDocument(opened);
      await quiet();
      expect(state.currentDoc).toBe(opened);
      expect(state.activeSpace).toBe("Progetti");
      const before = creations().length;
      create();
      await waitFor("la nota nuova si chiede", () => creations().length > before);
      const all = creations();
      return (all[all.length - 1] as Record<string, string> | undefined)?.folder;
    }

    const byKeys = await bornFrom(() => void registry.allCommands().find((entry) => entry.id === "shell.note.new")!.run!());
    expect(byKeys).toBe("Progetti/Archivio");
    const byMenu = await bornFrom(() => {
      document.getElementById("new-note")!.click();
      [...document.querySelectorAll<HTMLElement>('#context-menu [role="menuitem"]')].find((item) => item.querySelector(".menu-label")?.textContent === "Nota")!.click();
    });
    expect(byMenu).toBe(byKeys);
  });

  it("«Nuovo ▸ Cartella» col pannello su Cerca e chiuso riporta l'albero e ci mette il campo", async () => {
    await start();
    const { showPanel } = await import("./sidebar");
    const panels = await import("../ui/side-panels");
    showPanel("search");
    if (panels.sidePanelVisible("sidebar")) panels.toggleSidePanel("sidebar");
    expect(panels.sidePanelVisible("sidebar")).toBe(false);
    expect(document.getElementById("files-panel")!.hidden).toBe(true);
    const registry = await import("../ui/commands");
    // È la voce del menu File: lo stesso elenco, senza cartella scelta.
    registry.newEntries().find((entry) => entry.kind === "folder")!.run();
    await quiet();
    expect(panels.sidePanelVisible("sidebar")).toBe(true);
    expect(document.getElementById("files-panel")!.hidden).toBe(false);
    const field = document.querySelector<HTMLInputElement>("#file-list > input.new-folder");
    expect(field).not.toBeNull();
    expect(document.activeElement).toBe(field);
  });

  it("«ordina» apre le stesse scelte del contestuale e cambia l'ordine dell'albero", async () => {
    await start();
    const { state } = await import("../state/store");
    const sort = document.getElementById("explorer-sort")!;
    expect(sort.getAttribute("aria-haspopup")).toBe("menu");
    expect(sort.getAttribute("aria-label")).toBe("Ordina");
    expect(sort.querySelector("svg")).not.toBeNull();
    expect(state.explorerSort).toBe("manual");

    sort.click();
    expect(sort.getAttribute("aria-expanded")).toBe("true");
    const radios = [...document.querySelectorAll<HTMLElement>('.context-menu [role="menuitemradio"]')];
    expect(radios.map((r) => r.textContent?.replace("✓", "").trim())).toEqual([
      "Ordine a mano",
      "Nome (A–Z)",
      "Nome (Z–A)",
      expect.any(String),
      expect.any(String),
    ]);
    expect(radios[0]!.getAttribute("aria-checked")).toBe("true");

    radios[2]!.click();
    await quiet();
    expect(state.explorerSort).toBe("name-desc");
    expect(sort.getAttribute("aria-expanded")).toBe("false");
    // L'albero segue: le cartelle in ordine inverso.
    const top = [...document.querySelectorAll<HTMLElement>("#file-list > li[data-path]")].map((li) => li.dataset.path);
    expect(top.indexOf("Progetti")).toBeLessThan(top.indexOf("Guida"));

    // Il secondo clic sul pulsante chiude il menu che il primo ha aperto
    // (IMP-006), e lo stato dice ciò che si vede.
    sort.click();
    await quiet();
    expect(document.querySelectorAll('.context-menu [role="menuitemradio"]').length).toBe(5);
    expect(sort.getAttribute("aria-expanded")).toBe("true");
    sort.click();
    await quiet();
    expect(document.querySelectorAll('.context-menu [role="menuitemradio"]').length).toBe(0);
    expect(sort.getAttribute("aria-expanded")).toBe("false");
    sort.click();
    await quiet();
    expect(sort.getAttribute("aria-expanded")).toBe("true");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await quiet();

    // Il contestuale della radice ha le stesse voci, con la scelta nuova.
    document.getElementById("files-title")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
    await quiet();
    const submenu = [...document.querySelectorAll<HTMLElement>('.context-menu [role="menuitem"]')].find((b) => b.textContent?.includes("Ordina"));
    expect(submenu).toBeDefined();
  });
});

describe("«Sposta in…» con molte note scelte", () => {
  /// Più schede di quante ne arrivavano (14 su 60, IMP-3804) alla radice, e la
  /// cartella che le aspetta.
  const NAMES = Array.from({ length: 24 }, (_, i) => `Cliente ${String(i + 1).padStart(2, "0")}.md`);
  const many = (): Record<string, string> => {
    const files: Record<string, string> = { "Clienti/Indice.md": "# Indice\n" };
    for (const name of NAMES) files[name] = `# ${name}\n`;
    return files;
  };
  const ctrlClick = (path: string): void => {
    row(path)!.querySelector<HTMLElement>(".row-name")!.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ctrlKey: true, detail: 1 }),
    );
  };
  const picker = () => document.querySelector<HTMLInputElement>('.shell-dialog input[role="combobox"]');
  /// Gli avvisi detti finora, dal più vecchio.
  const notices = async (): Promise<string[]> => (await import("../ui/notify")).recentNotices().map((n) => n.text).reverse();

  async function moveAllInto(folder: string): Promise<void> {
    for (const name of NAMES) ctrlClick(name);
    await quiet();
    expect(document.querySelector(".tree-selection-count")!.textContent).toContain("24");
    document.querySelector<HTMLElement>(".tree-selection-move")!.click();
    await waitFor("il selettore della cartella", () => picker() !== null);
    picker()!.value = folder;
    picker()!.dispatchEvent(new Event("input"));
    picker()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  }

  it("le sposta tutte, e alla fine lo dice una volta", async () => {
    const host = await start({ file: many(), resources: {} });
    await moveAllInto("Clienti");
    await waitFor("il racconto finale", () => document.body.textContent!.includes("24 note spostate in Clienti"), 15_000);
    expect(NAMES.filter((name) => !(`Clienti/${name}` in host.files()))).toEqual([]);
    expect(Object.keys(host.files()).filter((path) => !path.includes("/"))).toEqual([]);
    const said = await notices();
    expect(said.filter((text) => text.startsWith("Sposto 24 note"))).toHaveLength(1);
    expect(said.filter((text) => text.includes("note spostate"))).toEqual(["24 note spostate in Clienti"]);
  });

  it("una nota che non si sposta resta dov'è, intera, e si dice col suo nome", async () => {
    const files = many();
    // La destinazione di una è già occupata: quella non può arrivare.
    files["Clienti/Cliente 07.md"] = "# Un'altra scheda\n";
    const host = await start({ file: files, resources: {} });
    await moveAllInto("Clienti");
    await waitFor("il racconto finale", () => document.body.textContent!.includes("23 note su 24 spostate in Clienti"), 15_000);
    expect(host.files()["Cliente 07.md"]).toBe("# Cliente 07.md\n");
    expect(host.files()["Clienti/Cliente 07.md"]).toBe("# Un'altra scheda\n");
    expect(NAMES.filter((name) => name !== "Cliente 07.md" && !(`Clienti/${name}` in host.files()))).toEqual([]);
    const said = await notices();
    expect(said.filter((text) => text.startsWith("Non riesco a spostare"))).toEqual([
      expect.stringContaining("Non riesco a spostare Cliente 07.md in Clienti:"),
    ]);
  });
});

describe("la scelta dopo uno spostamento (IMP-1803)", () => {
  /// Il vault della tester: quattordici progetti alla radice, la cartella
  /// Progetti che ha già una nota, e una nota sola da archiviare.
  const PROJECTS = Array.from({ length: 14 }, (_, i) => `Progetto ${String(i + 1).padStart(2, "0")}.md`);
  const vault = (): Record<string, string> => {
    const files: Record<string, string> = { "Progetti/Magazzino ricambi 2025.md": "# Magazzino\n", "Home.md": "# Home\n" };
    for (const name of PROJECTS) files[name] = `# ${name}\n`;
    return files;
  };
  const clickRow = (path: string, init: MouseEventInit = {}): void => {
    row(path)!.querySelector<HTMLElement>(".row-name")!.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, detail: 1, ...init }),
    );
  };
  const picker = () => document.querySelector<HTMLInputElement>('.shell-dialog input[role="combobox"]');
  const prompt = () => document.querySelector<HTMLInputElement>('.shell-dialog input[type="text"]');
  const count = () => document.querySelector<HTMLElement>(".tree-selection-count")!;
  const bar = () => document.querySelector<HTMLElement>(".tree-selection")!;

  async function moveVia(folder: string): Promise<void> {
    document.querySelector<HTMLElement>(".tree-selection-move")!.click();
    await waitFor("il selettore della cartella", () => picker() !== null);
    picker()!.value = folder;
    picker()!.dispatchEvent(new Event("input"));
    picker()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  }

  async function groupVia(name: string, where = "Nuova cartella in Progetti"): Promise<void> {
    document.querySelector<HTMLElement>(".tree-selection-group")!.click();
    await waitFor("il nome della cartella nuova", () => prompt() !== null);
    expect(prompt()!.closest("label")!.textContent, "il dialogo dice dove nasce la cartella").toBe(where);
    prompt()!.value = name;
    prompt()!.form!.requestSubmit();
  }

  /// Ciò che la tester ha fatto: clic sulla nota (la apre), Ctrl-clic (la sceglie).
  async function pickAlone(path: string): Promise<void> {
    await waitFor(`la riga di ${path}`, () => row(path) !== null);
    clickRow(path);
    await quiet();
    clickRow(path, { ctrlKey: true });
    await quiet();
  }

  it("dopo «Sposta in…» la cartella nuova nasce accanto alla nota scelta e prende solo lei", async () => {
    const host = await start({ file: vault(), resources: {} });
    for (const name of PROJECTS) clickRow(name, { ctrlKey: true });
    await quiet();
    expect(count().textContent).toBe("14 scelte");
    await moveVia("Progetti");
    await waitFor("il racconto finale", () => document.body.textContent!.includes("14 note spostate in Progetti"), 15_000);
    await quiet();
    expect(bar().hidden, "le note spostate non restano scelte").toBe(true);

    await pickAlone("Progetti/Magazzino ricambi 2025.md");
    expect(count().textContent).toBe("1 scelte");
    await groupVia("Archivio");
    await waitFor("la nota nella cartella nuova", () => "Progetti/Archivio/Magazzino ricambi 2025.md" in host.files());
    await quiet();
    const files = host.files();
    expect(Object.keys(files).filter((path) => path.startsWith("Progetti/Archivio/"))).toEqual(["Progetti/Archivio/Magazzino ricambi 2025.md"]);
    expect(PROJECTS.filter((name) => !(`Progetti/${name}` in files)), "i progetti restano dove li ha messi il primo spostamento").toEqual([]);
  });

  it("uno spostamento lento non cancella la scelta fatta mentre va, e non la mescola con la sua", async () => {
    const host = await start({ file: vault(), resources: {} });
    // Progetti aperta: la nota da archiviare si vede mentre i progetti viaggiano.
    clickRow("Progetti");
    await quiet();
    for (const name of PROJECTS) clickRow(name, { ctrlKey: true });
    await quiet();
    const release = host.throttle("invokeCommand");
    await moveVia("Progetti");
    await waitFor("lo spostamento è partito", () => host.atGate("invokeCommand").length > 0);
    await quiet();
    // Il comando ha preso le sue note: la barra non le offre a un secondo gesto.
    expect(bar().hidden, "le note in viaggio non restano nella scelta").toBe(true);

    await pickAlone("Progetti/Magazzino ricambi 2025.md");
    expect(count().textContent).toBe("1 scelte");
    release();
    await waitFor("il racconto finale", () => document.body.textContent!.includes("14 note spostate in Progetti"), 15_000);
    await quiet();
    expect(bar().hidden, "la scelta nuova sopravvive alla fine del primo spostamento").toBe(false);
    expect(count().textContent).toBe("1 scelte");

    await groupVia("Archivio");
    await waitFor("la nota nella cartella nuova", () => "Progetti/Archivio/Magazzino ricambi 2025.md" in host.files());
    await quiet();
    const files = host.files();
    expect(Object.keys(files).filter((path) => path.startsWith("Progetti/Archivio/"))).toEqual(["Progetti/Archivio/Magazzino ricambi 2025.md"]);
    expect(PROJECTS.filter((name) => !(`Progetti/${name}` in files))).toEqual([]);
  });

  it("la scelta non tiene percorsi spariti: spostata, rinominata o cestinata, una nota ne esce subito", async () => {
    const host = await start({ file: vault(), resources: {} });
    const [moved, renamed, trashed, kept] = PROJECTS as [string, string, string, string];
    for (const name of [moved, renamed, trashed, kept]) clickRow(name, { ctrlKey: true });
    await quiet();
    expect(count().textContent).toBe("4 scelte");

    // Spostata e rinominata da un altro programma: la scelta lo sa quando il
    // kernel lo dice, prima che l'albero si ridisegni.
    host.renameFromOutside(moved, `Progetti/${moved}`);
    expect(count().textContent, "spostata").toBe("3 scelte");
    host.renameFromOutside(renamed, "Nome nuovo.md");
    expect(count().textContent, "rinominata").toBe("2 scelte");
    await quiet();

    // Cestinata con Canc dalla sua riga: il gesto di una nota sola.
    const li = document.querySelector<HTMLElement>(`#file-list li[data-path="${CSS.escape(trashed)}"]`)!;
    li.focus();
    li.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true }));
    await waitFor("la nota nel cestino", () => !(trashed in host.files()));
    await quiet();

    expect(count().textContent).toBe("1 scelte");
    // Ciò che resta nella scelta esiste: «Sposta in…» porta solo quella.
    await moveVia("Progetti");
    await waitFor("la nota rimasta scelta in Progetti", () => `Progetti/${kept}` in host.files());
    await quiet();
    const files = host.files();
    expect(files["Nome nuovo.md"], "la rinominata resta dov'è").toBeDefined();
    expect(files[`Progetti/${moved}`]).toBeDefined();
    expect(Object.keys(files).filter((path) => path.startsWith("Progetti/Progetti/")), "niente si sposta due volte").toEqual([]);
  });
});

describe("F2 mette il nome dove lo mette il titolo (IMP-2800)", () => {
  /// Rinomina con F2 la voce `path` (dentro una cartella aperta) in `typed`.
  const renameWithF2 = async (path: string, typed: string): Promise<void> => {
    const li = document.querySelector<HTMLElement>(`#file-list li[data-path="${CSS.escape(path)}"]`)!;
    li.focus();
    li.dispatchEvent(new KeyboardEvent("keydown", { key: "F2", bubbles: true, cancelable: true }));
    const input = row(path)!.querySelector<HTMLInputElement>("input")!;
    input.value = typed;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  };
  const open = async (folder: string): Promise<void> => {
    row(folder)!.click();
    await waitFor(`${folder} aperta`, () => row(`${folder}/Sintassi.md`) !== null || row(`${folder}/Banco.md`) !== null);
  };

  it("la cartella scritta in testa è quella di partenza, non una dentro", async () => {
    const host = await start();
    await open("Guida");
    await renameWithF2("Guida/Sintassi.md", "Guida/Regole");
    await waitFor("la nota rinominata in Guida", () => "Guida/Regole.md" in host.files());
    expect(Object.keys(host.files()).filter((path) => path.startsWith("Guida/Guida/"))).toEqual([]);
  });

  it("uno «/» in testa parte dalla radice", async () => {
    const host = await start();
    await open("Progetti");
    await renameWithF2("Progetti/Banco.md", "/Banco radice");
    await waitFor("la nota alla radice", () => "Banco radice.md" in host.files());
  });
});

describe("Invio durante la composizione (IME) non conferma i campi dell'albero", () => {
  const enter = (field: HTMLElement, init: KeyboardEventInit = {}) =>
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, ...init }));

  it("la cartella nuova aspetta la fine della composizione", async () => {
    const host = await start();
    const registry = await import("../ui/commands");
    registry.newEntries().find((entry) => entry.kind === "folder")!.run();
    await quiet();
    const field = document.querySelector<HTMLInputElement>("#file-list > input.new-folder")!;
    field.value = "日本";
    enter(field, { isComposing: true });
    // WebKit chiude la composizione prima del keydown di Invio, che arriva col
    // codice 229 e `isComposing` falso.
    enter(field, { keyCode: 229 });
    await quiet();
    expect(field.isConnected).toBe(true);
    expect(field.disabled).toBe(false);
    expect(Object.keys(host.files()).some((path) => path.startsWith("日本"))).toBe(false);

    enter(field);
    await waitFor("il campo chiuso dopo l'Invio vero", () => !field.isConnected);
  });

  it("la rinomina in posto aspetta la fine della composizione", async () => {
    const host = await start();
    const li = document.querySelector<HTMLElement>('#file-list li[data-path="Benvenuto.md"]')!;
    li.focus();
    li.dispatchEvent(new KeyboardEvent("keydown", { key: "F2", bubbles: true, cancelable: true }));
    const input = row("Benvenuto.md")!.querySelector<HTMLInputElement>("input")!;
    expect(input).not.toBeNull();
    input.value = "日本語";
    enter(input, { isComposing: true });
    enter(input, { keyCode: 229 });
    await quiet();
    expect(input.isConnected).toBe(true);
    expect(input.disabled).toBe(false);
    expect("Benvenuto.md" in host.files()).toBe(true);

    enter(input);
    await waitFor("la nota rinominata", () => "日本語.md" in host.files());
  });
});
