// @vitest-environment happy-dom
//
// **Le annotazioni di un PDF nella shell**, sulla shell vera.
//
// Con la feature `draw` dell'host il visore del PDF offre «Annota», che è il
// comando `pdf.annotate` del kernel: la prima volta crea `X.pdf.fubann` accanto
// al PDF e lo apre, dopo lo apre soltanto. Il file si apre sul profilo `pdf`
// della famiglia `canvas`, con le pagine del PDF sotto: il primo gesto scrive
// il gruppo della pagina e il legame con la versione del PDF. pdf.js è finto,
// tutto il resto è quello di `drawing.e2e.test.ts`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandSpec } from "./host/contract";
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

// pdf.js finto, della versione che la shell vuole: due pagine di 600 × 800
// punti che si rendono senza disegnare niente.
vi.mock("pdfjs-dist/build/pdf.min.mjs", () => {
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

/// `sha256("test")`: i byte del PDF finto sono «test».
const DIGEST = "sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
const PDF = "bandi/Bando di gara.pdf";
const NOTES = `${PDF}.fubann`;

/// La spec di `pdf.annotate` come la dichiara la feature `draw`.
const ANNOTATE: CommandSpec = {
  id: "pdf.annotate",
  title: "Annota il PDF",
  description: "",
  keybinding: null,
  params: [{ name: "pdf", title: "PDF", description: "", kind: { kind: "document" }, required: true }] as never,
  scope: { writes: true, reach: "document", reversible: true },
  surfaces: [],
};

/// La spec di `export.run` come la dichiarano i trasferimenti del kernel.
const EXPORT_RUN: CommandSpec = {
  id: "export.run",
  title: "Export documents",
  description: "",
  keybinding: null,
  params: [{ name: "request_json", title: "ExportRequest JSON", description: "", kind: { kind: "text" }, required: true }] as never,
  scope: { writes: false, reach: "session", reversible: true },
  surfaces: [],
};

async function start(draw = true): Promise<FakeHost> {
  vi.resetModules();
  const host = createFakeHost({
    file: { "Benvenuto.md": "# Benvenuto\n" },
    resources: { [PDF]: { bytes: new TextEncoder().encode("test"), mime: "application/pdf" } },
    draw,
    commands: draw ? [ANNOTATE, EXPORT_RUN] : [],
  });
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

async function waitFor(thing: string, cond: () => boolean, within = 3000): Promise<void> {
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
const annotateButton = () => focusedPane().querySelector<HTMLButtonElement>(".media-pdf-annotate");

const written = (host: FakeHost, doc: string): string[] =>
  host.atGate("writeDocument").filter((call) => call.args[0] === doc).map((call) => String(call.args[1]));

let clock = 100;

function highlight(): void {
  const sheet = focusedPane().querySelector<HTMLElement>(".draw-surface")!;
  const event = (type: string, x: number, y: number, buttons: number): PointerEvent => {
    const e = new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true, isPrimary: true, pointerId: 1, pointerType: "mouse",
      button: type === "pointermove" ? -1 : 0, buttons, pressure: buttons ? 0.5 : 0, clientX: x, clientY: y,
    });
    Object.defineProperty(e, "timeStamp", { value: (clock += 8) });
    return e;
  };
  sheet.dispatchEvent(event("pointerdown", 20, 20, 1));
  sheet.dispatchEvent(event("pointermove", 80, 20, 1));
  sheet.dispatchEvent(event("pointerup", 140, 22, 0));
}

beforeEach(() => {
  activeStop?.();
  activeStop = null;
  document.body.innerHTML = "";
  localStorage.clear();
  // Le pagine sotto le annotazioni hanno un contesto, che pdf.js finto non
  // usa; gli altri canvas restano quelli di happy-dom.
  const original = HTMLCanvasElement.prototype.getContext;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement, ...args: unknown[]) {
    if (this.className === "pdf-canvas") return {} as CanvasRenderingContext2D;
    return (original as (...a: unknown[]) => RenderingContext | null).apply(this, args);
  } as typeof original);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("«Annota» dal visore del PDF", () => {
  it("crea le annotazioni accanto al PDF e le apre sul profilo pdf; il primo gesto scrive pagina e legame", async () => {
    const host = await start();
    await open(PDF);
    await waitFor("il visore offre «Annota»", () => annotateButton() !== null);
    expect(annotateButton()!.textContent).toBe("Annota");
    annotateButton()!.click();
    await waitFor("le annotazioni si aprono", () => focusedPane().querySelector(".pdf-surface .draw-editor") !== null);
    expect(host.atGate("invokeCommand").map((call) => call.args)).toEqual([["pdf.annotate", { pdf: PDF }, "apply"]]);
    expect(host.files()[NOTES]).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" fub:version="1" fub:annotates="Bando%20di%20gara.pdf">\n  <title>Bando di gara.pdf</title>\n</svg>\n',
    );
    expect(focusedPane().dataset.mode).toBe("draw");
    await waitFor("il PDF è letto", () => focusedPane().querySelector(".pdf-page-count")?.textContent === "di 2");
    await waitFor("la pagina è disegnata", () => focusedPane().querySelector(".pdf-canvas") !== null);
    // Aprire non scrive.
    expect(written(host, NOTES)).toEqual([]);
    highlight();
    await waitFor("il gesto arriva al disco", () => written(host, NOTES).length === 1);
    const [saved] = written(host, NOTES);
    expect(saved).toContain(`fub:digest="${DIGEST}" fub:pages="2"`);
    expect(saved).toContain('<g id="p0001" fub:page="1" fub:page-size="600 800">');
    expect(saved).toContain('fub:tool="highlighter"');
  });

  it("la seconda volta apre soltanto, e la Lettura elenca le annotazioni", async () => {
    const host = await start();
    await open(PDF);
    await waitFor("il visore offre «Annota»", () => annotateButton() !== null);
    annotateButton()!.click();
    await waitFor("le annotazioni si aprono", () => focusedPane().querySelector(".pdf-surface") !== null);
    const created = host.files()[NOTES];
    expect(created).toContain('fub:annotates="Bando%20di%20gara.pdf"');
    await open(PDF);
    await waitFor("il visore offre «Annota»", () => annotateButton() !== null);
    annotateButton()!.click();
    await waitFor("le annotazioni si riaprono", () => focusedPane().querySelector(".pdf-surface") !== null);
    expect(host.files()[NOTES]).toBe(created);
    (document.activeElement ?? document.body).dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "e", ctrlKey: true }),
    );
    await settle();
    expect(focusedPane().dataset.mode).toBe("read");
    expect(focusedPane().querySelector<HTMLElement>(".pdf-list")!.hidden).toBe(false);
    expect(focusedPane().querySelector(".pdf-list p")!.textContent).toBe("Ancora nessuna annotazione.");
  });

  it("senza la feature `draw` il visore non offre «Annota»", async () => {
    await start(false);
    await open(PDF);
    await waitFor("il visore si monta", () => focusedPane().querySelector(".media-pdf-toolbar") !== null);
    expect(annotateButton()).toBeNull();
  });
});

describe("«Esporta…» sulle annotazioni", () => {
  it("offre il PDF annotato e quello redatto, col nome del file nella lingua di chi esporta", async () => {
    const host = await start();
    const { t } = await import("./i18n/strings");
    await open(PDF);
    await waitFor("il visore offre «Annota»", () => annotateButton() !== null);
    annotateButton()!.click();
    await waitFor("le annotazioni si aprono", () => focusedPane().querySelector(".pdf-surface .draw-editor") !== null);
    await waitFor("il PDF è letto", () => focusedPane().querySelector(".pdf-page-count")?.textContent === "di 2");
    const { allCommands } = await import("./ui/commands");
    const entry = allCommands().find((candidate) => candidate.id === "shell.doc.export");
    expect(entry).toBeDefined();
    void entry!.run?.();
    const choices = () => [...document.querySelectorAll<HTMLElement>(".shell-dialog [role=option]")];
    await waitFor("si sceglie il formato", () => choices().length === 2);
    expect(choices().map((choice) => choice.querySelector(".palette-title")!.textContent)).toEqual([
      t("pdf.export.annotated"),
      t("pdf.export.redacted"),
    ]);
    choices()[1]!.click();
    await waitFor("l'export è chiesto", () => host.atGate("invokeCommand").length === 2);
    const [, call] = host.atGate("invokeCommand");
    expect(call!.args[0]).toBe("export.run");
    expect(JSON.parse(String((call!.args[1] as { request_json: string }).request_json))).toEqual({
      target: "draw.redacted-pdf",
      selection: { kind: "documents", value: [NOTES] },
      options: { suffix: "redatto" },
    });
  });
});
