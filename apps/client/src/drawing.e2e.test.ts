// @vitest-environment happy-dom
//
// **Il disegno nella shell**, sulla shell vera (ADR 0203).
//
// Con la feature `draw` dell'host un `.svg` ha il formato `svg` e si apre sul
// profilo `vector` della famiglia `canvas`: si disegna, si legge, si guarda
// come testo con «Apri come sorgente» sulla stessa sessione e si torna. Il
// cablaggio è quello di `surface-modes.e2e.test.ts` — `main.ts` sulla scocca
// vera, contro l'host finto — con il registro vero e nessuna famiglia finta.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeHost } from "./host/fake";
import { mountedTextEditors } from "./editors/text/test-support";

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

const HEAD =
  '<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" fub:version="1" viewBox="0 0 400 300">';
const HOUSE =
  `${HEAD}\n  <title>Casa</title>\n  <g id="l1" fub:layer="Livello 1">\n    <rect id="o1a2b3c4d" x="60" y="60" width="80" height="60" fill="none" stroke="#000000" stroke-width="4"/>\n  </g>\n</svg>\n`;
const TREE = HOUSE.replace("Casa", "Albero");
const FOREIGN = '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><circle cx="4" cy="4" r="3"/></svg>\n';
const BOARD = JSON.stringify({
  nodes: [{ id: "prima", type: "text", text: "prima", x: 0, y: 0, width: 10, height: 10 }],
  edges: [],
});
const SHEET = JSON.stringify({
  version: 1,
  sheets: [{
    id: "main",
    name: "Main",
    rows: [{ id: "r0", hidden: false }],
    columns: [{ id: "c0", hidden: false }],
    cells: [{ row: "r0", column: "c0", input: "1" }],
  }],
});
const VAULT = {
  "Benvenuto.md": "# Benvenuto\n",
  "Plain.txt": "solo testo\n",
  "casa.svg": HOUSE,
  "albero.svg": TREE,
  "logo.svg": FOREIGN,
  "lavagna.canvas": BOARD,
  "conti.fubsheet": SHEET,
  "foto.png": "png",
};

/// Monta la shell vera e aspetta l'avvio. Con `host` riparte sullo stesso
/// host: lo stato salvato (il layout) è quello che la shell di prima ha
/// scritto, come dopo un riavvio dell'app.
async function start(host: FakeHost = createFakeHost({ file: VAULT, draw: true })): Promise<FakeHost> {
  vi.resetModules();
  box.host = host;
  const body = /<body[^>]*>([\s\S]*)<\/body>/.exec(rawHtml);
  if (!body) throw new Error("index.html non ha un body");
  document.body.innerHTML = body[1].replace(/<script[\s\S]*?<\/script>/g, "");
  const main = await import("./main");
  const stop = await main.startup;
  activeStop = stop;
  await settle();
  return host;
}

async function settle(rounds = 6): Promise<void> {
  for (let i = 0; i < rounds; i += 1) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

async function waitFor(thing: string, cond: () => boolean, within = 2000): Promise<void> {
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
  await loaded();
}

/// Il codice del disegno arriva dopo il montaggio: si aspetta che arrivi.
async function loaded(): Promise<void> {
  await waitFor("il disegno si carica", () => document.querySelector(".vector-pending") === null);
}

const MODE_COMMANDS = ["shell.mode.reading", "shell.mode.live", "shell.mode.source"];
const SOURCE_COMMANDS = ["shell.doc.source.open", "shell.doc.source.close"];

async function offered(ids: readonly string[]): Promise<string[]> {
  const { allCommands } = await import("./ui/commands");
  return allCommands().map((entry) => entry.id).filter((id) => ids.includes(id));
}

async function run(id: string): Promise<void> {
  const { allCommands } = await import("./ui/commands");
  const entry = allCommands().find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`il comando ${id} non è disponibile`);
  await entry.run?.();
  await settle();
}

function pressModE(): void {
  (document.activeElement ?? document.body).dispatchEvent(
    new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "e", ctrlKey: true }),
  );
}

const panes = () => [...document.querySelectorAll<HTMLElement>(".pane")];
const focusedPane = () => document.querySelector<HTMLElement>(".pane.focus")!;
const paneMode = () => focusedPane().dataset.mode;

async function activeTab() {
  const layout = await import("./state/layout");
  return layout.activeTab();
}

let clock = 100;

/// Un rettangolo disegnato col mouse sul foglio del riquadro `pane`.
function drawRect(pane: HTMLElement = focusedPane()): void {
  pane.querySelector<HTMLButtonElement>('.draw-tool[data-tool="rect"]')!.click();
  const sheet = pane.querySelector<HTMLElement>(".draw-surface")!;
  const event = (type: string, x: number, y: number, buttons: number): PointerEvent => {
    const e = new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true, isPrimary: true, pointerId: 1, pointerType: "mouse",
      button: type === "pointermove" ? -1 : 0, buttons, pressure: buttons ? 0.5 : 0, clientX: x, clientY: y,
    });
    Object.defineProperty(e, "timeStamp", { value: (clock += 8) });
    return e;
  };
  sheet.dispatchEvent(event("pointerdown", 200, 150, 1));
  sheet.dispatchEvent(event("pointermove", 260, 200, 1));
  sheet.dispatchEvent(event("pointerup", 260, 200, 0));
}

function undo(pane: HTMLElement = focusedPane()): void {
  pane.querySelector<HTMLElement>(".draw-surface")!.dispatchEvent(
    new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "z", ctrlKey: true }),
  );
}

/// Gli id degli oggetti che il foglio di `pane` disegna, livello escluso.
const painted = (pane: HTMLElement = focusedPane()): string[] =>
  [...pane.querySelectorAll<SVGElement>(".draw-surface [data-scene-id]")]
    .map((el) => el.getAttribute("data-scene-id")!)
    .filter((id) => id !== "l1");

const last = <T>(items: readonly T[]): T | undefined => items[items.length - 1];

const written = (host: FakeHost, doc: string): string[] =>
  host.atGate("writeDocument").filter((call) => call.args[0] === doc).map((call) => String(call.args[1]));

beforeEach(() => {
  activeStop?.();
  activeStop = null;
  document.body.innerHTML = "";
  localStorage.clear();
});

describe("un .svg è un disegno", () => {
  it("si apre sul profilo vector, in Disegno, e offre la vista sorgente", async () => {
    await start();
    await open("casa.svg");
    expect(paneMode()).toBe("draw");
    expect(focusedPane().querySelector(".vector-surface .draw-editor")).not.toBeNull();
    expect(mountedTextEditors()).toHaveLength(0);
    expect(await offered(MODE_COMMANDS)).toEqual(["shell.mode.reading", "shell.mode.live"]);
    expect(await offered(SOURCE_COMMANDS)).toEqual(["shell.doc.source.open"]);
  });

  it("senza la feature `draw` resta testo con l'anteprima accanto", async () => {
    await start(createFakeHost({ file: VAULT }));
    await open("casa.svg");
    expect(focusedPane().querySelector(".vector-surface")).toBeNull();
    expect(mountedTextEditors()).toHaveLength(1);
    expect(await offered(SOURCE_COMMANDS)).toEqual([]);
  });

  it("le altre famiglie offrono gli stessi comandi di prima", async () => {
    await start();
    const cases: [string, string[]][] = [
      ["Benvenuto.md", ["shell.mode.reading", "shell.mode.live", "shell.mode.source"]],
      ["Plain.txt", []],
      ["lavagna.canvas", ["shell.mode.live", "shell.mode.source"]],
      ["conti.fubsheet", []],
      ["foto.png", []],
    ];
    for (const [doc, expected] of cases) {
      await open(doc);
      expect(await offered(MODE_COMMANDS), doc).toEqual(expected);
      expect(await offered(SOURCE_COMMANDS), doc).toEqual([]);
    }
  });

  it("un gesto arriva al disco come documento del formato svg, e si annulla", async () => {
    const host = await start();
    await open("casa.svg");
    drawRect();
    await waitFor("il rettangolo arriva al disco", () => written(host, "casa.svg").length === 1);
    const [saved] = written(host, "casa.svg");
    expect(saved!.match(/<rect /g)).toHaveLength(2);
    // Le righe di prima restano com'erano: il gesto ha aggiunto e basta.
    expect(saved!.startsWith(HOUSE.slice(0, HOUSE.indexOf("  </g>")))).toBe(true);
    expect(saved!.endsWith("  </g>\n</svg>\n")).toBe(true);
    undo();
    await waitFor("l'annulla arriva al disco", () => last(written(host, "casa.svg")) === HOUSE);
    expect(host.atGate("resourceWrite")).toEqual([]);
  });

  it("Mod-e porta alla Lettura, il documento intero come immagine, e torna", async () => {
    await start();
    await open("casa.svg");
    pressModE();
    await settle();
    expect(paneMode()).toBe("read");
    expect(focusedPane().querySelector<HTMLImageElement>(".vector-read img")!.alt).toBe("Il disegno «Casa»");
    expect(focusedPane().querySelector<HTMLElement>(".vector-draw")!.hidden).toBe(true);
    pressModE();
    await settle();
    expect(paneMode()).toBe("draw");
  });

  it("un SVG estraneo è un'immagine, e «Modifica» lo adotta", async () => {
    const host = await start();
    await open("logo.svg");
    expect(paneMode()).toBe("draw");
    expect(focusedPane().querySelector<HTMLElement>(".vector-draw")!.hidden).toBe(true);
    expect(focusedPane().querySelector<HTMLElement>(".vector-read")!.hidden).toBe(false);
    const action = focusedPane().querySelector<HTMLButtonElement>(".vector-notice-action")!;
    expect(action.hidden).toBe(false);
    action.click();
    await waitFor("l'adozione arriva al disco", () => written(host, "logo.svg").length === 1);
    expect(written(host, "logo.svg")[0]).toContain('fub:version="1"');
    expect(focusedPane().querySelector<HTMLElement>(".vector-notice")!.hidden).toBe(true);
    expect(focusedPane().querySelector<HTMLElement>(".vector-draw")!.hidden).toBe(false);
  });
});

describe("due riquadri sullo stesso disegno", () => {
  it("si allineano, e ciascuno annulla soltanto i suoi gesti", async () => {
    const host = await start();
    await open("casa.svg");
    await run("shell.pane.split.right");
    await waitFor("due fogli", () => document.querySelectorAll(".draw-surface").length === 2);
    const [left, right] = panes();
    drawRect(left);
    await settle();
    expect(painted(right!)).toEqual(painted(left!));
    expect(painted(right!)).toHaveLength(2);
    // Il riquadro di destra non ha niente da annullare.
    undo(right);
    await settle();
    expect(painted(left!)).toHaveLength(2);
    undo(left);
    await settle();
    expect(painted(right!)).toEqual(["o1a2b3c4d"]);
    await waitFor("il disco torna com'era", () => last(written(host, "casa.svg")) === HOUSE);
  });
});

describe("«Apri come sorgente» su un disegno", () => {
  it("mostra il testo, e una modifica lì il disegno la mostra senza rileggere", async () => {
    const host = await start();
    await open("casa.svg");
    const reads = host.atGate("readDocument").filter((call) => call.args[0] === "casa.svg").length;
    await run("shell.pane.split.right");
    await waitFor("due fogli", () => document.querySelectorAll(".draw-surface").length === 2);
    // A destra il testo, a sinistra il disegno.
    await run("shell.doc.source.open");
    expect(await activeTab()).toEqual({ k: "doc", doc: "casa.svg", override: { family: "text", profile: "svg" } });
    const [editor] = mountedTextEditors();
    expect(editor!.state.doc.toString()).toBe(HOUSE);
    const at = editor!.state.doc.toString().indexOf("  </g>");
    editor!.dispatch({ changes: { from: at, insert: '    <ellipse id="o5e6f7a8b" cx="300" cy="200" rx="20" ry="10"/>\n' } });
    await settle();
    const [drawing] = panes().filter((pane) => pane.querySelector(".draw-surface"));
    expect(painted(drawing!)).toEqual(["o1a2b3c4d", "o5e6f7a8b"]);

    // Il ritorno: il disegno c'è già, sulla stessa sessione.
    await run("shell.doc.source.close");
    await loaded();
    expect(await activeTab()).toEqual({ k: "doc", doc: "casa.svg" });
    expect(painted(focusedPane())).toEqual(["o1a2b3c4d", "o5e6f7a8b"]);
    expect(host.atGate("readDocument").filter((call) => call.args[0] === "casa.svg")).toHaveLength(reads);
    await waitFor("la modifica arriva al disco", () => (last(written(host, "casa.svg")) ?? "").includes("o5e6f7a8b"));
  });

  it("la scelta resta dopo un riavvio, e non passa alle altre linguette", async () => {
    const host = await start();
    await open("casa.svg");
    await run("shell.doc.source.open");
    await open("albero.svg");
    expect(paneMode(), "l'altro disegno si apre come disegno").toBe("draw");
    await open("Benvenuto.md");
    await waitFor("il layout si salva", () =>
      JSON.stringify(last(host.atGate("setViewState"))?.args ?? []).includes("Benvenuto.md"));

    activeStop?.();
    activeStop = null;
    await start(host);
    const layout = await import("./state/layout");
    const tabs = layout.activePane().tabs;
    // La nota di benvenuto è la linguetta che la shell apre all'avvio.
    expect(tabs).toEqual([
      { k: "doc", doc: "Benvenuto.md" },
      { k: "doc", doc: "casa.svg", override: { family: "text", profile: "svg" } },
      { k: "doc", doc: "albero.svg" },
    ]);
    await open("casa.svg");
    expect(focusedPane().querySelector(".vector-surface")).toBeNull();
    expect(mountedTextEditors()[0]!.state.doc.toString()).toBe(HOUSE);
    await open("albero.svg");
    expect(focusedPane().querySelector(".vector-surface")).not.toBeNull();
  });
});
