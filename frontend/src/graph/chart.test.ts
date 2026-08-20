// @vitest-environment happy-dom
// Test di `chart.ts`: l'orchestratore. Tutto è iniettato per determinismo:
// il pittore e l'interazione sono stub che registrano gli stati disegnati e
// le azioni; l'orologio e il `requestAnimationFrame` sono finti e si fanno
// avanzare a mano. Niente `performance.now`, niente Canvas2D, niente RO reali.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createChart, type Chart, type ChartOptions } from "./chart";
import type { GraphicsConfig, GraphConfig, GraphData, Structure } from "./sim/types";
import { defaultGraphicsConfig, organicConfig } from "./sim/types";
import type { InteractionActions, Interaction, InteractionOptions } from "./interaction";
import type { Painter, DrawState } from "./render/painter";

// --- i dati di prova --------------------------------------------------------

const DATI: GraphData = {
  nodes: ["n0", "n1", "n2", "n3"],
  edges: [
    { from: "n0", to: "n1" },
    { from: "n1", to: "n2" },
    { from: "n2", to: "n3" },
  ],
};

const CONF: GraphConfig = {
  physics: { ...organicConfig(), cooling: 0.9 },
  graphics: defaultGraphicsConfig(),
  preset: "custom",
};

// --- gli stub (con tipo nominato, non ReturnType) --------------------------

interface ChiamatePittore {
  redraw: number;
  redrawBackground: number;
  resize: number;
  destroy: number;
}

interface StubPittore extends Painter {
  states: DrawState[];
  graphics: GraphicsConfig;
  chiamate: ChiamatePittore;
}

interface ChiamateInteraction {
  destroy: number;
  setA11yLabel: number;
  focusedNode: number;
}

interface StubInteraction extends Interaction {
  actions: InteractionActions | null;
  structure: () => Structure;
  focused: number;
  chiamate: ChiamateInteraction;
}

// Le factory catturano l'ultima istanza creata, così i test possono leggerla.
let ultimoPittore: StubPittore | null = null;
let ultimaInteraction: StubInteraction | null = null;

function painterFactory(): (host: HTMLElement, graphics: GraphicsConfig) => StubPittore {
  return (host: HTMLElement, graphics: GraphicsConfig) => {
    // Il pittore vero crea i canvas; lo stub fa lo stesso perché il grafico
    // cerca `canvas.graph-main` per agganciare i listener dell'hover.
    const bg = document.createElement("canvas");
    bg.className = "graph-bg";
    const main = document.createElement("canvas");
    main.className = "graph-main";
    host.append(bg, main);
    const p: StubPittore = {
      states: [],
      graphics,
      chiamate: { redraw: 0, redrawBackground: 0, resize: 0, destroy: 0 },
      redraw(state) {
        p.chiamate.redraw++;
        p.states.push(state);
      },
      redrawBackground() {
        p.chiamate.redrawBackground++;
      },
      updateTints() {},
      resize() {
        p.chiamate.resize++;
      },
      destroy() {
        p.chiamate.destroy++;
      },
    };
    ultimoPittore = p;
    return p;
  };
}

function interactionFactory(): (o: InteractionOptions) => StubInteraction {
  return (o: InteractionOptions) => {
    const stub: StubInteraction = {
      actions: o.actions,
      structure: o.structureRef,
      focused: -1,
      chiamate: { destroy: 0, setA11yLabel: 0, focusedNode: 0 },
      destroy() {
        stub.chiamate.destroy++;
      },
      setA11yLabel() {
        stub.chiamate.setA11yLabel++;
      },
      focusedNode(i: number) {
        stub.chiamate.focusedNode++;
        stub.focused = i;
      },
      getFocusedNode() {
        return stub.focused;
      },
    };
    ultimaInteraction = stub;
    return stub;
  };
}

// --- l'orologio e il rAF finti ---------------------------------------------

interface PageWindow {
  t: number;
  queue: Array<() => void>;
  contatore: number;
  deleted: number[];
}

function emptyWindow(): PageWindow {
  return { t: 0, queue: [], contatore: 1, deleted: [] };
}

function programmaFinestra(f: PageWindow): (cb: () => void) => number {
  return (cb: () => void) => {
    const id = f.contatore++;
    f.queue.push(cb);
    return id;
  };
}

function closeWindow(f: PageWindow): (id: number) => void {
  return (id: number) => {
    f.deleted.push(id);
  };
}

/// Esegue la coda dei rAF finché si svuota o si raggiunge il tetto. L'orologio
/// avanza di 16.7 ms (≈60 fps) a ogni frame.
function esegui(f: PageWindow, max = 5000): void {
  let n = 0;
  while (f.queue.length > 0 && n < max) {
    const cb = f.queue.shift()!;
    f.t += 16.7;
    cb();
    n++;
  }
}

function fakeHost(): HTMLElement {
  return document.createElement("div");
}

function baseOptions(f: PageWindow): ChartOptions {
  return {
    data: DATI,
    config: CONF,
    createPainter: painterFactory(),
    createInteraction: interactionFactory(),
    clock: () => f.t,
    schedule: programmaFinestra(f),
    cancel: closeWindow(f),
  };
}

// --- i test ----------------------------------------------------------------

describe("createChart", () => {
  let f: PageWindow;
  let g: Chart;

  beforeEach(() => {
    f = emptyWindow();
    ultimoPittore = null;
    ultimaInteraction = null;
    g = createChart(baseOptions(f));
  });

  afterEach(() => {
    g.unmount();
    vi.unstubAllGlobals();
  });

  it("monta e disegna: la struttura ha 4 nodi e 3 archi", () => {
    g.mount(fakeHost());
    esegui(f, 5);
    expect(ultimoPittore).not.toBeNull();
    expect(ultimoPittore!.states.length).toBeGreaterThan(0);
    expect(ultimoPittore!.states[0].s.n).toBe(4);
    expect(ultimoPittore!.states[0].s.m).toBe(3);
  });

  it("il loop si spegne quando la sim si raffredda (alpha <= 0.02)", () => {
    g.mount(fakeHost());
    esegui(f, 5000);
    // Con raffreddamento 0.9 e ~60 fps, alpha decade sotto 0.02 in ~25 passi.
    expect(f.queue.length).toBe(0);
    const last = ultimoPittore!.states[ultimoPittore!.states.length - 1];
    expect(last.alpha).toBeLessThanOrEqual(0.02);
  });

  it("apri: il gestore assegnato riceve l'id quando l'interazione chiama azioni.apri", () => {
    g.mount(fakeHost());
    let chiamato = "";
    g.open = (id: string) => {
      chiamato = id;
    };
    esegui(f, 3);
    expect(ultimaInteraction).not.toBeNull();
    ultimaInteraction!.actions!.open("n2");
    expect(chiamato).toBe("n2");
  });

  it("warm: riporta alpha al livello e riaccende il loop", () => {
    g.mount(fakeHost());
    esegui(f, 5000);
    g.warm(1);
    expect(f.queue.length).toBeGreaterThan(0);
    // Un frame: alpha parte da 1 e il primo passo lo riduce di un fattore
    // di raffreddamento — ma deve restare alto (vicino a 0.9 con raffreddamento 0.9).
    esegui(f, 1);
    const last = ultimoPittore!.states[ultimoPittore!.states.length - 1];
    expect(last.alpha).toBeGreaterThanOrEqual(0.85);
  });

  it("impostaAperti: un cambio reale ridisegna; un no-change no", () => {
    g.mount(fakeHost());
    esegui(f, 5000);
    const first = ultimoPittore!.states.length;
    g.setOpenDocuments(new Set());
    esegui(f, 5);
    expect(ultimoPittore!.states.length).toBe(first);
    g.setOpenDocuments(new Set(["n1"]));
    esegui(f, 5);
    expect(ultimoPittore!.states.length).toBeGreaterThan(first);
    const last = ultimoPittore!.states[ultimoPittore!.states.length - 1];
    expect(last.openDocuments.has("n1")).toBe(true);
  });

  it("setConfig: sostituisce la physics e fonde la graphics viva (stesso rif)", () => {
    g.mount(fakeHost());
    esegui(f, 5000);
    const graphicsBefore = ultimoPittore!.graphics;
    g.setConfig({
      physics: { ...organicConfig(), repulsion: 9999, cooling: 0.9 },
      graphics: { ...defaultGraphicsConfig(), glow: false, grid: false },
      preset: "custom",
    });
    esegui(f, 5);
    expect(ultimoPittore!.graphics).toBe(graphicsBefore);
    expect(graphicsBefore.glow).toBe(false);
    expect(graphicsBefore.grid).toBe(false);
  });

  it("unpinNodes: azzera i fissi e il dragged", () => {
    g.mount(fakeHost());
    esegui(f, 3);
    const s = ultimaInteraction!.structure();
    s.fixed[0] = 1;
    s.dragged = 2;
    g.unpinNodes();
    esegui(f, 3);
    expect(s.fixed[0]).toBe(0);
    expect(s.dragged).toBe(-1);
  });

  it("il loop si spegne dopo aver rilasciato un nodo dragged", () => {
    g.mount(fakeHost());
    esegui(f, 5000);
    expect(f.queue.length).toBe(0);
    const s = ultimaInteraction!.structure();
    // Trascinato tiene il loop acceso.
    s.dragged = 0;
    g.warm(0.3);
    esegui(f, 5);
    // Rilasciato: il loop si spegne.
    s.dragged = -1;
    esegui(f, 5000);
    expect(f.queue.length).toBe(0);
  });

  it("hover: un pointermove su un nodo disegna un frame con hovered >= 0", () => {
    const host = fakeHost();
    g.mount(host);
    esegui(f, 5000);
    const canvas = host.querySelector<HTMLCanvasElement>("canvas.graph-main");
    expect(canvas).not.toBeNull();
    // La semina mette i nodi attorno all'origine in coordinate mondo.
    // getBoundingClientRect in happy-dom ritorna 0,0, quindi clientX/Y
    // passano diretti a nodeAt. Con scala 1 e traslazione 0, il nodo i è
    // a schermo in (s.x[i], s.y[i]).
    const s = ultimaInteraction!.structure();
    const before = ultimoPittore!.states.length;
    canvas!.dispatchEvent(
      new PointerEvent("pointermove", { bubbles: true, clientX: s.x[0], clientY: s.y[0] }),
    );
    esegui(f, 5);
    expect(ultimoPittore!.states.length).toBeGreaterThan(before);
    const last = ultimoPittore!.states[ultimoPittore!.states.length - 1];
    expect(last.hovered).toBeGreaterThanOrEqual(0);
  });

  it("pointerleave: azzera hovered e ridisegna", () => {
    const host = fakeHost();
    g.mount(host);
    esegui(f, 5000);
    const canvas = host.querySelector<HTMLCanvasElement>("canvas.graph-main");
    const s = ultimaInteraction!.structure();
    // Prima un move che colpisce un nodo (hovered >= 0), poi leave.
    canvas!.dispatchEvent(
      new PointerEvent("pointermove", { bubbles: true, clientX: s.x[0], clientY: s.y[0] }),
    );
    esegui(f, 5);
    const primaLeave = ultimoPittore!.states.length;
    canvas!.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
    esegui(f, 5);
    expect(ultimoPittore!.states.length).toBeGreaterThan(primaLeave);
    const last = ultimoPittore!.states[ultimoPittore!.states.length - 1];
    expect(last.hovered).toBe(-1);
  });

  it("unmount: distrugge pittore e interazione, ferma il loop", () => {
    g.mount(fakeHost());
    esegui(f, 3);
    g.unmount();
    expect(ultimoPittore!.chiamate.destroy).toBe(1);
    expect(ultimaInteraction!.chiamate.destroy).toBe(1);
    const first = ultimoPittore!.states.length;
    esegui(f, 10);
    expect(ultimoPittore!.states.length).toBe(first);
  });

  it("setA11yLabel: delega all'interazione", () => {
    g.mount(fakeHost());
    esegui(f, 3);
    g.setA11yLabel("etichetta di prova");
    expect(ultimaInteraction!.chiamate.setA11yLabel).toBe(1);
  });

  it("fit iniziale differito: con viewport 0 la camera resta a scala 1", () => {
    // happy-dom: getBoundingClientRect ritorna 0,0 → viewport 0 → fit differito.
    g.mount(fakeHost());
    esegui(f, 10);
    expect(ultimoPittore!.states[0].camera.scale).toBe(1);
  });
});