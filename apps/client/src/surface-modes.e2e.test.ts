// @vitest-environment happy-dom
//
// **Le modalità per ruolo e la vista sorgente di una scheda**, sulla shell vera.
//
// Due promesse del registro delle superfici, guardate dal lato di chi usa la
// shell. I comandi `shell.mode.*` trovano la modalità di una superficie dal
// ruolo che dichiara (`contextMode`), non dall'id, e ci sono soltanto dove
// porterebbero a qualcosa. Una scheda può mostrare il suo documento nella vista
// sorgente che la superficie dichiara (ADR 0203), sulla stessa sessione: niente
// rilettura dal disco, niente modifiche perse, il fuoco sulla superficie nuova.
//
// Il cablaggio è quello di `shell.e2e.test.ts` — `main.ts` sulla scocca vera,
// contro l'host finto — con una cosa in più: una famiglia finta, «draw», che
// chiama «draw» e «read» le sue due modalità e dichiara come vista sorgente il
// profilo `svg` della famiglia `text`. Nessuna superficie della shell dichiara
// ancora una vista sorgente, e la famiglia finta è il modo di provarla senza
// inventarne una vera.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeHost } from "./host/fake";
import type { EditorSurface, SurfaceRegistration } from "./editors/core/registry";
import { mountedTextEditors, undoDepth } from "./editors/text/test-support";

vi.setConfig({ testTimeout: 20_000 });

interface FakeDraw {
  readonly root: HTMLElement;
  readonly paneId: string;
  text: string;
  mode: string;
  destroyed: boolean;
}

const box = vi.hoisted(() => ({
  host: null as FakeHost | null,
  /// Il modulo vero di `bootstrap`, caricato a ogni montaggio dopo
  /// `vi.resetModules`: il mock qui sotto è uno per tutto il file e delega a
  /// questo, come l'IPC delega all'host di adesso.
  bootstrap: null as typeof import("./editors/core/bootstrap") | null,
  draws: [] as FakeDraw[],
}));

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

// Il registro vero, con in più la famiglia finta: registrata come la
// registrerebbe un altro owner, sopra le famiglie della shell.
vi.mock("./editors/core/bootstrap", () => ({
  createDocumentSurfaceRegistry: (
    ...args: Parameters<typeof import("./editors/core/bootstrap").createDocumentSurfaceRegistry>
  ) => {
    if (!box.bootstrap) throw new Error("il bootstrap vero non è stato caricato");
    const registry = box.bootstrap.createDocumentSurfaceRegistry(...args);
    registry.register(drawRegistration());
    return registry;
  },
}));

/// La famiglia finta: due modalità con id suoi, il testo tenuto com'è, e
/// l'SVG come vista sorgente del suo profilo.
function drawRegistration(): SurfaceRegistration {
  return {
    owner: "test.draw",
    family: "draw",
    defaultProfile: "vector",
    formats: { "test.draw": "vector" },
    sourceViews: { vector: { family: "text", profile: "svg" } },
    factory: {
      mount(profile, context): EditorSurface {
        const root = document.createElement("div");
        root.className = "fake-draw";
        root.tabIndex = -1;
        context.parent.append(root);
        const draw: FakeDraw = { root, paneId: context.paneId, text: "", mode: "draw", destroyed: false };
        box.draws.push(draw);
        return {
          family: "draw",
          profile,
          surfaceId: `draw:${context.paneId}:${box.draws.length}`,
          modes: [
            { id: "draw", label: () => "Disegno", presentation: "surface", contextMode: "live_preview" },
            { id: "read", label: () => "Guarda", presentation: "rendered", contextMode: "reading" },
          ],
          defaultMode: "draw",
          setMode(mode) {
            draw.mode = mode;
          },
          buffer: {
            setDoc(text) {
              draw.text = text;
            },
            syncDoc(update) {
              draw.text = typeof update === "string" ? update : update.text;
            },
            getDoc: () => draw.text,
          },
          focus() {
            root.focus();
          },
          destroy() {
            draw.destroyed = true;
            root.remove();
          },
        };
      },
    },
  };
}

const { createFakeHost } = await import("./host/fake");
const rawHtml = (await import("../index.html?raw")).default;

const DRAWING = '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>\n';
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
  "logo.svg": DRAWING,
  "schizzo.draw": DRAWING,
  "lavagna.canvas": BOARD,
  "rotta.canvas": "{",
  "conti.fubsheet": SHEET,
  "foto.png": "png",
};

/// Monta la shell vera sul vault finto e aspetta l'avvio. I file `.draw`
/// arrivano col formato della famiglia finta: è il backend a dire il formato,
/// e l'host finto ne conosce soltanto quattro.
async function start(file: Record<string, string> = VAULT): Promise<FakeHost> {
  vi.resetModules();
  box.draws = [];
  const host = createFakeHost({ file });
  const api = host.module.api as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
  const read = api.readDocument!;
  api.readDocument = async (id: unknown) => {
    const source = (await read(id)) as Record<string, unknown>;
    return String(id).endsWith(".draw") ? { ...source, format_id: "test.draw" } : source;
  };
  box.host = host;
  const body = /<body[^>]*>([\s\S]*)<\/body>/.exec(rawHtml);
  if (!body) throw new Error("index.html non ha un body");
  document.body.innerHTML = body[1].replace(/<script[\s\S]*?<\/script>/g, "");
  box.bootstrap = await vi.importActual<typeof import("./editors/core/bootstrap")>("./editors/core/bootstrap");
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
}

const MODE_COMMANDS = ["shell.mode.reading", "shell.mode.live", "shell.mode.source"];
const SOURCE_COMMANDS = ["shell.doc.source.open", "shell.doc.source.close"];

/// I comandi fra `ids` che la palette e la tastiera offrono adesso.
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

const focusedPane = () => document.querySelector<HTMLElement>(".pane.focus")!;
const paneMode = () => focusedPane().dataset.mode;
const liveDraws = () => box.draws.filter((draw) => !draw.destroyed);

async function activeTab() {
  const layout = await import("./state/layout");
  return layout.activeTab();
}

beforeEach(() => {
  activeStop?.();
  activeStop = null;
  document.body.innerHTML = "";
  localStorage.clear();
});

describe("i comandi delle modalità seguono il ruolo dichiarato", () => {
  // Cosa offriva la shell prima, famiglia per famiglia, e cosa offre adesso.
  // Le sole differenze sono due e volute: il testo semplice non offre più
  // «Passa a Sorgente», che non portava da nessuna parte, e la tela offre
  // «Passa a Live», che dal suo JSON torna alle carte.
  it("ogni famiglia offre soltanto i comandi che la cambierebbero", async () => {
    await start();
    const cases: [string, string[]][] = [
      ["Benvenuto.md", ["shell.mode.reading", "shell.mode.live", "shell.mode.source"]],
      ["logo.svg", ["shell.mode.reading", "shell.mode.live", "shell.mode.source"]],
      ["Plain.txt", []],
      ["lavagna.canvas", ["shell.mode.live", "shell.mode.source"]],
      ["conti.fubsheet", []],
      ["foto.png", []],
      ["rotta.canvas", []],
      ["schizzo.draw", ["shell.mode.reading", "shell.mode.live"]],
    ];
    for (const [doc, expected] of cases) {
      await open(doc);
      expect(await offered(MODE_COMMANDS), doc).toEqual(expected);
    }
    expect(paneMode(), "la superficie finta è montata").toBe("draw");
    await open("rotta.canvas");
    expect(paneMode(), "la tela rotta mostra la superficie d'errore").toBe("error");
  });

  it("Mod-e e Live raggiungono le modalità di una superficie che le chiama altrimenti", async () => {
    await start();
    await open("schizzo.draw");
    expect(paneMode()).toBe("draw");

    pressModE();
    await settle();
    expect(paneMode()).toBe("read");
    expect(liveDraws()[0]!.mode).toBe("read");
    pressModE();
    await settle();
    expect(paneMode(), "Mod-e torna alla scrittura di prima").toBe("draw");

    await run("shell.mode.reading");
    await run("shell.mode.live");
    expect(paneMode(), "Live porta alla modalità che si scrive sulla resa").toBe("draw");
  });

  it("dalla Lettura il ritorno è la scrittura di quella famiglia, non di un'altra", async () => {
    await start();
    await open("Benvenuto.md");
    await run("shell.mode.source");
    pressModE();
    await settle();
    expect(paneMode()).toBe("reading");

    // La stessa scheda di riquadro passa a un disegno, lo legge e torna: il
    // «source» ricordato è del testo, e il disegno torna al suo «draw».
    await open("schizzo.draw");
    pressModE();
    await settle();
    expect(paneMode()).toBe("read");
    pressModE();
    await settle();
    expect(paneMode()).toBe("draw");

    await open("Benvenuto.md");
    expect(paneMode()).toBe("reading");
    pressModE();
    await settle();
    expect(paneMode(), "la nota ritrova la sua Sorgente").toBe("source");
  });

  it("sulla tela Live torna dal JSON alle carte", async () => {
    await start();
    await open("lavagna.canvas");
    await run("shell.mode.source");
    expect(paneMode()).toBe("source");
    await run("shell.mode.live");
    expect(paneMode()).toBe("canvas");
  });
});

describe("la vista sorgente di una scheda", () => {
  it("si offre soltanto dove la superficie la dichiara", async () => {
    await start();
    for (const doc of ["Benvenuto.md", "logo.svg", "Plain.txt", "lavagna.canvas", "conti.fubsheet", "foto.png"]) {
      await open(doc);
      expect(await offered(SOURCE_COMMANDS), doc).toEqual([]);
    }
    await open("schizzo.draw");
    expect(await offered(SOURCE_COMMANDS)).toEqual(["shell.doc.source.open"]);
  });

  it("apre il testo sulla stessa sessione, col fuoco, e torna senza perdere niente", async () => {
    const host = await start();
    await open("schizzo.draw");
    const reads = host.atGate("readDocument").filter((call) => call.args[0] === "schizzo.draw").length;
    expect(reads).toBe(1);

    await run("shell.doc.source.open");
    expect(await activeTab()).toEqual({ k: "doc", doc: "schizzo.draw", override: { family: "text", profile: "svg" } });
    expect(liveDraws(), "la superficie del disegno è smontata").toHaveLength(0);
    const [editor] = mountedTextEditors();
    expect(editor?.state.doc.toString()).toBe(DRAWING);
    expect(focusedPane().contains(document.activeElement), "il fuoco è nella superficie nuova").toBe(true);
    expect(await offered(SOURCE_COMMANDS)).toEqual(["shell.doc.source.close"]);
    // La scheda dice che cosa mostra, a vista e al lettore di schermo.
    const tab = focusedPane().querySelector<HTMLElement>(".tab[aria-selected='true']")!;
    expect(tab.getAttribute("aria-label")).toContain("vista sorgente");
    expect(tab.textContent).toContain("vista sorgente");

    // Una modifica non ancora salvata attraversa il cambio di superficie.
    editor!.dispatch({ changes: { from: 0, insert: "<!-- a mano -->" } });
    await settle();
    await run("shell.doc.source.close");
    expect(await activeTab()).toEqual({ k: "doc", doc: "schizzo.draw" });
    expect(mountedTextEditors()).toHaveLength(0);
    const [draw] = liveDraws();
    expect(draw?.text).toBe(`<!-- a mano -->${DRAWING}`);
    expect(document.activeElement).toBe(draw?.root);
    expect(
      host.atGate("readDocument").filter((call) => call.args[0] === "schizzo.draw"),
      "nessuna rilettura dal disco",
    ).toHaveLength(reads);
    await waitFor("la modifica arriva al disco", () =>
      host.atGate("writeDocument").some((call) => String(call.args[1]).startsWith("<!-- a mano -->")));
  });

  it("non tocca la cronologia di un altro riquadro sullo stesso documento", async () => {
    await start();
    await open("schizzo.draw");
    await run("shell.doc.source.open");
    const { allCommands } = await import("./ui/commands");
    await allCommands().find((entry) => entry.id === "shell.pane.split.right")!.run!();
    await waitFor("il secondo riquadro mostra il disegno", () => liveDraws().length === 1);
    await settle();
    // Il riquadro nuovo apre il documento sulla sua superficie: a sinistra il
    // testo, a destra il disegno.
    const [left] = mountedTextEditors();
    left!.dispatch({ changes: { from: 0, insert: "<!-- uno -->" } });
    left!.dispatch({ changes: { from: 0, insert: "<!-- due -->" } });
    await settle();
    const depth = undoDepth(left!.state);
    expect(depth).toBeGreaterThan(0);

    await run("shell.doc.source.open");
    expect(mountedTextEditors()).toHaveLength(2);
    await run("shell.doc.source.close");
    expect(mountedTextEditors()).toEqual([left]);
    expect(undoDepth(left!.state), "la cronologia dell'altro riquadro resta").toBe(depth);
    expect(liveDraws()[0]!.text).toBe(`<!-- due --><!-- uno -->${DRAWING}`);
  });

  it("dalla Lettura ricordata apre il testo da scrivere, non un'altra resa", async () => {
    await start();
    await open("logo.svg");
    await run("shell.mode.reading");
    expect(paneMode()).toBe("reading");
    await open("schizzo.draw");
    await run("shell.doc.source.open");
    expect(paneMode()).toBe("live_preview");
    expect(focusedPane().contains(document.activeElement)).toBe(true);
  });

  it("il menu del riquadro la apre e la chiude", async () => {
    await start();
    await open("schizzo.draw");
    const choose = async (label: string) => {
      focusedPane().querySelector<HTMLButtonElement>("[data-pane-menu]")!.click();
      await settle();
      const entry = [...document.querySelectorAll<HTMLButtonElement>("#context-menu button")]
        .find((button) => button.querySelector(".menu-label")?.textContent === label);
      if (!entry) throw new Error(`nel menu del riquadro non c'è «${label}»`);
      entry.click();
      await settle();
      await settle();
    };
    await choose("Apri come sorgente");
    expect(mountedTextEditors()).toHaveLength(1);
    await choose("Chiudi la vista sorgente");
    expect(mountedTextEditors()).toHaveLength(0);
    expect(liveDraws()).toHaveLength(1);
  });

  it("una scelta che la superficie non offre più si scarta, senza la superficie d'errore", async () => {
    const host = await start();
    const layout = await import("./state/layout");
    const { synchronize } = await import("./panels/document");

    // Una nota non dichiara una vista sorgente: la scelta scritta a mano cade.
    await open("Benvenuto.md");
    layout.setTabOverride(layout.layout.focus, layout.activePane().active, { family: "text", profile: "svg" });
    await synchronize();
    await settle();
    expect(await activeTab()).toEqual({ k: "doc", doc: "Benvenuto.md" });
    expect(paneMode()).not.toBe("error");
    expect(focusedPane().querySelector(".cm-editor")).not.toBeNull();

    // Un disegno ne dichiara una, ma non questa.
    await open("schizzo.draw");
    layout.setTabOverride(layout.layout.focus, layout.activePane().active, { family: "grid" });
    await synchronize();
    await settle();
    expect(await activeTab()).toEqual({ k: "doc", doc: "schizzo.draw" });
    expect(paneMode()).toBe("draw");
    expect(liveDraws()).toHaveLength(1);
    expect(host.atGate("readDocument").filter((call) => call.args[0] === "schizzo.draw")).toHaveLength(1);

    // Un'immagine si mostra dai byte: niente testo, niente vista sorgente.
    await open("foto.png");
    layout.setTabOverride(layout.layout.focus, layout.activePane().active, { family: "text", profile: "svg" });
    await synchronize();
    await settle();
    expect(await activeTab()).toEqual({ k: "doc", doc: "foto.png" });
    expect(paneMode()).toBe("view");
  });

  it("una scelta che risolve a un altro profilo della stessa famiglia cade", async () => {
    await start();
    const layout = await import("./state/layout");
    const { synchronize } = await import("./panels/document");
    await open("schizzo.draw");
    // La scelta si confronta risolta: senza profilo porta alla predefinita
    // del testo, il testo semplice, che non è la vista dichiarata (`svg`).
    layout.setTabOverride(layout.layout.focus, layout.activePane().active, { family: "text" });
    await synchronize();
    await settle();
    expect(await activeTab()).toEqual({ k: "doc", doc: "schizzo.draw" });
  });
});
