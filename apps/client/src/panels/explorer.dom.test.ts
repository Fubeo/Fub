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

async function waitFor(thing: string, cond: () => boolean, within = 3000): Promise<void> {
  const deadline = Date.now() + within;
  while (Date.now() < deadline) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`non è mai successo: ${thing}`);
}

interface Start {
  file?: Record<string, string>;
  resources?: Record<string, typeof BYTES>;
}

async function start(options: Start = {}): Promise<FakeHost> {
  vi.resetModules();
  const host: FakeHost = createFakeHost({
    file: options.file ?? FILES,
    resources: options.resources ?? RESOURCES,
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

  it("un vault senza note: il titolo c'è, il numero no", async () => {
    await start({ file: {}, resources: {} });
    await waitFor("l'albero vuoto", () => document.querySelector("#file-list .tree-empty") !== null);
    expect(allTitle().hidden).toBe(false);
    expect(allCount().hidden).toBe(true);
    expect(allCount().textContent).toBe("");
  });
});

describe("le azioni del titolo", () => {
  it("«nuova nota» è una figura col suo nome", async () => {
    await start();
    const button = document.getElementById("new-note")!;
    expect(button.classList.contains("icon-button")).toBe(true);
    expect(button.querySelector("svg")).not.toBeNull();
    expect(button.getAttribute("aria-label")).toBe("Crea una nota nuova");
    expect(button.textContent?.trim()).toBe("");
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

    // Il contestuale della radice ha le stesse voci, con la scelta nuova.
    document.getElementById("files-title")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
    await quiet();
    const submenu = [...document.querySelectorAll<HTMLElement>('.context-menu [role="menuitem"]')].find((b) => b.textContent?.includes("Ordina"));
    expect(submenu).toBeDefined();
  });
});
