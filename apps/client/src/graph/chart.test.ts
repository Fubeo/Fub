// @vitest-environment happy-dom
// Test di `chart.ts`: l'orchestratore. Tutto è iniettato per determinismo:
// il pittore e l'interazione sono stub che registrano gli stati disegnati e
// le azioni; l'orologio e il `requestAnimationFrame` sono finti e si fanno
// avanzare a mano. Niente `performance.now`, niente Canvas2D, niente RO reali.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createChart, type Chart, type ChartOptions } from "./chart";
import { createFramePacer } from "../theme/frame-rate";
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

  it("a 144 Hz il livello resta quello del grafo: nessuna repulsione esatta su mille nodi", () => {
    // I frame da 7 ms portavano l'EMA sotto 12 ms e il livello sopra la base:
    // mille nodi tornavano alla repulsione esatta, rallentavano, e il livello
    // rimbalzava.
    g.unmount();
    const nodes = Array.from({ length: 1000 }, (_, i) => "n" + i);
    g = createChart({ ...baseOptions(f), data: { nodes, edges: [] } });
    g.mount(fakeHost());
    runAt(f, 1000 / 144, 60);
    const tiers = new Set(lastPainter!.states.map((state) => state.tier));
    expect([...tiers]).toEqual([2]);
  });

  it("col tetto dei fotogrammi il loop salta i callback di troppo e la sim avanza per tempo", () => {
    g.unmount();
    g = createChart({ ...baseOptions(f), pacer: createFramePacer(() => 30) });
    g.mount(fakeHost());
    // uno schermo a 120 Hz: un callback su quattro diventa un fotogramma
    const callbacks = runAt(f, 1000 / 120);
    const drawn = lastPainter!.states;
    expect(drawn.length).toBeGreaterThan(10);
    expect(Math.abs(drawn.length - callbacks / 4)).toBeLessThanOrEqual(1);
    // ogni fotogramma disegnato dura un periodo del tetto
    for (const state of drawn.slice(2)) expect(state.frameMs).toBeCloseTo(1000 / 30, 6);
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

  it("un layout ripreso rimette posizioni, pin e vista senza rifare la semina", () => {
    // Tornare alla linguetta del grafo ricreava tutto: la stessa animazione
    // da capo, la vista reinquadrata e i pin persi.
    expect(g.snapshot()).toBeNull();
    const host = fakeHost();
    host.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600);
    g.mount(host);
    run(f);
    const first = lastInteraction!.structure();
    first.fixed[1] = 1;
    const x = Array.from(first.x);
    const y = Array.from(first.y);
    const seen = lastPainter!.states[lastPainter!.states.length - 1].camera;
    const center = { x: (400 - seen.tx) / seen.scale, y: (300 - seen.ty) / seen.scale };
    const saved = g.snapshot()!;
    g.unmount();

    g = createChart({ ...baseOptions(f), layout: saved });
    const wider = fakeHost();
    wider.getBoundingClientRect = () => new DOMRect(0, 0, 1000, 700);
    g.mount(wider);
    const frames = run(f);

    // Un grafo già fermo resta fermo: un fotogramma, poi il loop dorme.
    expect(frames).toBe(1);
    expect(f.queue).toHaveLength(0);
    const again = lastInteraction!.structure();
    expect(Array.from(again.x)).toEqual(x);
    expect(Array.from(again.y)).toEqual(y);
    expect(again.fixed[1]).toBe(1);
    // La stessa inquadratura, al centro della vista di adesso.
    const camera = lastPainter!.states[lastPainter!.states.length - 1].camera;
    expect(camera.scale).toBe(seen.scale);
    expect((500 - camera.tx) / camera.scale).toBeCloseTo(center.x, 6);
    expect((350 - camera.ty) / camera.scale).toBeCloseTo(center.y, 6);
  });

  it("il quartiere si accende e si spegne in dissolvenza, poi il loop dorme", () => {
    // Acceso e spento di colpo, passare col puntatore su un grafo fitto lo
    // faceva lampeggiare a ogni nodo attraversato.
    const host = fakeHost();
    g.mount(host);
    run(f);
    const canvas = host.querySelector<HTMLCanvasElement>("canvas.graph-main")!;
    const s = lastInteraction!.structure();
    const last = (): DrawState => lastPainter!.states[lastPainter!.states.length - 1];

    canvas.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: s.x[0], clientY: s.y[0] }));
    run(f, 1);
    const node = last().hovered;
    expect(node).toBeGreaterThanOrEqual(0);
    expect(last().highlightNode).toBe(node);
    expect(last().highlight).toBeGreaterThan(0);
    expect(last().highlight).toBeLessThan(1);
    run(f);
    expect(last().highlight).toBe(1);
    expect(f.queue).toHaveLength(0);

    canvas.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
    run(f, 1);
    // Il puntatore se n'è andato, ma il quartiere sfuma attorno allo stesso nodo.
    expect(last().hovered).toBe(-1);
    expect(last().highlightNode).toBe(node);
    expect(last().highlight).toBeGreaterThan(0);
    expect(last().highlight).toBeLessThan(1);
    run(f);
    expect(last().highlight).toBe(0);
    expect(last().highlightNode).toBe(-1);
    expect(f.queue).toHaveLength(0);
  });

  it("un resize tiene fermo il centro della vista e ridisegna subito", () => {
    // Ridimensionare un canvas lo svuota: aspettare il rAF successivo
    // lasciava un fotogramma vuoto, e dividere il riquadro faceva scivolare
    // il grafo verso l'angolo in alto a sinistra.
    let observed: (() => void) | null = null;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          observed = callback;
        }
        observe(): void {}
        disconnect(): void {}
      },
    );
    g.unmount();
    g = createChart(baseOptions(f));
    let rect = new DOMRect(0, 0, 800, 600);
    const host = fakeHost();
    host.getBoundingClientRect = () => rect;
    g.mount(host);
    run(f);
    const before = lastPainter!.states[lastPainter!.states.length - 1].camera;
    const center = { x: (400 - before.tx) / before.scale, y: (300 - before.ty) / before.scale };
    const drawn = lastPainter!.states.length;

    rect = new DOMRect(0, 0, 500, 600);
    observed!();

    expect(lastPainter!.states.length).toBe(drawn + 1);
    // A meno della coda dell'inseguimento della camera: senza la correzione
    // il centro scivolava di 150 px di schermo.
    const after = lastPainter!.states[lastPainter!.states.length - 1].camera;
    expect(after.scale).toBeCloseTo(before.scale, 3);
    expect(Math.abs((250 - after.tx) / after.scale - center.x)).toBeLessThan(0.5);
    expect(Math.abs((300 - after.ty) / after.scale - center.y)).toBeLessThan(0.5);
  });
});
