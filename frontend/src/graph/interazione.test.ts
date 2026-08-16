// @vitest-environment happy-dom
// Test dell'interazione, in due strati come il modulo:
// - funzioni pure (`nodoIn`, `aggiornaDrag`): nessun DOM, nessun Canvas2D;
//   `nodoIn` con scala ≠ 1 era il bug storico (hit-test ignorava la scala).
// - wiring (`creaInterazione`): un canvas happy-dom reale, ma con
//   `addEventListener` che registra gli handler in una mappa e
//   `getBoundingClientRect` mockato — si emettono eventi finti e si guarda
//   cosa succede a struttura, camera e azioni.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { Struttura } from "./sim/tipi";
import { creaCameraStato } from "./render/camera";
import { aggiornaDrag, creaInterazione, nodoIn, statoDragIniziale, type AzioniInterazione, type EsitoDrag, type StatoDrag } from "./interazione";

/// Tre nodi: a(0,0) b(100,0) c(-50,60), raggio 8, archi a→b, b→c.
function strutturaProva(): Struttura {
  return {
    x: new Float32Array([0, 100, -50]),
    y: new Float32Array([0, 0, 60]),
    vx: new Float32Array(3),
    vy: new Float32Array(3),
    fx: new Float32Array(3),
    fy: new Float32Array(3),
    px: new Float32Array(3),
    py: new Float32Array(3),
    massa: new Float32Array([1, 1, 1]),
    raggio: new Float32Array([8, 8, 8]),
    grado: new Uint16Array([2, 1, 1]),
    fisso: new Uint8Array([0, 0, 0]),
    trascinato: -1,
    id: ["a", "b", "c"],
    da: new Uint32Array([0, 1]),
    a: new Uint32Array([1, 2]),
    curva: new Float32Array([0.1, -0.1]),
    n: 3,
    m: 2,
  };
}

type Handler = (e: Record<string, unknown>) => void;

/// Un canvas finto: il canvas reale di happy-dom con gli slot di eventi
/// intercettati (getContext resta null, ma l'interazione non lo usa).
function fintoCanvas() {
  const canvas = document.createElement("canvas");
  const handlers = new Map<string, Handler>();
  canvas.addEventListener = ((tipo: string, fn: unknown) => {
    handlers.set(tipo, fn as Handler);
  }) as typeof canvas.addEventListener;
  canvas.removeEventListener = ((tipo: string) => {
    handlers.delete(tipo);
  }) as typeof canvas.removeEventListener;
  canvas.setPointerCapture = vi.fn() as unknown as typeof canvas.setPointerCapture;
  canvas.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  const emit = (tipo: string, init: Record<string, unknown> = {}): Handler => {
    const fn = handlers.get(tipo);
    if (!fn) throw new Error(`nessun handler registrato per "${tipo}"`);
    fn({ preventDefault: () => {}, ...init });
    return fn;
  };
  return { canvas, handlers, emit };
}

describe("nodoIn (hit-test puro, screen space)", () => {
  it("trova il nodo con scala ≠ 1 e traslazione", () => {
    const s = strutturaProva();
    // scala 2: nodo a in (0,0) schermo; click a 15px → mondo 7.5 → entro r+6
    expect(nodoIn(s, { scala: 2, tx: 0, ty: 0 }, 0, 15)).toBe(0);
    // scala 1: lo stesso click a 15px è fuori dalla soglia 8+6=14 → miss
    expect(nodoIn(s, { scala: 1, tx: 0, ty: 0 }, 0, 15)).toBe(-1);
    // traslazione: con tx=-100 il nodo b(100,0) sta in (0,0) schermo
    expect(nodoIn(s, { scala: 1, tx: -100, ty: 0 }, 0, 0)).toBe(1);
  });

  it("rispetta la soglia r+6 in px di schermo", () => {
    const s = strutturaProva();
    expect(nodoIn(s, { scala: 1, tx: 0, ty: 0 }, 13.9, 0)).toBe(0); // < 14
    expect(nodoIn(s, { scala: 1, tx: 0, ty: 0 }, 15, 0)).toBe(-1); // 15 > 14
    expect(nodoIn(s, { scala: 1, tx: 0, ty: 0 }, 500, 500)).toBe(-1); // fuori da tutto
  });

  it("sceglie il nodo più vicino quando due sono in soglia", () => {
    const s = strutturaProva();
    expect(nodoIn(s, { scala: 1, tx: 0, ty: 0 }, 90, 0)).toBe(1); // vicino a b(100,0)
    // struttura con due nodi vicini: a(0,0) e b(5,0), puntatore a (4,0) —
    // entrambi in soglia r+6=14, vince il più vicino (b a 1, a a 4).
    const vicini: Struttura = { ...strutturaProva(), x: new Float32Array([0, 5]), y: new Float32Array([0, 0]), n: 2 };
    expect(nodoIn(vicini, { scala: 1, tx: 0, ty: 0 }, 4, 0)).toBe(1);
  });
});

describe("aggiornaDrag (macchina a stati pura)", () => {
  const hit = (x: number, y: number): number => nodoIn(strutturaProva(), { scala: 1, tx: 0, ty: 0 }, x, y);
  const s2m = (x: number, y: number): { x: number; y: number } => ({ x, y });

  it("hover su move senza down, pulito dal leave (bug 2-2)", () => {
    let st = statoDragIniziale();
    st = aggiornaDrag(st, { tipo: "move", x: 5, y: 5, pulsante: 0 }, hit, s2m).stato;
    expect(st.hovered).toBe(0);
    st = aggiornaDrag(st, { tipo: "move", x: 320, y: 310, pulsante: 0 }, hit, s2m).stato;
    expect(st.hovered).toBe(-1);
    st = aggiornaDrag(st, { tipo: "leave", x: 0, y: 0, pulsante: 0 }, hit, s2m).stato;
    expect(st.hovered).toBe(-1);
  });

  it("down su nodo → drag; move produce bersaglio mondo; up rilascia", () => {
    let st = statoDragIniziale();
    st = aggiornaDrag(st, { tipo: "down", x: 5, y: 5, pulsante: 0 }, hit, s2m).stato;
    expect(st.trascinato).toBe(0);
    expect(st.hovered).toBe(-1); // il drag toglie l'hover
    const es: EsitoDrag = aggiornaDrag(st, { tipo: "move", x: 50, y: 40, pulsante: 0 }, hit, s2m);
    expect(es.bersaglio).toEqual({ x: 50, y: 40 });
    expect(es.panDx).toBe(0);
    st = aggiornaDrag(es.stato, { tipo: "up", x: 50, y: 40, pulsante: 0 }, hit, s2m).stato;
    expect(st.trascinato).toBe(-1);
  });

  it("down su vuoto → pan con delta; un secondo down durante il pan viene ignorato", () => {
    let st = statoDragIniziale();
    st = aggiornaDrag(st, { tipo: "down", x: 300, y: 300, pulsante: 0 }, hit, s2m).stato;
    expect(st.trascinaVuoto).toBe(true);
    // secondo down mentre si pana: ignorato (niente drag sul vuoto già attivo)
    st = aggiornaDrag(st, { tipo: "down", x: 310, y: 300, pulsante: 0 }, hit, s2m).stato;
    expect(st.trascinaVuoto).toBe(true);
    expect(st.trascinato).toBe(-1);
    const es: EsitoDrag = aggiornaDrag(st, { tipo: "move", x: 320, y: 310, pulsante: 0 }, hit, s2m);
    // il secondo down ha ribasato la base a (310,300): il delta è (10,10)
    expect(es.panDx).toBe(10);
    expect(es.panDy).toBe(10);
    st = aggiornaDrag(es.stato, { tipo: "up", x: 320, y: 310, pulsante: 0 }, hit, s2m).stato;
    expect(st.trascinaVuoto).toBe(false);
  });

  it("tasto centrale → pan anche sopra un nodo; il leave non spezza il drag", () => {
    let st = statoDragIniziale();
    st = aggiornaDrag(st, { tipo: "down", x: 5, y: 5, pulsante: 1 }, hit, s2m).stato;
    expect(st.trascinaVuoto).toBe(true);
    expect(st.trascinato).toBe(-1);
    // leave durante il drag: il drag resta (con setPointerCapture non arriva,
    // ma se arrivasse non deve spezzare la presa)
    st = aggiornaDrag(st, { tipo: "leave", x: 0, y: 0, pulsante: 0 }, hit, s2m).stato;
    expect(st.trascinaVuoto).toBe(true);
    const es: EsitoDrag = aggiornaDrag(st, { tipo: "move", x: 15, y: 5, pulsante: 0 }, hit, s2m);
    expect(es.panDx).toBe(10);
  });

  it("è pura: lo stato in ingresso non viene mutato", () => {
    const prima: StatoDrag = statoDragIniziale();
    const congelato = { ...prima };
    aggiornaDrag(prima, { tipo: "down", x: 5, y: 5, pulsante: 0 }, hit, s2m);
    expect(prima).toEqual(congelato);
  });
});

describe("creaInterazione (wiring su canvas finto)", () => {
  let s: Struttura;
  let cs: ReturnType<typeof creaCameraStato>;
  let azioni: AzioniInterazione & { apri: ReturnType<typeof vi.fn>; riscalda: ReturnType<typeof vi.fn>; richiediRidisegno: ReturnType<typeof vi.fn> };
  let canvas: ReturnType<typeof fintoCanvas>["canvas"];
  let emit: ReturnType<typeof fintoCanvas>["emit"];
  let interazione: ReturnType<typeof creaInterazione>;

  beforeEach(() => {
    vi.useFakeTimers();
    s = strutturaProva();
    cs = creaCameraStato();
    azioni = {
      apri: vi.fn(),
      riscalda: vi.fn(),
      richiediRidisegno: vi.fn(),
    } as AzioniInterazione & {
      apri: ReturnType<typeof vi.fn>;
      riscalda: ReturnType<typeof vi.fn>;
      richiediRidisegno: ReturnType<typeof vi.fn>;
    };
    const f = fintoCanvas();
    canvas = f.canvas;
    emit = f.emit;
    interazione = creaInterazione({ canvas, strutturaRef: () => s, cameraStato: cs, azioni });
  });

  afterEach(() => {
    vi.useRealTimers();
    interazione.distruggi();
  });

  it("drag di un nodo: pin (fisso=2), bersaglio px/py, rilascio col fisso precedente", () => {
    emit("pointerdown", { clientX: 5, clientY: 5, button: 0, pointerId: 7 });
    expect(s.trascinato).toBe(0);
    expect(s.fisso[0]).toBe(2);
    expect(s.px[0]).toBeCloseTo(5);
    expect(s.py[0]).toBeCloseTo(5);
    expect(canvas.setPointerCapture).toHaveBeenCalledWith(7);
    expect(azioni.riscalda).toHaveBeenCalled();

    emit("pointermove", { clientX: 50, clientY: 40, button: 0, pointerId: 7 });
    expect(s.px[0]).toBeCloseTo(50);
    expect(s.py[0]).toBeCloseTo(40);

    emit("pointerup", { clientX: 50, clientY: 40, button: 0, pointerId: 7 });
    expect(s.trascinato).toBe(-1);
    expect(s.fisso[0]).toBe(0); // torna com'era: il drag non lascia pin
  });

  it("drag non cancella un pin esplicito: il fisso torna 1 al rilascio", () => {
    s.fisso[0] = 1; // pin fatto prima (doppio click)
    emit("pointerdown", { clientX: 5, clientY: 5, button: 0 });
    expect(s.fisso[0]).toBe(2); // il drag vince durante la presa
    emit("pointermove", { clientX: 60, clientY: 30, button: 0 });
    emit("pointerup", { clientX: 60, clientY: 30, button: 0 });
    expect(s.fisso[0]).toBe(1); // il pin esplicito sopravvive al drag
  });

  it("pan su vuoto con inerzia: la camera si sposta e poi si assesta", () => {
    emit("pointerdown", { clientX: 300, clientY: 300, button: 0 });
    emit("pointermove", { clientX: 320, clientY: 310, button: 0 });
    emit("pointerup", { clientX: 320, clientY: 310, button: 0 });
    expect(cs.stato().tx).toBeCloseTo(20);
    expect(cs.stato().ty).toBeCloseTo(10);
    expect(cs.pronto()).toBe(false); // inerzia in corso
    for (let i = 0; i < 300; i++) cs.passo(16.7);
    expect(cs.pronto()).toBe(true);
    expect(cs.stato().tx).toBeCloseTo(20, 4);
  });

  it("click su nodo (senza trascinamento) apre la nota e focalizza", () => {
    emit("pointerdown", { clientX: 5, clientY: 5, button: 0 });
    emit("pointerup", { clientX: 5, clientY: 5, button: 0 });
    emit("click", { clientX: 5, clientY: 5 });
    expect(azioni.apri).not.toHaveBeenCalled(); // il click è ritardato: attende il dblclick
    vi.advanceTimersByTime(260);
    expect(azioni.apri).toHaveBeenCalledWith("a");
    expect(interazione.leggiFocalizzato()).toBe(0);
  });

  it("click dopo un drag con spostamento non apre (gesto, non click)", () => {
    emit("pointerdown", { clientX: 5, clientY: 5, button: 0 });
    emit("pointermove", { clientX: 60, clientY: 60, button: 0 });
    emit("pointerup", { clientX: 60, clientY: 60, button: 0 });
    emit("click", { clientX: 60, clientY: 60 });
    vi.advanceTimersByTime(260);
    expect(azioni.apri).not.toHaveBeenCalled();
  });

  it("pinch a due dita: zoom sul punto medio, il pan del primo dito si smonta", () => {
    emit("pointerdown", { clientX: 200, clientY: 200, button: 0, pointerId: 1 });
    expect(s.trascinato).toBe(-1); // su vuoto → pan
    emit("pointerdown", { clientX: 400, clientY: 200, button: 0, pointerId: 2 });
    // il secondo dito smonta il pan e parte il pinch (distanza base 200)
    expect(s.trascinato).toBe(-1);
    // allargamento: distanza 200 → 300 → fattore 1.5
    emit("pointermove", { clientX: 500, clientY: 200, pointerId: 2 });
    expect(cs.pronto()).toBe(false); // lo zoom ha toccato il bersaglio
    for (let i = 0; i < 300; i++) cs.passo(16.7);
    expect(cs.stato().scala).toBeCloseTo(1.5, 3);
    // il pinch è ancorato al punto medio: nessuno scatto del centro
    // rilascio delle dita: il pinch finisce senza lasciare prese
    emit("pointerup", { clientX: 500, clientY: 200, button: 0, pointerId: 2 });
    emit("pointerup", { clientX: 200, clientY: 200, button: 0, pointerId: 1 });
    expect(s.trascinato).toBe(-1);
    expect(canvas.style.cursor).not.toBe("grabbing");
  });

  it("doppio click su nodo: toggle pin + centra con zoom 1.6; a vuoto: fit", () => {
    emit("dblclick", { clientX: 5, clientY: 5 });
    expect(s.fisso[0]).toBe(1);
    for (let i = 0; i < 300; i++) cs.passo(16.7);
    expect(cs.stato().scala).toBeCloseTo(1.6, 3);
    expect(cs.stato().tx).toBeCloseTo(400, 3);
    expect(cs.stato().ty).toBeCloseTo(300, 3);

    // dopo il centra, il nodo a è al centro del viewport: il secondo doppio
    // click è sul suo schermo, non dove stava prima
    emit("dblclick", { clientX: 400, clientY: 300 });
    expect(s.fisso[0]).toBe(0); // secondo doppio click → sblocca

    emit("dblclick", { clientX: 10, clientY: 10 }); // angolo vuoto → fit
    for (let i = 0; i < 300; i++) cs.passo(16.7);
    // bound dei nodi: x∈[-50,100], y∈[0,60] → scala = min(800/150, 600/60)·0.84
    expect(cs.stato().scala).toBeCloseTo(4.48, 3);
    expect(cs.stato().tx).toBeCloseTo(288, 3);
  });

  it("rotella: zoom al cursore con clamp dei limiti", () => {
    const prevented = vi.fn();
    emit("wheel", { deltaY: -100, clientX: 400, clientY: 300, preventDefault: prevented });
    expect(prevented).toHaveBeenCalled(); // la pagina non deve scrollare
    for (let i = 0; i < 300; i++) cs.passo(16.7);
    expect(cs.stato().scala).toBeCloseTo(Math.exp(0.15), 3); // exp(100·0.0015)

    // zoom oltre il massimo: clampato
    for (let k = 0; k < 200; k++) emit("wheel", { deltaY: -500, clientX: 400, clientY: 300 });
    for (let i = 0; i < 300; i++) cs.passo(16.7);
    expect(cs.stato().scala).toBeLessThanOrEqual(8);
  });

  it("tastiera: frecce pana senza focus, spostano il focus con focus, F fa il fit", () => {
    emit("keydown", { key: "ArrowRight" });
    expect(cs.stato().tx).toBeCloseTo(40); // PAN_TASTO_PX

    interazione.focusNodo(0);
    emit("keydown", { key: "ArrowRight" });
    expect(interazione.leggiFocalizzato()).toBe(1); // da a(0,0) verso destra → b(100,0)
    emit("keydown", { key: "ArrowDown" });
    expect(interazione.leggiFocalizzato()).toBe(2); // da b(100,0) verso giù → c(-50,60)

    emit("keydown", { key: "f" });
    for (let i = 0; i < 300; i++) cs.passo(16.7);
    expect(cs.stato().scala).toBeCloseTo(4.48, 3);
  });

  it("tastiera: Invio apre il focalizzato, Esc deseleziona, P toggla il pin", () => {
    interazione.focusNodo(1);
    emit("keydown", { key: "Enter" });
    expect(azioni.apri).toHaveBeenCalledWith("b");

    emit("keydown", { key: "Escape" });
    expect(interazione.leggiFocalizzato()).toBe(-1);

    interazione.focusNodo(0);
    emit("keydown", { key: "p" });
    expect(s.fisso[0]).toBe(1);
    emit("keydown", { key: "P" });
    expect(s.fisso[0]).toBe(0);
  });

  it("pointerleave pulisce l'hover ma non il drag (bug 2-2)", () => {
    emit("pointermove", { clientX: 5, clientY: 5, button: 0 });
    expect(canvas.style.cursor).toBe("pointer");
    emit("pointerleave", {});
    expect(canvas.style.cursor).toBe("default");
    // il drag in corso non viene spezzato dal leave
    emit("pointerdown", { clientX: 5, clientY: 5, button: 0 });
    emit("pointerleave", {});
    expect(s.trascinato).toBe(0);
    emit("pointermove", { clientX: 70, clientY: 20, button: 0 });
    expect(s.px[0]).toBeCloseTo(70);
    emit("pointerup", { clientX: 70, clientY: 20, button: 0 });
    expect(s.trascinato).toBe(-1);
  });

  it("distruggi rimuove gli handler: niente più reazioni agli eventi", () => {
    interazione.distruggi();
    // Dopo distruggi, l'emit deve fallire perché gli handler sono stati
    // rimossi dal canvas (removeEventListener ha cancellato le registrazioni).
    expect(() => emit("pointerdown", { clientX: 5, clientY: 5, button: 0 })).toThrow();
    expect(s.trascinato).toBe(-1);
    expect(azioni.riscalda).not.toHaveBeenCalled();
  });

  it("impostaEtichettaA11y aggiorna l'aria-label (S5-3)", () => {
    expect(canvas.getAttribute("aria-label")).toBe("");
    interazione.impostaEtichettaA11y("Grafo dei documenti collegati");
    expect(canvas.getAttribute("aria-label")).toBe("Grafo dei documenti collegati");
  });
});
