// @vitest-environment happy-dom
// Test dell'interazione, in due strati come il modulo:
// - funzioni pure (`nodeAt`, `aggiornaDrag`): nessun DOM, nessun Canvas2D;
//   `nodeAt` con scala ≠ 1 era il bug storico (hit-test ignorava la scala).
// - wiring (`creaInterazione`): un canvas happy-dom reale, ma con
//   `addEventListener` che registra gli handler in una mappa e
//   `getBoundingClientRect` mockato — si emettono eventi finti e si guarda
//   cosa succede a struttura, camera e azioni.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { Structure } from "./sim/types";
import { createCameraState } from "./render/camera";
import { updateDrag, createInteraction, nodeAt, initialDragState, type InteractionActions, type DragResult, type DragState } from "./interaction";

/// Tre nodi: a(0,0) b(100,0) c(-50,60), raggio 8, archi a→b, b→c.
function testStructure(): Structure {
  return {
    x: new Float32Array([0, 100, -50]),
    y: new Float32Array([0, 0, 60]),
    vx: new Float32Array(3),
    vy: new Float32Array(3),
    fx: new Float32Array(3),
    fy: new Float32Array(3),
    px: new Float32Array(3),
    py: new Float32Array(3),
    mass: new Float32Array([1, 1, 1]),
    radius: new Float32Array([8, 8, 8]),
    degree: new Uint16Array([2, 1, 1]),
    fixed: new Uint8Array([0, 0, 0]),
    dragged: -1,
    id: ["a", "b", "c"],
    from: new Uint32Array([0, 1]),
    to: new Uint32Array([1, 2]),
    curvature: new Float32Array([0.1, -0.1]),
    n: 3,
    m: 2,
  };
}

type Handler = (e: Record<string, unknown>) => void;

/// Un canvas finto: il canvas reale di happy-dom con gli slot di eventi
/// intercettati (getContext resta null, ma l'interazione non lo usa).
function fakeCanvas() {
  const canvas = document.createElement("canvas");
  const handlers = new Map<string, Handler>();
  canvas.addEventListener = ((type: string, fn: unknown) => {
    handlers.set(type, fn as Handler);
  }) as typeof canvas.addEventListener;
  canvas.removeEventListener = ((type: string) => {
    handlers.delete(type);
  }) as typeof canvas.removeEventListener;
  canvas.setPointerCapture = vi.fn() as unknown as typeof canvas.setPointerCapture;
  canvas.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  const emit = (type: string, init: Record<string, unknown> = {}): Handler => {
    const fn = handlers.get(type);
    if (!fn) throw new Error(`nessun handler registrato per "${type}"`);
    fn({ preventDefault: () => {}, ...init });
    return fn;
  };
  return { canvas, handlers, emit };
}

describe("nodeAt (hit-test puro, screen space)", () => {
  it("trova il nodo con scala ≠ 1 e traslazione", () => {
    const s = testStructure();
    // scala 2: nodo a in (0,0) schermo; click a 15px → mondo 7.5 → entro r+6
    expect(nodeAt(s, { scale: 2, tx: 0, ty: 0 }, 0, 15)).toBe(0);
    // scala 1: lo stesso click a 15px è fuori dalla soglia 8+6=14 → miss
    expect(nodeAt(s, { scale: 1, tx: 0, ty: 0 }, 0, 15)).toBe(-1);
    // traslazione: con tx=-100 il nodo b(100,0) sta in (0,0) schermo
    expect(nodeAt(s, { scale: 1, tx: -100, ty: 0 }, 0, 0)).toBe(1);
  });

  it("rispetta la soglia r+6 in px di schermo", () => {
    const s = testStructure();
    expect(nodeAt(s, { scale: 1, tx: 0, ty: 0 }, 13.9, 0)).toBe(0); // < 14
    expect(nodeAt(s, { scale: 1, tx: 0, ty: 0 }, 15, 0)).toBe(-1); // 15 > 14
    expect(nodeAt(s, { scale: 1, tx: 0, ty: 0 }, 500, 500)).toBe(-1); // fuori da tutto
  });

  it("sceglie il nodo più vicino quando due sono in soglia", () => {
    const s = testStructure();
    expect(nodeAt(s, { scale: 1, tx: 0, ty: 0 }, 90, 0)).toBe(1); // vicino a b(100,0)
    // struttura con due nodi vicini: a(0,0) e b(5,0), puntatore a (4,0) —
    // entrambi in soglia r+6=14, vince il più vicino (b a 1, a a 4).
    const neighbors: Structure = { ...testStructure(), x: new Float32Array([0, 5]), y: new Float32Array([0, 0]), n: 2 };
    expect(nodeAt(neighbors, { scale: 1, tx: 0, ty: 0 }, 4, 0)).toBe(1);
  });
});

describe("updateDrag (macchina a stati pura)", () => {
  const hit = (x: number, y: number): number => nodeAt(testStructure(), { scale: 1, tx: 0, ty: 0 }, x, y);
  const s2m = (x: number, y: number): { x: number; y: number } => ({ x, y });

  it("hover su move senza down, pulito dal leave (bug 2-2)", () => {
    let st = initialDragState();
    st = updateDrag(st, { type: "move", x: 5, y: 5, button: 0 }, hit, s2m).state;
    expect(st.hovered).toBe(0);
    st = updateDrag(st, { type: "move", x: 320, y: 310, button: 0 }, hit, s2m).state;
    expect(st.hovered).toBe(-1);
    st = updateDrag(st, { type: "leave", x: 0, y: 0, button: 0 }, hit, s2m).state;
    expect(st.hovered).toBe(-1);
  });

  it("down su nodo → drag; move produce bersaglio mondo; up rilascia", () => {
    let st = initialDragState();
    st = updateDrag(st, { type: "down", x: 5, y: 5, button: 0 }, hit, s2m).state;
    expect(st.dragged).toBe(0);
    expect(st.hovered).toBe(-1); // il drag toglie l'hover
    const es: DragResult = updateDrag(st, { type: "move", x: 50, y: 40, button: 0 }, hit, s2m);
    expect(es.target).toEqual({ x: 50, y: 40 });
    expect(es.panDx).toBe(0);
    st = updateDrag(es.state, { type: "up", x: 50, y: 40, button: 0 }, hit, s2m).state;
    expect(st.dragged).toBe(-1);
  });

  it("down su vuoto → pan con delta; un secondo down durante il pan viene ignorato", () => {
    let st = initialDragState();
    st = updateDrag(st, { type: "down", x: 300, y: 300, button: 0 }, hit, s2m).state;
    expect(st.draggingEmpty).toBe(true);
    // secondo down mentre si pana: ignorato (niente drag sul vuoto già attivo)
    st = updateDrag(st, { type: "down", x: 310, y: 300, button: 0 }, hit, s2m).state;
    expect(st.draggingEmpty).toBe(true);
    expect(st.dragged).toBe(-1);
    const es: DragResult = updateDrag(st, { type: "move", x: 320, y: 310, button: 0 }, hit, s2m);
    // il secondo down ha ribasato la base a (310,300): il delta è (10,10)
    expect(es.panDx).toBe(10);
    expect(es.panDy).toBe(10);
    st = updateDrag(es.state, { type: "up", x: 320, y: 310, button: 0 }, hit, s2m).state;
    expect(st.draggingEmpty).toBe(false);
  });

  it("tasto centrale → pan anche sopra un nodo; il leave non spezza il drag", () => {
    let st = initialDragState();
    st = updateDrag(st, { type: "down", x: 5, y: 5, button: 1 }, hit, s2m).state;
    expect(st.draggingEmpty).toBe(true);
    expect(st.dragged).toBe(-1);
    // leave durante il drag: il drag resta (con setPointerCapture non arriva,
    // ma se arrivasse non deve spezzare la presa)
    st = updateDrag(st, { type: "leave", x: 0, y: 0, button: 0 }, hit, s2m).state;
    expect(st.draggingEmpty).toBe(true);
    const es: DragResult = updateDrag(st, { type: "move", x: 15, y: 5, button: 0 }, hit, s2m);
    expect(es.panDx).toBe(10);
  });

  it("è pura: lo stato in ingresso non viene mutato", () => {
    const first: DragState = initialDragState();
    const frozen = { ...first };
    updateDrag(first, { type: "down", x: 5, y: 5, button: 0 }, hit, s2m);
    expect(first).toEqual(frozen);
  });
});

describe("createInteraction (wiring su canvas finto)", () => {
  let s: Structure;
  let cs: ReturnType<typeof createCameraState>;
  let actions: InteractionActions & { open: ReturnType<typeof vi.fn>; warm: ReturnType<typeof vi.fn>; requestRedraw: ReturnType<typeof vi.fn> };
  let canvas: ReturnType<typeof fakeCanvas>["canvas"];
  let emit: ReturnType<typeof fakeCanvas>["emit"];
  let interaction: ReturnType<typeof createInteraction>;

  beforeEach(() => {
    vi.useFakeTimers();
    s = testStructure();
    cs = createCameraState();
    actions = {
      open: vi.fn(),
      warm: vi.fn(),
      requestRedraw: vi.fn(),
    } as InteractionActions & {
      open: ReturnType<typeof vi.fn>;
      warm: ReturnType<typeof vi.fn>;
      requestRedraw: ReturnType<typeof vi.fn>;
    };
    const f = fakeCanvas();
    canvas = f.canvas;
    emit = f.emit;
    interaction = createInteraction({ canvas, structureRef: () => s, cameraState: cs, actions });
  });

  afterEach(() => {
    vi.useRealTimers();
    interaction.destroy();
  });

  it("drag di un nodo: presa oltre la soglia, dal punto afferrato, rilascio col fixed precedente", () => {
    emit("pointerdown", { clientX: 5, clientY: 5, button: 0, pointerId: 7 });
    // Il pointerdown non afferra: potrebbe essere un click.
    expect(s.dragged).toBe(-1);
    expect(s.fixed[0]).toBe(0);
    expect(actions.warm).not.toHaveBeenCalled();
    expect(canvas.setPointerCapture).toHaveBeenCalledWith(7);

    emit("pointermove", { clientX: 6, clientY: 6, button: 0, pointerId: 7 });
    expect(s.dragged).toBe(-1); // sotto la soglia

    emit("pointermove", { clientX: 50, clientY: 40, button: 0, pointerId: 7 });
    expect(s.dragged).toBe(0);
    expect(s.fixed[0]).toBe(2);
    expect(actions.warm).toHaveBeenCalled();
    // Il nodo (0,0) era afferrato in (5,5): segue il puntatore con quello
    // scarto, invece di saltare col centro sotto il cursore.
    expect(s.px[0]).toBeCloseTo(45);
    expect(s.py[0]).toBeCloseTo(35);

    s.vx[0] = 600;
    emit("pointerup", { clientX: 50, clientY: 40, button: 0, pointerId: 7 });
    expect(s.dragged).toBe(-1);
    expect(s.fixed[0]).toBe(0); // torna com'era: il drag non lascia pin
    expect(s.vx[0]).toBeCloseTo(120); // il rilascio non lancia il nodo
  });

  it("un click su un nodo non lo afferra e non scalda il grafo", () => {
    emit("pointerdown", { clientX: 5, clientY: 5, button: 0 });
    emit("pointerup", { clientX: 5, clientY: 5, button: 0 });
    expect(s.dragged).toBe(-1);
    expect(s.fixed[0]).toBe(0);
    expect(s.px[0]).toBe(0);
    expect(actions.warm).not.toHaveBeenCalled();
  });

  it("drag non cancella un pin esplicito: il fixed torna 1 al rilascio", () => {
    s.fixed[0] = 1; // pin fatto prima (doppio click)
    emit("pointerdown", { clientX: 5, clientY: 5, button: 0 });
    emit("pointermove", { clientX: 60, clientY: 30, button: 0 });
    expect(s.fixed[0]).toBe(2); // il drag vince durante la presa
    emit("pointerup", { clientX: 60, clientY: 30, button: 0 });
    expect(s.fixed[0]).toBe(1); // il pin esplicito sopravvive al drag
  });

  it("pan su vuoto: la vista segue il puntatore, poi scorre con la velocità del gesto", () => {
    emit("pointerdown", { clientX: 300, clientY: 300, button: 0, timeStamp: 1000 });
    emit("pointermove", { clientX: 310, clientY: 305, button: 0, timeStamp: 1016 });
    emit("pointermove", { clientX: 320, clientY: 310, button: 0, timeStamp: 1032 });
    // Durante il gesto la vista è attaccata al puntatore, senza inerzia.
    expect(cs.state().tx).toBeCloseTo(20);
    expect(cs.state().ty).toBeCloseTo(10);
    emit("pointerup", { clientX: 320, clientY: 310, button: 0, timeStamp: 1040 });
    expect(cs.ready()).toBe(false); // inerzia in corso
    let last = cs.state().tx;
    for (let i = 0; i < 300; i++) {
      const tx = cs.step(16.7).tx;
      // Scorre sempre in avanti: nessun ritorno elastico.
      expect(tx).toBeGreaterThanOrEqual(last - 1e-9);
      last = tx;
    }
    expect(cs.ready()).toBe(true);
    // 20 px in 32 ms → 0.625 px/ms, per τ = 300 ms: circa 190 px in più.
    expect(cs.state().tx).toBeCloseTo(20 + 0.625 * 300, -1);
  });

  it("un pan rilasciato da fermo non ha inerzia", () => {
    emit("pointerdown", { clientX: 300, clientY: 300, button: 0, timeStamp: 1000 });
    emit("pointermove", { clientX: 320, clientY: 310, button: 0, timeStamp: 1016 });
    emit("pointerup", { clientX: 320, clientY: 310, button: 0, timeStamp: 1400 });
    expect(cs.ready()).toBe(true);
    expect(cs.state().tx).toBeCloseTo(20);
  });

  it("click su nodo (senza trascinamento) apre la nota e focalizza", () => {
    emit("pointerdown", { clientX: 5, clientY: 5, button: 0 });
    emit("pointerup", { clientX: 5, clientY: 5, button: 0 });
    emit("click", { clientX: 5, clientY: 5 });
    expect(actions.open).not.toHaveBeenCalled(); // il click è ritardato: attende il dblclick
    vi.advanceTimersByTime(260);
    expect(actions.open).toHaveBeenCalledWith("a");
    expect(interaction.getFocusedNode()).toBe(0);
  });

  it("il click apre il nodo che stava sotto il puntatore, anche se poi si sposta", () => {
    emit("pointerdown", { clientX: 5, clientY: 5, button: 0 });
    emit("pointerup", { clientX: 5, clientY: 5, button: 0 });
    emit("click", { clientX: 5, clientY: 5 });
    // Nel quarto di secondo d'attesa la sim porta via il nodo.
    s.x[0] = 400;
    vi.advanceTimersByTime(260);
    expect(actions.open).toHaveBeenCalledWith("a");
  });

  it("la rotella conta i pixel qualunque sia l'unità, e il pinch del trackpad pesa di più", () => {
    emit("wheel", { deltaY: -3, deltaMode: 1, clientX: 400, clientY: 300, preventDefault: () => {} });
    for (let i = 0; i < 300; i++) cs.step(16.7);
    expect(cs.state().scale).toBeCloseTo(Math.exp(48 * 0.0015), 3); // 3 righe = 48 px
    const before = cs.state().scale;
    emit("wheel", { deltaY: -10, ctrlKey: true, clientX: 400, clientY: 300, preventDefault: () => {} });
    for (let i = 0; i < 300; i++) cs.step(16.7);
    expect(cs.state().scale / before).toBeCloseTo(Math.exp(0.1), 3);
    // Un colpo enorme non catapulta: il passo è limitato.
    const capped = cs.state().scale;
    emit("wheel", { deltaY: -5000, clientX: 400, clientY: 300, preventDefault: () => {} });
    for (let i = 0; i < 300; i++) cs.step(16.7);
    expect(cs.state().scale / capped).toBeCloseTo(Math.exp(0.5), 3);
  });

  it("click dopo un drag con spostamento non apre (gesto, non click)", () => {
    emit("pointerdown", { clientX: 5, clientY: 5, button: 0 });
    emit("pointermove", { clientX: 60, clientY: 60, button: 0 });
    emit("pointerup", { clientX: 60, clientY: 60, button: 0 });
    emit("click", { clientX: 60, clientY: 60 });
    vi.advanceTimersByTime(260);
    expect(actions.open).not.toHaveBeenCalled();
  });

  it("pinch a due dita: zoom sul punto medio, il pan del primo dito si smonta", () => {
    emit("pointerdown", { clientX: 200, clientY: 200, button: 0, pointerId: 1 });
    expect(s.dragged).toBe(-1); // su vuoto → pan
    emit("pointerdown", { clientX: 400, clientY: 200, button: 0, pointerId: 2 });
    // il secondo dito smonta il pan e parte il pinch (distanza base 200)
    expect(s.dragged).toBe(-1);
    // allargamento: distanza 200 → 300 → fattore 1.5
    emit("pointermove", { clientX: 500, clientY: 200, pointerId: 2 });
    expect(cs.ready()).toBe(false); // lo zoom ha toccato il bersaglio
    for (let i = 0; i < 300; i++) cs.step(16.7);
    expect(cs.state().scale).toBeCloseTo(1.5, 3);
    // il pinch è ancorato al punto medio: nessuno scatto del centro
    // rilascio delle dita: il pinch finisce senza lasciare prese
    emit("pointerup", { clientX: 500, clientY: 200, button: 0, pointerId: 2 });
    emit("pointerup", { clientX: 200, clientY: 200, button: 0, pointerId: 1 });
    expect(s.dragged).toBe(-1);
    expect(canvas.style.cursor).not.toBe("grabbing");
  });

  it("doppio click su nodo: toggle pin + centra con zoom 1.6; a vuoto: fit", () => {
    emit("dblclick", { clientX: 5, clientY: 5 });
    expect(s.fixed[0]).toBe(1);
    for (let i = 0; i < 300; i++) cs.step(16.7);
    expect(cs.state().scale).toBeCloseTo(1.6, 3);
    expect(cs.state().tx).toBeCloseTo(400, 3);
    expect(cs.state().ty).toBeCloseTo(300, 3);

    // dopo il centra, il nodo a è al centro del viewport: il secondo doppio
    // click è sul suo schermo, non dove stava prima
    emit("dblclick", { clientX: 400, clientY: 300 });
    expect(s.fixed[0]).toBe(0); // secondo doppio click → sblocca

    emit("dblclick", { clientX: 10, clientY: 10 }); // angolo vuoto → fit
    for (let i = 0; i < 300; i++) cs.step(16.7);
    // bound dei nodi: x∈[-50,100], y∈[0,60] → scala = min(800/150, 600/60)·0.84
    expect(cs.state().scale).toBeCloseTo(4.48, 3);
    expect(cs.state().tx).toBeCloseTo(288, 3);
  });

  it("rotella: zoom al cursore con clamp dei limiti", () => {
    const prevented = vi.fn();
    emit("wheel", { deltaY: -100, clientX: 400, clientY: 300, preventDefault: prevented });
    expect(prevented).toHaveBeenCalled(); // la pagina non deve scrollare
    for (let i = 0; i < 300; i++) cs.step(16.7);
    expect(cs.state().scale).toBeCloseTo(Math.exp(0.15), 3); // exp(100·0.0015)

    // zoom oltre il massimo: clampato
    for (let k = 0; k < 200; k++) emit("wheel", { deltaY: -500, clientX: 400, clientY: 300 });
    for (let i = 0; i < 300; i++) cs.step(16.7);
    expect(cs.state().scale).toBeLessThanOrEqual(8);
  });

  it("tastiera: frecce pana senza focus, spostano il focus con focus, F fa il fit", () => {
    emit("keydown", { key: "ArrowRight" });
    expect(cs.state().tx).toBeCloseTo(40); // PAN_TASTO_PX

    interaction.focusedNode(0);
    emit("keydown", { key: "ArrowRight" });
    expect(interaction.getFocusedNode()).toBe(1); // da a(0,0) verso destra → b(100,0)
    emit("keydown", { key: "ArrowDown" });
    expect(interaction.getFocusedNode()).toBe(2); // da b(100,0) verso giù → c(-50,60)

    emit("keydown", { key: "f" });
    for (let i = 0; i < 300; i++) cs.step(16.7);
    expect(cs.state().scale).toBeCloseTo(4.48, 3);
  });

  it("tastiera: Invio apre il focalizzato, Esc deseleziona, P toggla il pin", () => {
    interaction.focusedNode(1);
    emit("keydown", { key: "Enter" });
    expect(actions.open).toHaveBeenCalledWith("b");

    emit("keydown", { key: "Escape" });
    expect(interaction.getFocusedNode()).toBe(-1);

    interaction.focusedNode(0);
    emit("keydown", { key: "p" });
    expect(s.fixed[0]).toBe(1);
    emit("keydown", { key: "P" });
    expect(s.fixed[0]).toBe(0);
  });

  it("pointerleave pulisce l'hover ma non il drag (bug 2-2)", () => {
    emit("pointermove", { clientX: 5, clientY: 5, button: 0 });
    expect(canvas.style.cursor).toBe("pointer");
    emit("pointerleave", {});
    expect(canvas.style.cursor).toBe("default");
    // il drag in corso non viene spezzato dal leave
    emit("pointerdown", { clientX: 5, clientY: 5, button: 0 });
    emit("pointermove", { clientX: 40, clientY: 20, button: 0 });
    emit("pointerleave", {});
    expect(s.dragged).toBe(0);
    emit("pointermove", { clientX: 70, clientY: 20, button: 0 });
    expect(s.px[0]).toBeCloseTo(65);
    emit("pointerup", { clientX: 70, clientY: 20, button: 0 });
    expect(s.dragged).toBe(-1);
  });

  it("distruggi rimuove gli handler: niente più reazioni agli eventi", () => {
    interaction.destroy();
    // Dopo distruggi, l'emit deve fallire perché gli handler sono stati
    // rimossi dal canvas (removeEventListener ha cancellato le registrazioni).
    expect(() => emit("pointerdown", { clientX: 5, clientY: 5, button: 0 })).toThrow();
    expect(s.dragged).toBe(-1);
    expect(actions.warm).not.toHaveBeenCalled();
  });

  it("impostaEtichettaA11y aggiorna l'aria-label (S5-3)", () => {
    expect(canvas.getAttribute("aria-label")).toBe("");
    interaction.setA11yLabel("Grafo dei documenti collegati");
    expect(canvas.getAttribute("aria-label")).toBe("Grafo dei documenti collegati");
  });
});
