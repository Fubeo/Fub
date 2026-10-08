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
import type { CommandSpec, SettingEntry } from "./host/contract";
import type { FakeHost } from "./host/fake";
import { checkAccessibility, formatIssues } from "./ui/a11y-check";
import { mountedTextEditors } from "./editors/text/test-support";
import { DEFAULT_CURVE } from "./editors/spatial/pen/pressure";

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
/// La prima volta lo si trasforma tutto, e con la suite intera che gira
/// accanto ci vuole più dei due secondi degli altri.
async function loaded(): Promise<void> {
  await waitFor("il disegno si carica", () => document.querySelector(".vector-pending") === null, 15_000);
}

const MODE_COMMANDS = ["shell.mode.reading", "shell.mode.live", "shell.mode.source"];
const SOURCE_COMMANDS = ["shell.doc.source.open", "shell.doc.source.side", "shell.doc.source.close"];
const EXPORT_COMMANDS = ["shell.doc.export"];

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

/// Il livello dell'editor come lo dichiara il bundle `fub.draw`, col valore
/// `value`: il finto non conosce nessuna feature, e la riga gliela dà il banco.
function drawLevel(value: string): SettingEntry {
  return {
    spec: {
      key: "draw.level",
      label: "Livello d'interfaccia",
      description: "",
      group: "Disegni",
      scope: "vault",
      kind: {
        kind: "choice",
        default: "essential",
        options: [
          { value: "essential", label: "Essenziale" },
          { value: "standard", label: "Standard" },
        ],
      },
      program_writable: false,
    },
    value,
    source: value === "essential" ? "default" : "vault",
  };
}

/// Le parti del Personalizzato come le dichiara `fub.draw`, col valore `value`.
function drawCustom(value: string[]): SettingEntry {
  return {
    spec: {
      key: "draw.custom",
      label: "Parti del Personalizzato",
      description: "",
      group: "Disegni",
      scope: "vault",
      kind: { kind: "list", default: ["pen", "eraser", "rect", "ellipse", "line", "arrow"] },
      program_writable: false,
    },
    value,
    source: "vault",
  };
}

/// Gli strumenti che la barra del riquadro attivo mostra.
const tools = (): string[] =>
  [...focusedPane().querySelectorAll<HTMLElement>(".draw-tool")]
    .filter((control) => control.closest("[hidden]") === null)
    .map((control) => control.dataset.tool ?? "");

/// Se il disegno che si vede nel riquadro attivo mostra la griglia.
const gridShown = (): boolean =>
  [...focusedPane().querySelectorAll<HTMLElement>(".draw-grid")].some(
    (mark) => mark.closest("[hidden]") === null && mark.style.display !== "none",
  );

/// Un tasto premuto dove sta il fuoco.
function press(key: string, init: KeyboardEventInit = {}): void {
  (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key, ...init }));
}

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
    expect(await offered(SOURCE_COMMANDS)).toEqual(["shell.doc.source.open", "shell.doc.source.side"]);
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

  it("si disegna da sola tastiera, e le scorciatoie della shell restano", async () => {
    const host = await start();
    await open("casa.svg");
    const sheet = focusedPane().querySelector<HTMLElement>(".draw-surface")!;
    sheet.focus();
    press("r");
    press(" ");
    press("ArrowRight", { shiftKey: true });
    press("ArrowDown", { shiftKey: true });
    press(" ");
    await waitFor("il rettangolo da tastiera arriva al disco", () => written(host, "casa.svg").length === 1);
    expect(written(host, "casa.svg")[0]!.match(/<rect /g)).toHaveLength(2);
    expect(document.activeElement).toBe(sheet);
    expect(formatIssues(checkAccessibility(focusedPane()))).toBe("");
    pressModE();
    await settle();
    expect(paneMode()).toBe("read");
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

describe("«Apri come sorgente accanto» su un disegno", () => {
  it("il disegno resta a sinistra, il testo si apre a destra, e ogni gesto si legge nel testo", async () => {
    const host = await start();
    await open("casa.svg");
    const reads = host.atGate("readDocument").filter((call) => call.args[0] === "casa.svg").length;
    await run("shell.doc.source.side");
    const [left, right] = panes();
    expect(left!.querySelector(".draw-surface")).not.toBeNull();
    expect(right!.querySelector(".draw-surface")).toBeNull();
    expect(right!.classList.contains("focus")).toBe(true);
    expect(right!.dataset.mode, "il testo senza anteprima: la resa è il disegno accanto").toBe("source");
    expect(right!.contains(document.activeElement)).toBe(true);
    const [editor] = mountedTextEditors();
    expect(editor!.state.doc.toString()).toBe(HOUSE);

    drawRect(left);
    await settle();
    expect(editor!.state.doc.toString().match(/<rect /g)).toHaveLength(2);
    await waitFor("il rettangolo arriva al disco", () => written(host, "casa.svg").length === 1);
    undo(left);
    await settle();
    expect(editor!.state.doc.toString()).toBe(HOUSE);
    await waitFor("il disco torna com'era", () => last(written(host, "casa.svg")) === HOUSE);
    expect(host.atGate("readDocument").filter((call) => call.args[0] === "casa.svg")).toHaveLength(reads);
  });
});

describe("uno screenshot incollato", () => {
  it("si annota, e il file su disco resta uno, con l'immagine dentro", async () => {
    // happy-dom non decodifica immagini: il browser dice soltanto le misure.
    vi.stubGlobal("createImageBitmap", async () => ({ width: 120, height: 80, close() {} }));
    try {
      const host = await start();
      await open("casa.svg");
      const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
      const data = new DataTransfer();
      data.items.add(new File([png], "schermata.png", { type: "image/png" }));
      const paste = new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data });
      focusedPane().querySelector<HTMLElement>(".draw-surface")!.dispatchEvent(paste);
      expect(paste.defaultPrevented).toBe(true);
      await waitFor("l'immagine arriva al disco", () => written(host, "casa.svg").length === 1);
      const [pasted] = written(host, "casa.svg");
      expect(pasted).toMatch(/<image id="[^"]+" x="[^"]+" y="[^"]+" width="120" height="80" href="data:image\/png;base64,iVBORw0KGgoAAAAN"\/>/);
      // Sopra l'immagine si disegna: il rettangolo viene dopo.
      drawRect();
      await waitFor("l'annotazione arriva al disco", () => written(host, "casa.svg").length === 2);
      const annotated = last(written(host, "casa.svg"))!;
      expect(annotated.indexOf("<image ")).toBeGreaterThan(-1);
      expect(annotated.lastIndexOf("<rect ")).toBeGreaterThan(annotated.indexOf("<image "));
      // Nessun allegato accanto: l'immagine è nel file.
      expect(host.atGate("resourceWrite")).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("il livello e la griglia del disegno", () => {
  it("il livello si sceglie nelle impostazioni del vault, e vale subito nel disegno aperto", async () => {
    const host = await start(createFakeHost({ file: VAULT, draw: true, settings: [drawLevel("essential")] }));
    await open("casa.svg");
    const editor = focusedPane().querySelector(".draw-editor");
    expect(tools()).toEqual(["select", "pen", "eraser", "rect", "ellipse", "line", "arrow"]);

    await host.module.api.setSetting("draw.level", "standard");
    await waitFor("l'evidenziatore compare", () => tools().includes("highlighter"));
    expect(tools()).toEqual(["select", "lasso", "board", "eyedropper", "gradient", "pen", "highlighter", "eraser", "rect", "ellipse", "line", "arrow", "connector", "polygon", "text"]);
    expect(focusedPane().querySelector(".draw-editor"), "lo stesso editor, non uno nuovo").toBe(editor);

    await host.module.api.setSetting("draw.level", "essential");
    await waitFor("l'evidenziatore se ne va", () => !tools().includes("highlighter"));
    // Il livello cambia gli strumenti, non il disegno.
    expect(written(host, "casa.svg")).toEqual([]);
    expect(host.files()["casa.svg"]).toBe(HOUSE);
  });

  it("le parti del Personalizzato si scelgono nelle Impostazioni, e valgono subito nel disegno aperto", async () => {
    const host = await start(createFakeHost({ file: VAULT, draw: true, settings: [drawLevel("custom"), drawCustom(["rect"])] }));
    await open("casa.svg");
    await waitFor("il Personalizzato", () => tools().join() === "select,rect");
    const editor = focusedPane().querySelector(".draw-editor");

    document.querySelector<HTMLButtonElement>("#open-settings")!.click();
    await waitFor("la casella dell'ellisse", () => document.getElementById("setting-draw.custom-ellipse") !== null);
    const ellipse = document.getElementById("setting-draw.custom-ellipse") as HTMLInputElement;
    expect(ellipse.closest("label")!.textContent).toBe("Ellisse");
    ellipse.click();

    await waitFor("l'ellisse compare", () => tools().includes("ellipse"));
    expect(tools()).toEqual(["select", "rect", "ellipse"]);
    expect(host.atGate("setSetting").map((call) => call.args), "l'elenco intero, nell'ordine delle parti").toEqual([["draw.custom", ["rect", "ellipse"]]]);
    expect(focusedPane().querySelector(".draw-editor"), "lo stesso editor, non uno nuovo").toBe(editor);
    // Le parti cambiano gli strumenti, non il disegno.
    expect(written(host, "casa.svg")).toEqual([]);
    expect(host.files()["casa.svg"]).toBe(HOUSE);
  });

  it("dallo Standard, Ctrl+K collega l'oggetto scelto a una nota del vault, e Alt+Invio la apre", async () => {
    const host = await start(createFakeHost({ file: VAULT, draw: true, settings: [drawLevel("standard")] }));
    await open("casa.svg");
    await waitFor("il livello Standard", () => tools().includes("highlighter"));
    const sheet = focusedPane().querySelector<HTMLElement>(".draw-surface")!;
    sheet.focus();
    press("a", { ctrlKey: true });
    press("k", { ctrlKey: true });

    await waitFor("l'elenco delle note", () => document.querySelector('.shell-dialog input[role="combobox"]') !== null);
    const filter = document.querySelector<HTMLInputElement>('.shell-dialog input[role="combobox"]')!;
    const offeredNotes = [...document.querySelectorAll('.shell-dialog [role="option"]')].map((option) => option.textContent ?? "");
    expect(offeredNotes.some((option) => option.includes("Benvenuto.md"))).toBe(true);
    expect(offeredNotes.some((option) => option.includes("casa.svg")), "il disegno stesso non c'è").toBe(false);
    filter.value = "Benvenuto";
    filter.dispatchEvent(new Event("input"));
    press("Enter");

    await waitFor("il collegamento arriva al disco", () => written(host, "casa.svg").length === 1);
    expect(written(host, "casa.svg")[0]).toMatch(/<a [^>]*href="Benvenuto\.md"[^>]*>\s*<rect id="o1a2b3c4d"/);
    await waitFor("il fuoco torna al foglio", () => document.activeElement === sheet);
    press("Enter", { altKey: true });
    await waitFor("la nota si apre", () => focusedPane().querySelector(".vector-surface") === null);
    expect(await activeTab()).toMatchObject({ k: "doc", doc: "Benvenuto.md" });
  });

  it("la griglia scelta resta per i disegni aperti dopo, anche dopo un riavvio, e non entra nel vault", async () => {
    const host = await start(createFakeHost({ file: VAULT, draw: true, settings: [drawLevel("standard")] }));
    await open("casa.svg");
    await waitFor("il livello Standard", () => tools().includes("highlighter"));
    focusedPane().querySelector<HTMLElement>(".draw-surface")!.focus();
    expect(gridShown()).toBe(false);
    press("#");
    expect(gridShown()).toBe(true);
    await waitFor("la griglia si ricorda", () => host.atGate("setViewState").some((call) => call.args[0] === "draw.grid"));
    expect(await host.module.api.viewState("draw.grid")).toEqual({ shown: true, snap: false, step: 20, guides: true, steps: {}, rulers: false, rulerGuides: true, panel: null, bar: true, shapes: true, closed: ["transform", "attributes"], twist: true, taps: true, pen: DEFAULT_CURVE });

    await open("albero.svg");
    expect(await activeTab()).toMatchObject({ k: "doc", doc: "albero.svg" });
    expect(gridShown(), "il disegno aperto dopo").toBe(true);
    // Né i disegni né le impostazioni del vault cambiano.
    expect(host.atGate("setSetting")).toEqual([]);
    expect(written(host, "casa.svg")).toEqual([]);
    expect(written(host, "albero.svg")).toEqual([]);

    activeStop?.();
    activeStop = null;
    await start(host);
    await open("albero.svg");
    await waitFor("la griglia ricordata dopo il riavvio", () => gridShown());
  });
});

describe("le immagini del vault nel disegno", () => {
  it("dallo Standard, Ctrl+I ne sceglie una con la miniatura, il disegno la scrive per riferimento e la Lettura la mostra", async () => {
    // happy-dom non decodifica immagini e non dice che cosa si vede.
    vi.stubGlobal("createImageBitmap", async () => ({ width: 64, height: 48, close() {} }));
    vi.stubGlobal("IntersectionObserver", undefined);
    const created = vi.spyOn(URL, "createObjectURL");
    try {
      const host = await start(createFakeHost({ file: { ...VAULT, "immagini/gatto.jpg": "jpg" }, draw: true, settings: [drawLevel("standard")] }));
      await open("casa.svg");
      await waitFor("il livello Standard", () => tools().includes("highlighter"));
      const sheet = focusedPane().querySelector<HTMLElement>(".draw-surface")!;
      sheet.focus();
      press("i", { ctrlKey: true });

      await waitFor("l'elenco delle immagini", () => document.querySelector('.shell-dialog input[role="combobox"]') !== null);
      // Le immagini e basta: né i disegni, né le note, né gli altri file.
      const options = [...document.querySelectorAll('.shell-dialog [role="option"]')];
      expect(options.map((option) => [option.querySelector(".palette-title")!.textContent, option.querySelector(".palette-scope")!.textContent])).toEqual([
        ["foto", "foto.png"],
        ["gatto", "immagini/gatto.jpg"],
      ]);
      await waitFor("le miniature", () => [...document.querySelectorAll<HTMLImageElement>(".shell-dialog .palette-thumb")].every((thumb) => thumb.getAttribute("src")));
      expect(formatIssues(checkAccessibility(document.querySelector<HTMLElement>(".shell-dialog")!))).toBe("");
      const filter = document.querySelector<HTMLInputElement>('.shell-dialog input[role="combobox"]')!;
      filter.value = "gatto";
      filter.dispatchEvent(new Event("input"));
      press("Enter");

      await waitFor("l'immagine arriva al disco", () => written(host, "casa.svg").length === 1);
      expect(written(host, "casa.svg")[0]).toMatch(/<image id="[^"]+" x="[^"]+" y="[^"]+" width="64" height="48" href="immagini\/gatto\.jpg"\/>/);
      // Il vault non cambia: l'immagine c'era già.
      expect(host.atGate("resourceWrite")).toEqual([]);
      // Entrata, l'immagine chiede che cosa mostra, col fuoco nel campo: Invio
      // scrive la descrizione in un passo suo, e il fuoco torna al foglio.
      await waitFor("la barra chiede la descrizione", () => document.activeElement?.classList.contains("draw-describe-input") === true);
      (document.activeElement as HTMLInputElement).value = "Un gatto sul divano";
      press("Enter");
      await waitFor("la descrizione arriva al disco", () => written(host, "casa.svg").length === 2);
      expect(written(host, "casa.svg")[1]).toMatch(/<image [^>]*href="immagini\/gatto\.jpg"[^>]*>\s*<title>Un gatto sul divano<\/title>\s*<\/image>/);
      await waitFor("il fuoco torna al foglio", () => document.activeElement === sheet);
      // Il foglio la mostra dal vault.
      await waitFor("il foglio apre l'immagine", () => {
        const image = focusedPane().querySelector(".draw-surface image[data-scene-id]");
        return image !== null && host.atGate("resourceOpen").some((call) => call.args[0] === "immagini/gatto.jpg") && !image.getAttribute("href")!.startsWith("data:");
      });

      pressModE();
      await waitFor("la Lettura", () => paneMode() === "read");
      const shownSvg = async (): Promise<string[]> =>
        Promise.all(created.mock.calls.map(([blob]) => blob as Blob).filter((blob) => blob.type === "image/svg+xml").map((blob) => blob.text()));
      let texts: string[] = [];
      await waitFor("la Lettura mostra i byte dell'immagine", () => {
        void shownSvg().then((all) => (texts = all));
        return texts.some((text) => text.includes(`href="data:image/jpeg;base64,${btoa("jpg")}"`));
      });
      // Il file resta per riferimento.
      expect(host.files()["casa.svg"]).toContain('href="immagini/gatto.jpg"');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("«Esporta…» su un disegno", () => {
  const withExport = () => createFakeHost({ file: VAULT, draw: true, commands: [EXPORT_RUN] });
  const choices = () => [...document.querySelectorAll<HTMLElement>(".shell-dialog [role=option]")];
  const requests = (host: FakeHost) => host.atGate("invokeCommand")
    .filter((call) => call.args[0] === "export.run")
    .map((call) => JSON.parse(String((call.args[1] as { request_json: string }).request_json)) as unknown);

  it("c'è sui disegni, anche su quelli che si guardano soltanto, e altrove no", async () => {
    await start(withExport());
    await open("casa.svg");
    expect(await offered(EXPORT_COMMANDS)).toEqual(EXPORT_COMMANDS);
    await open("logo.svg");
    expect(await offered(EXPORT_COMMANDS), "un SVG estraneo").toEqual(EXPORT_COMMANDS);
    for (const doc of ["Benvenuto.md", "lavagna.canvas", "conti.fubsheet", "foto.png"]) {
      await open(doc);
      expect(await offered(EXPORT_COMMANDS), doc).toEqual([]);
    }
  });

  it("senza `export.run` nel kernel non c'è", async () => {
    await start();
    await open("casa.svg");
    expect(await offered(EXPORT_COMMANDS)).toEqual([]);
  });

  it("chiede il formato, salva prima l'ultimo gesto e apre il centro attività", async () => {
    const host = await start(withExport());
    await open("casa.svg");
    drawRect();
    // Il salvataggio aspetta il suo debounce: l'export non lo aspetta, lo fa
    // partire.
    expect(written(host, "casa.svg")).toEqual([]);
    expect(document.getElementById("activity-panel")!.hidden).toBe(true);
    await run("shell.doc.export");
    await waitFor("si sceglie il formato", () => choices().length === 2);
    expect(choices().map((choice) => choice.querySelector(".palette-title")!.textContent)).toEqual(["PNG", "PDF"]);
    choices()[1]!.click();
    await waitFor("l'export è chiesto", () => requests(host).length === 1);
    expect(requests(host)).toEqual([
      { target: "draw.pdf", selection: { kind: "documents", value: ["casa.svg"] }, options: {} },
    ]);
    const saved = host.calls.findIndex((call) => call.gate === "writeDocument" && call.args[0] === "casa.svg");
    const asked = host.calls.findIndex((call) => call.gate === "invokeCommand");
    expect(saved).toBeGreaterThanOrEqual(0);
    expect(asked).toBeGreaterThan(saved);
    expect(written(host, "casa.svg")[0]!.match(/<rect /g)).toHaveLength(2);
    await waitFor("il centro attività si apre", () => !document.getElementById("activity-panel")!.hidden);
    // Il fuoco resta sul disegno.
    expect(focusedPane().contains(document.activeElement)).toBe(true);
  });

  it("dal menu del riquadro ogni formato è una voce", async () => {
    const host = await start(withExport());
    const { t } = await import("./i18n/strings");
    await open("casa.svg");
    focusedPane().querySelector<HTMLButtonElement>("[data-pane-menu]")!.click();
    await settle();
    const entries = [...document.querySelectorAll<HTMLButtonElement>("#context-menu button")];
    const labels = entries.map((button) => button.querySelector(".menu-label")?.textContent ?? "");
    expect(labels.filter((label) => label.startsWith(t("pane.export", { what: "" })))).toEqual([
      t("pane.export", { what: "PNG" }),
      t("pane.export", { what: "PDF" }),
    ]);
    entries[labels.indexOf(t("pane.export", { what: "PNG" }))]!.click();
    await waitFor("l'export è chiesto", () => requests(host).length === 1);
    expect(requests(host)).toEqual([
      { target: "draw.png", selection: { kind: "documents", value: ["casa.svg"] }, options: {} },
    ]);
  });

  it("dallo Standard apre la finestra «Esporta», e manda le sue scelte", async () => {
    const host = await start(createFakeHost({ file: VAULT, draw: true, commands: [EXPORT_RUN], settings: [drawLevel("standard")] }));
    const { t } = await import("./i18n/strings");
    await open("casa.svg");
    await waitFor("lo Standard", () => tools().includes("highlighter"));
    await run("shell.doc.export");
    await waitFor("la finestra si apre", () => document.querySelector(".draw-export form") !== null);
    expect(choices(), "non la scelta del formato").toEqual([]);
    const option = (label: string): HTMLInputElement =>
      [...document.querySelectorAll<HTMLLabelElement>(".draw-export label.draw-export-option")].find((each) => each.textContent === label)!.querySelector("input")!;
    option("PDF").checked = true;
    option("PDF").dispatchEvent(new Event("change", { bubbles: true }));
    document.querySelector<HTMLFormElement>(".draw-export form")!.requestSubmit();
    await waitFor("l'export è chiesto", () => requests(host).length === 1);
    expect(requests(host)).toEqual([
      { target: "draw.pdf", selection: { kind: "documents", value: ["casa.svg"] }, options: { background: "paper", scope: "drawing" } },
    ]);
    // Il menu del riquadro ha la finestra prima dei formati.
    focusedPane().querySelector<HTMLButtonElement>("[data-pane-menu]")!.click();
    await settle();
    const labels = [...document.querySelectorAll<HTMLButtonElement>("#context-menu button")].map((button) => button.querySelector(".menu-label")?.textContent ?? "");
    const at = labels.indexOf(t("commands.doc.export"));
    expect(at).toBeGreaterThanOrEqual(0);
    expect(labels.slice(at, at + 3)).toEqual([t("commands.doc.export"), t("pane.export", { what: "PNG" }), t("pane.export", { what: "PDF" })]);
  });
});
