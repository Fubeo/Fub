// @vitest-environment happy-dom
//
// **Le proprietà della testata, fino al file** (T8), sulla shell vera contro
// l'host finto: un valore cambiato con l'editor del suo tipo arriva al disco
// come YAML che ogni programma legge, e una shell nuova che rilegge il file lo
// mostra. Il cablaggio è quello di `live.e2e.test.ts`.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeHost } from "./host/fake";
import { waiter } from "./test-wait";

vi.setConfig({ testTimeout: 20_000 });

const box = vi.hoisted(() => ({ host: null as FakeHost | null }));

let activeStop: (() => void) | null = null;

vi.mock("./host/ipc", () => {
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

vi.mock("./host/dialog", () => ({
  confirm: () => Promise.resolve(true),
  pickFolder: () => Promise.resolve("/vault"),
  pickFile: () => Promise.resolve(null),
}));

const { createFakeHost } = await import("./host/fake");
const rawHtml = (await import("../index.html?raw")).default;

const NOTE = "---\npagine: 12\nscadenza: 2026-03-02\n---\nIl testo della nota.\n";
const VAULT = { "Mostra.md": NOTE };

async function start(files: Record<string, string>): Promise<FakeHost> {
  vi.resetModules();
  const host = createFakeHost({ file: files });
  box.host = host;
  const body = /<body[^>]*>([\s\S]*)<\/body>/.exec(rawHtml);
  if (!body) throw new Error("index.html non ha un body");
  document.body.innerHTML = body[1].replace(/<script[\s\S]*?<\/script>/g, "");
  const main = await import("./main");
  activeStop = await main.startup;
  await settle();
  return host;
}

async function settle(rounds = 6): Promise<void> {
  for (let i = 0; i < rounds; i += 1) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

const waitFor = waiter(2000);

async function open(doc: string): Promise<void> {
  const { openDocument } = await import("./panels/document");
  await openDocument(doc);
  await settle();
  await waitFor("la testata si disegna", () => document.querySelector(".cm-fub-page-prop") !== null);
}

const value = (key: string) => document.querySelector<HTMLElement>(`.cm-fub-page-prop[data-key="${key}"] .cm-fub-page-prop-value`)!;

/// Ferma la shell. Prima il fuoco e la selezione lasciano i nodi che si
/// tolgono: happy-dom annuncerebbe la selezione alle viste nuove a metà di un
/// loro update.
function stopShell(): void {
  (document.activeElement as HTMLElement | null)?.blur();
  document.getSelection()?.removeAllRanges();
  activeStop?.();
  activeStop = null;
}

beforeEach(() => {
  stopShell();
  document.body.innerHTML = "";
  localStorage.clear();
});

describe("le proprietà della testata", () => {
  it("un numero e una data scritti con i loro editor arrivano al file, e il file riletto li mostra", async () => {
    const host = await start(VAULT);
    await open("Mostra.md");

    value("pagine").click();
    const input = document.querySelector<HTMLInputElement>(".cm-fub-page-prop[data-key=pagine] input")!;
    input.value = "40";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    value("scadenza").click();
    document.querySelector<HTMLElement>(".cm-fub-prop-popover [data-day='2026-03-12']")!.click();

    await waitFor("il salvataggio arriva al disco", () => host.files()["Mostra.md"] === "---\npagine: 40\nscadenza: 2026-03-12\n---\nIl testo della nota.\n");

    // Una shell nuova, sullo stesso disco: la nota riletta dice i valori nuovi.
    stopShell();
    await start(host.files());
    await open("Mostra.md");
    expect(value("pagine").textContent).toBe("40");
    expect(value("scadenza").textContent).toContain("12 marzo 2026");
  });
});

describe("un testo della testata, fino al file (IMP-3811)", () => {
  // La pratica della tester: otto proprietà, «stato» fra quelle nascoste
  // sotto «Altre N proprietà». Il valore si sostituisce tutto, poi Invio o
  // l'uscita dal campo: il file dice il valore nuovo.
  const PRATICA = "---\ncategoria: pratica\ncliente: Silvestri Consulenze sas\ntipologia: Certificazione unica\nscadenza: 2026-12-16\nstato: da fare\nore: 2\nfatta: false\ncollaboratrice: Serena Lombardi\n---\n## Passi\n\n- [ ] Raccogliere i documenti del cliente 📅 2026-12-16\n";
  const stato = () => document.querySelector<HTMLElement>('.cm-fub-page-prop[data-key="stato"] .cm-fub-page-prop-value');
  const edit = async (finish: (input: HTMLInputElement) => void): Promise<FakeHost> => {
    const host = await start({ "Pratica.md": PRATICA });
    await open("Pratica.md");
    document.querySelector<HTMLButtonElement>(".cm-fub-page-props-more")?.click();
    await waitFor("«stato» si vede", () => stato() !== null);
    stato()!.click();
    const input = document.querySelector<HTMLInputElement>(".cm-fub-page-prop[data-key=stato] input")!;
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart === 0 && input.selectionEnd === input.value.length).toBe(true);
    input.value = "in corso";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    finish(input);
    await waitFor("il salvataggio arriva al disco", () => host.files()["Pratica.md"] === PRATICA.replace("stato: da fare", "stato: in corso"));
    return host;
  };

  it("sostituito con Invio, il file dice il valore nuovo e la nota riaperta lo mostra", async () => {
    const host = await edit((input) => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
    stopShell();
    await start(host.files());
    await open("Pratica.md");
    document.querySelector<HTMLButtonElement>(".cm-fub-page-props-more")?.click();
    await waitFor("«stato» riletto", () => stato()?.textContent === "in corso");
  });

  it("sostituito e lasciato il campo, il file dice il valore nuovo", async () => {
    await edit((input) => input.blur());
  });
});

describe("la rinomina dal titolo, fino al file (revisione #421)", () => {
  it("rinominata la nota dalla testata, l'H1 riscritto arriva al file col nome nuovo, e il vecchio non c'è più", async () => {
    const host = await start({ "Mostra.md": "# Mostra\n\nIl testo della nota.\n" });
    const { openDocument } = await import("./panels/document");
    await openDocument("Mostra.md");
    await waitFor("il titolo si disegna", () => document.querySelector("input.cm-fub-page-title") !== null);
    const title = document.querySelector<HTMLInputElement>("input.cm-fub-page-title")!;
    title.focus();
    title.value = "Mostra d'estate";
    title.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));

    await waitFor("il file nuovo ha l'H1 nuovo", () => host.files()["Mostra d'estate.md"] === "# Mostra d'estate\n\nIl testo della nota.\n");
    expect(Object.keys(host.files())).not.toContain("Mostra.md");
    await settle();
    expect(host.files()["Mostra d'estate.md"]).toBe("# Mostra d'estate\n\nIl testo della nota.\n");
    expect(Object.keys(host.files())).not.toContain("Mostra.md");
  });
});
