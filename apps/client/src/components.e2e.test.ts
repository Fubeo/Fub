// @vitest-environment happy-dom
//
// **Gli editor di un componente spento** (K2, T4), sulla shell vera.
//
// Con un componente spento il suo editor non si carica, e un suo file si apre
// nel riquadro «solo come file»: nome, peso, quale componente serve e il
// pulsante che lo accende. Acceso, il riquadro diventa l'editor senza riaprire
// niente. Il cablaggio è quello di `drawing.e2e.test.ts` — `main.ts` sulla
// scocca vera, contro l'host finto — con l'host che parte dallo stato «Solo
// note» dello scenario registrato dall'host vero.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeHost } from "./host/fake";

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

// pdf.js finto: due pagine che si rendono senza disegnare niente. Quante volte
// lo si importa dice se il lettore PDF è arrivato.
const pdfjs = vi.hoisted(() => ({ imports: 0 }));
vi.mock("pdfjs-dist/build/pdf.min.mjs", () => {
  pdfjs.imports += 1;
  const page = {
    getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
    render: () => ({ promise: Promise.resolve(), cancel: () => {} }),
    getTextContent: async () => ({ items: [] }),
  };
  return {
    version: "6.3.289",
    GlobalWorkerOptions: { workerSrc: "" },
    getDocument: () => ({
      promise: Promise.resolve({ numPages: 2, getPage: async () => page, destroy: async () => {} }),
      destroy: async () => {},
    }),
  };
});

const { createFakeHost } = await import("./host/fake");
const rawHtml = (await import("../index.html?raw")).default;

const BOARD = JSON.stringify({
  nodes: [{ id: "prima", type: "text", text: "prima", x: 0, y: 0, width: 10, height: 10 }],
  edges: [],
});
const PDF = "Libro.pdf";
const NOTES = `${PDF}.fubann`;
const ANNOTATIONS =
  '<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" fub:version="1" fub:annotates="Libro.pdf">\n  <title>Libro.pdf</title>\n</svg>\n';

function host(componentsStart: string): FakeHost {
  return createFakeHost({
    file: { "Benvenuto.md": "# Benvenuto\n", "lavagna.canvas": BOARD, [NOTES]: ANNOTATIONS },
    resources: { [PDF]: { bytes: new TextEncoder().encode("test"), mime: "application/pdf" } },
    draw: true,
    componentsStart,
  });
}

async function start(fake: FakeHost): Promise<FakeHost> {
  vi.resetModules();
  box.host = fake;
  const body = /<body[^>]*>([\s\S]*)<\/body>/.exec(rawHtml);
  if (!body) throw new Error("index.html non ha un body");
  document.body.innerHTML = body[1].replace(/<script[\s\S]*?<\/script>/g, "");
  const main = await import("./main");
  activeStop = await main.startup;
  await settle();
  return fake;
}

async function settle(rounds = 6): Promise<void> {
  for (let i = 0; i < rounds; i += 1) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

async function waitFor(thing: string, cond: () => boolean, within = 15_000): Promise<void> {
  const deadline = Date.now() + within;
  while (Date.now() < deadline) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`non è mai successo: ${thing}`);
}

async function open(doc: string): Promise<void> {
  const { openDocument } = await import("./panels/document");
  await openDocument(doc);
  await settle();
}

const focusedPane = () => document.querySelector<HTMLElement>(".pane.focus")!;
const fileOnly = () => focusedPane().querySelector<HTMLElement>(".document-surface-file-only");
const switchOn = () => fileOnly()?.querySelector<HTMLButtonElement>("[data-action='switch-on']") ?? null;
const pdfViewer = () => focusedPane().querySelector(".media-pdf");
const board = () => focusedPane().querySelector(".canvas-surface-host");

/// Il riquadro «solo come file» per `name`, con il componente che serve.
async function fileOnlyFor(name: string, component: string): Promise<void> {
  await waitFor(`${name} solo come file`, () => fileOnly()?.querySelector(".file-only-name")?.textContent === name);
  expect(fileOnly()!.querySelector(".file-only-note")!.textContent).toContain(component);
  expect(switchOn()!.textContent).toBe(`Accendi ${component}`);
}

beforeEach(() => {
  activeStop?.();
  activeStop = null;
  document.body.innerHTML = "";
  localStorage.clear();
  pdfjs.imports = 0;
  const original = HTMLCanvasElement.prototype.getContext;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement, ...args: unknown[]) {
    if (this.className === "pdf-canvas") return {} as CanvasRenderingContext2D;
    return (original as (...a: unknown[]) => RenderingContext | null).apply(this, args);
  } as typeof original);
});

describe("un file di un componente spento", () => {
  it("con «Solo note» PDF e lavagna si aprono solo come file, e «Accendi» li apre", async () => {
    const fake = await start(host("solo-note"));

    await open(PDF);
    await fileOnlyFor(PDF, "PDF");
    expect(fileOnly()!.querySelector(".file-only-size")!.textContent).toMatch(/\d/);
    expect(pdfjs.imports, "il lettore PDF non arriva").toBe(0);
    expect(fake.files()).not.toHaveProperty(`${PDF}.tmp`);

    switchOn()!.click();
    await waitFor("il PDF si apre", () => pdfViewer() !== null);
    expect(fileOnly()).toBeNull();
    expect(pdfjs.imports).toBe(1);
    expect(fake.atGate("componentsApply").map((call) => call.args)).toEqual([[{ azione: "accendi", id: "fub.pdf" }, true, "/vault"]]);

    await open("lavagna.canvas");
    await fileOnlyFor("lavagna.canvas", "Lavagna");
    switchOn()!.click();
    // Accendere la lavagna rimonta il vault (l'host lo chiude e lo riapre):
    // la scheda resta e diventa la lavagna.
    await waitFor("la lavagna si apre", () => board() !== null);
    expect(fileOnly()).toBeNull();
    expect(fake.files()["lavagna.canvas"]).toBe(BOARD);
  });

  it("le annotazioni di un PDF col lettore PDF spento chiedono il PDF, anche coi disegni accesi", async () => {
    await start(host("solo-note"));
    await open(NOTES);
    await fileOnlyFor(NOTES, "PDF");
    expect(pdfjs.imports).toBe(0);
  });

  it("acceso da fuori, il riquadro aperto diventa l'editor", async () => {
    const fake = await start(host("solo-note"));
    await open(PDF);
    await fileOnlyFor(PDF, "PDF");
    // La CLI, o un'altra finestra, accende il lettore PDF.
    fake.componentsFromOutside({ azione: "accendi", id: "fub.pdf" }, true);
    await waitFor("il PDF si apre", () => pdfViewer() !== null);
    expect(fileOnly()).toBeNull();
  });

  it("spento da fuori col file aperto e una modifica non salvata: la modifica si salva e la scheda resta", async () => {
    const fake = await start(host("tutto"));
    await open("lavagna.canvas");
    await waitFor("la lavagna si apre", () => board() !== null);
    // Un doppio clic sulla tela vuota aggiunge una scheda: una modifica che
    // il salvataggio automatico non ha ancora scritto.
    focusedPane().querySelector(".canvas-viewport")!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
    await settle();
    const { describeTab } = await import("./state/document-controller");
    const { activeTab } = await import("./state/layout");
    expect(describeTab(activeTab()!).dirty, "la modifica non è ancora sul disco").toBe(true);
    expect(fake.files()["lavagna.canvas"]).toBe(BOARD);

    // Le due scelte registrate che dallo stato «Tutto» arrivano a «Solo note»,
    // dove la lavagna è spenta: la seconda rimonta il vault.
    fake.componentsFromOutside({ azione: "profilo", nome: "studio" }, true);
    await settle();
    expect(board(), "con «Studio» la lavagna resta accesa").not.toBeNull();
    fake.componentsFromOutside({ azione: "profilo", nome: "solo-note" }, true);

    await fileOnlyFor("lavagna.canvas", "Lavagna");
    const saved = JSON.parse(fake.files()["lavagna.canvas"]!) as { nodes: unknown[] };
    expect(saved.nodes, "la scheda nuova è sul disco").toHaveLength(2);
    expect(activeTab()).toMatchObject({ k: "doc", doc: "lavagna.canvas" });
  });
});
