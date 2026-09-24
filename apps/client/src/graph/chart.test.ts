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
import { createInteraction } from "./interaction";
import type { Painter, DrawState } from "./render/painter";

// --- i dati di prova --------------------------------------------------------

const DATA: GraphData = {
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

interface PainterCalls {
  redraw: number;
  redrawBackground: number;
  resize: number;
  destroy: number;
}

interface StubPainter extends Painter {
  states: DrawState[];
  graphics: GraphicsConfig;
  calls: PainterCalls;
}

interface InteractionCalls {
  destroy: number;
  setA11yLabel: number;
  focusedNode: number;
}

interface StubInteraction extends Interaction {
  actions: InteractionActions | null;
  structure: () => Structure;
  focused: number;
  calls: InteractionCalls;
}

// Le factory catturano l'ultima istanza creata, così i test possono leggerla.
let lastPainter: StubPainter | null = null;
let lastInteraction: StubInteraction | null = null;

function painterFactory(): (host: HTMLElement, graphics: GraphicsConfig) => StubPainter {
  return (host: HTMLElement, graphics: GraphicsConfig) => {
    // Il pittore vero crea i canvas; lo stub fa lo stesso perché il grafico
    // cerca `canvas.graph-main` per agganciare i listener dell'hover.
    const bg = document.createElement("canvas");
    bg.className = "graph-bg";
    const main = document.createElement("canvas");
    main.className = "graph-main";
    host.append(bg, main);
    const p: StubPainter = {
      states: [],
      graphics,
      calls: { redraw: 0, redrawBackground: 0, resize: 0, destroy: 0 },
      redraw(state) {
        p.calls.redraw++;
        p.states.push(state);
      },
      redrawBackground() {
        p.calls.redrawBackground++;
      },
      updateTints() {},
      resize() {
        p.calls.resize++;
      },
      destroy() {
        p.calls.destroy++;
      },
    };
    lastPainter = p;
    return p;
  };
}

function interactionFactory(): (o: InteractionOptions) => StubInteraction {
  return (o: InteractionOptions) => {
    const stub: StubInteraction = {
      actions: o.actions,
      structure: o.structureRef,
      focused: -1,
      calls: { destroy: 0, setA11yLabel: 0, focusedNode: 0 },
      destroy() {
        stub.calls.destroy++;
      },
      setA11yLabel() {
        stub.calls.setA11yLabel++;
      },
      focusedNode(i: number) {
        stub.calls.focusedNode++;
        stub.focused = i;
      },
      getFocusedNode() {
        return stub.focused;
      },
    };
    lastInteraction = stub;
    return stub;
  };
}

// --- l'orologio e il rAF finti ---------------------------------------------

interface PageWindow {
  t: number;
  queue: Array<() => void>;
  counter: number;
  deleted: number[];
}

function emptyWindow(): PageWindow {
  return { t: 0, queue: [], counter: 1, deleted: [] };
}

function scheduleWindow(f: PageWindow): (cb: () => void) => number {
  return (cb: () => void) => {
    const id = f.counter++;
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
function run(f: PageWindow, max = 5000): number {
  let n = 0;
  while (f.queue.length > 0 && n < max) {
    const cb = f.queue.shift()!;
    f.t += 16.7;
    cb();
    n++;
  }
  return n;
}

/// Come `run`, ma con un passo scelto dal test per esercitare il clamp del dt.
function runAt(f: PageWindow, dtMs: number, max = 5000): number {
  let n = 0;
  while (f.queue.length > 0 && n < max) {
    const cb = f.queue.shift()!;
    f.t += dtMs;
    cb();
    n++;
  }
  return n;
}

function fakeHost(): HTMLElement {
  return document.createElement("div");
}

function baseOptions(f: PageWindow): ChartOptions {
  return {
    data: DATA,
    config: CONF,
    createPainter: painterFactory(),
    createInteraction: interactionFactory(),
    clock: () => f.t,
    schedule: scheduleWindow(f),
    cancel: closeWindow(f),
  };
}

// --- i test ----------------------------------------------------------------

describe("createChart", () => {
  let f: PageWindow;
  let g: Chart;

  beforeEach(() => {
    f = emptyWindow();
    lastPainter = null;
    lastInteraction = null;
    g = createChart(baseOptions(f));
  });

  afterEach(() => {
    g.unmount();
    vi.unstubAllGlobals();
  });

  it("monta e disegna: la struttura ha 4 nodi e 3 archi", () => {
    g.mount(fakeHost());
    run(f, 5);
    expect(lastPainter).not.toBeNull();
    expect(lastPainter!.states.length).toBeGreaterThan(0);
    expect(lastPainter!.states[0].s.n).toBe(4);
    expect(lastPainter!.states[0].s.m).toBe(3);
  });

  it("il loop si spegne quando la sim si raffredda (alpha <= 0.02)", () => {
    g.mount(fakeHost());
    run(f, 5000);
    // Con raffreddamento 0.9 e ~60 fps, alpha decade sotto 0.02 in ~25 passi.
    expect(f.queue.length).toBe(0);
    const last = lastPainter!.states[lastPainter!.states.length - 1];
    expect(last.alpha).toBeLessThanOrEqual(0.02);
  });


  it("warm: riporta alpha al livello e riaccende il loop", () => {
    g.mount(fakeHost());
    run(f, 5000);
    g.warm(1);
    expect(f.queue.length).toBeGreaterThan(0);
    // Un frame: alpha parte da 1 e il primo passo lo riduce di un fattore
    // di raffreddamento — ma deve restare alto (vicino a 0.9 con raffreddamento 0.9).
    run(f, 1);
    const last = lastPainter!.states[lastPainter!.states.length - 1];
    expect(last.alpha).toBeGreaterThanOrEqual(0.85);
  });

  it("Riscalda mantiene il loop attivo per 120 callback al dt massimo", () => {
    g.mount(fakeHost());
    g.setConfig({
      ...CONF,
      physics: { ...CONF.physics, cooling: 0.985 },
    });
    run(f, 5000);
    g.warm(1);
    const before = lastPainter!.states.length;

    const callbacks = runAt(f, 1000 / 30, 120);

    expect(callbacks).toBe(120);
    expect(lastPainter!.states.length).toBeGreaterThanOrEqual(before + 120);
    expect(f.queue.length).toBeGreaterThan(0);
  });

  it("impostaAperti: un cambio reale ridisegna; un no-change no", () => {
    g.mount(fakeHost());
    run(f, 5000);
    const first = lastPainter!.states.length;
    g.setOpenDocuments(new Set());
    run(f, 5);
    expect(lastPainter!.states.length).toBe(first);
    g.setOpenDocuments(new Set(["n1"]));
    run(f, 5);
    expect(lastPainter!.states.length).toBeGreaterThan(first);
    const last = lastPainter!.states[lastPainter!.states.length - 1];
    expect(last.openDocuments.has("n1")).toBe(true);
  });

  it("il pittore vede le modifiche grafiche applicate dopo il mount", () => {
    g.mount(fakeHost());
    run(f, 5000);
    const graphicsBefore = lastPainter!.graphics;
    g.setConfig({
      physics: { ...organicConfig(), repulsion: 9999, cooling: 0.9 },
      graphics: { ...defaultGraphicsConfig(), glow: false, grid: false },
      preset: "custom",
    });
    run(f, 5);
    expect(graphicsBefore.glow).toBe(false);
    expect(graphicsBefore.grid).toBe(false);
  });

  it("unpinNodes: azzera i fissi e il dragged", () => {
    g.mount(fakeHost());
    run(f, 3);
    const s = lastInteraction!.structure();
    s.fixed[0] = 1;
    s.dragged = 2;
    g.unpinNodes();
    run(f, 3);
    expect(s.fixed[0]).toBe(0);
    expect(s.dragged).toBe(-1);
  });

  it("il loop si spegne dopo aver rilasciato un nodo dragged", () => {
    g.mount(fakeHost());
    run(f, 5000);
    expect(f.queue.length).toBe(0);
    const s = lastInteraction!.structure();
    // Trascinato tiene il loop acceso.
    s.dragged = 0;
    g.warm(0.3);
    run(f, 5);
    // Rilasciato: il loop si spegne.
    s.dragged = -1;
    run(f, 5000);
    expect(f.queue.length).toBe(0);
  });

  it("hover: un pointermove su un nodo disegna un frame con hovered >= 0", () => {
    const host = fakeHost();
    g.mount(host);
    run(f, 5000);
    const canvas = host.querySelector<HTMLCanvasElement>("canvas.graph-main");
    expect(canvas).not.toBeNull();
    // La semina mette i nodi attorno all'origine in coordinate mondo.
    // getBoundingClientRect in happy-dom ritorna 0,0, quindi clientX/Y
    // passano diretti a nodeAt. Con scala 1 e traslazione 0, il nodo i è
    // a schermo in (s.x[i], s.y[i]).
    const s = lastInteraction!.structure();
    const before = lastPainter!.states.length;
    canvas!.dispatchEvent(
      new PointerEvent("pointermove", { bubbles: true, clientX: s.x[0], clientY: s.y[0] }),
    );
    run(f, 5);
    expect(lastPainter!.states.length).toBeGreaterThan(before);
    const last = lastPainter!.states[lastPainter!.states.length - 1];
    expect(last.hovered).toBeGreaterThanOrEqual(0);
  });

  it("pointerleave: azzera hovered e ridisegna", () => {
    const host = fakeHost();
    g.mount(host);
    run(f, 5000);
    const canvas = host.querySelector<HTMLCanvasElement>("canvas.graph-main");
    const s = lastInteraction!.structure();
    // Prima un move che colpisce un nodo (hovered >= 0), poi leave.
    canvas!.dispatchEvent(
      new PointerEvent("pointermove", { bubbles: true, clientX: s.x[0], clientY: s.y[0] }),
    );
    run(f, 5);
    const firstLeave = lastPainter!.states.length;
    canvas!.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
    run(f, 5);
    expect(lastPainter!.states.length).toBeGreaterThan(firstLeave);
    const last = lastPainter!.states[lastPainter!.states.length - 1];
    expect(last.hovered).toBe(-1);
  });

  it("unmount: distrugge pittore e interazione, ferma il loop", () => {
    g.mount(fakeHost());
    run(f, 3);
    g.unmount();
    expect(lastPainter!.calls.destroy).toBe(1);
    expect(lastInteraction!.calls.destroy).toBe(1);
    const first = lastPainter!.states.length;
    run(f, 10);
    expect(lastPainter!.states.length).toBe(first);
  });


  it("inquadra tutti i nodi nel primo frame con una superficie visibile", () => {
    const host = fakeHost();
    let rect = new DOMRect(0, 0, 0, 0);
    host.getBoundingClientRect = () => rect;
    g.mount(host);
    run(f, 1);

    rect = new DOMRect(0, 0, 800, 600);
    run(f, 1);

    const { s, camera } = lastPainter!.states[lastPainter!.states.length - 1];
    for (let i = 0; i < s.n; i++) {
      const x = s.x[i] * camera.scale + camera.tx;
      const y = s.y[i] * camera.scale + camera.ty;
      expect(x).toBeGreaterThan(20);
      expect(x).toBeLessThan(rect.width - 20);
      expect(y).toBeGreaterThan(20);
      expect(y).toBeLessThan(rect.height - 20);
    }
  });

  it("dopo che l'utente ha mosso la vista, un riscaldo non la reinquadra da solo", () => {
    // `warm` riarmava il fit alla quiete: dopo ogni nodo rilasciato, o dopo
    // un pan durante l'assestamento, la vista saltava a inquadrare tutto
    // appena il grafo si fermava.
    g.unmount();
    g = createChart({
      ...baseOptions(f),
      createInteraction,
      config: { ...CONF, physics: organicConfig() },
    });
    const host = fakeHost();
    host.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600);
    g.mount(host);
    run(f);
    const canvas = host.querySelector<HTMLCanvasElement>("canvas.graph-main")!;
    canvas.getBoundingClientRect = host.getBoundingClientRect;
    canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    run(f);
    const moved = lastPainter!.states[lastPainter!.states.length - 1].camera;

    g.warm(1);
    run(f);

    const after = lastPainter!.states[lastPainter!.states.length - 1].camera;
    // Resta dov'era, a meno della coda dell'inseguimento (il reinquadramento
    // spostava la scala di quasi un'unità).
    expect(after.scale).toBeCloseTo(moved.scale, 3);
    expect(Math.abs(after.tx - moved.tx)).toBeLessThan(1);
    expect(Math.abs(after.ty - moved.ty)).toBeLessThan(1);
  });

  it("i risvegli del loop non contano come frame lenti: il livello resta quello del grafo", () => {
    // Ogni risveglio misurava la pausa come un frame da 33 ms: dopo qualche
    // hover o click la media superava 22 ms e un grafo di quattro note
    // passava al livello lento, con le etichette minori spente.
    g.mount(fakeHost());
    run(f);
    for (let k = 0; k < 20; k++) {
      f.t += 5000;
      g.setOpenDocuments(new Set(k % 2 === 0 ? ["n0"] : []));
      run(f);
    }
    expect(lastPainter!.states[lastPainter!.states.length - 1].tier).toBe(1);
  });

  it("lo zoom da tastiera converge entro un secondo e resta centrato", () => {
    g.unmount();
    g = createChart({ ...baseOptions(f), createInteraction });
    const host = fakeHost();
    host.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600);
    g.mount(host);
    run(f);
    const before = lastPainter!.states[lastPainter!.states.length - 1].camera;
    const point = { x: (400 - before.tx) / before.scale, y: (300 - before.ty) / before.scale };
    const canvas = host.querySelector<HTMLCanvasElement>("canvas.graph-main")!;
    canvas.getBoundingClientRect = host.getBoundingClientRect;

    canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "+" }));
    runAt(f, 1000 / 60, 60);

    const after = lastPainter!.states[lastPainter!.states.length - 1].camera;
    expect(after.scale).toBeGreaterThan(before.scale);
    expect(Math.abs(point.x * after.scale + after.tx - 400)).toBeLessThan(1);
    expect(Math.abs(point.y * after.scale + after.ty - 300)).toBeLessThan(1);
    expect(f.queue).toHaveLength(0);
  });

  it("U46: focusNode seleziona dagli stessi dati, notifica e legge id/conto", () => {
    g.mount(fakeHost());
    run(f, 3);
    expect(g.nodeCount()).toBe(4);
    expect(g.focusedNode()).toBe(-1);
    expect(g.nodeId(0)).toBe("n0");
    expect(g.nodeId(99)).toBeNull();
    const seen: number[] = [];
    g.onFocusChange = (index: number) => seen.push(index);
    g.focusNode(2);
    expect(g.focusedNode()).toBe(2);
    expect(seen).toEqual([2]);
    // Fuori indice = no-op, mai una notifica spuria.
    g.focusNode(99);
    expect(g.focusedNode()).toBe(2);
    expect(seen).toEqual([2]);
  });

  it("U46: la selezione da tastiera passa dal frame all'osservatore una volta sola", () => {
    g.mount(fakeHost());
    const seen: number[] = [];
    g.onFocusChange = (index: number) => seen.push(index);
    run(f, 3);
    // Il primo frame notifica lo stato iniziale (−1) una volta sola.
    expect(seen).toEqual([-1]);
    lastInteraction!.focused = 1;
    run(f, 5);
    expect(seen).toEqual([-1, 1]);
    // Nessuna notifica ripetuta a selezione ferma: l'osservatore resta muto
    // anche se il loop disegna ancora (camera in convergenza o sim calda).
    const announced = seen.length;
    run(f, 5);
    expect(seen).toHaveLength(announced);
  });
});