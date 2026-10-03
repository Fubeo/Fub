// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { INK_MAX_SAMPLES, type InkSample, quantizeInk } from "../ink/sample";
import {
  attachPenInput,
  type CancelReason,
  type FinishedStroke,
  type PenInput,
  type PenInputOptions,
  type StrokeStart,
} from "./pen-input";

type Entry =
  | { readonly kind: "start"; readonly stroke: StrokeStart }
  | { readonly kind: "samples"; readonly id: number; readonly samples: InkSample[] }
  | { readonly kind: "predicted"; readonly id: number; readonly samples: InkSample[] }
  | { readonly kind: "end"; readonly stroke: FinishedStroke }
  | { readonly kind: "cancel"; readonly id: number; readonly reason: CancelReason };

type Init = PointerEventInit & { readonly timeStamp?: number };

/// Un `PointerEvent` sintetico con il suo `timeStamp`, che il costruttore non
/// permette di scegliere. L'altitudine di default è quella della specifica,
/// π/2: happy-dom mette 0, che sarebbe una penna sdraiata.
function pointerEvent(type: string, init: Init): PointerEvent {
  const { timeStamp, ...rest } = init;
  const event = new PointerEvent(type, {
    bubbles: type !== "pointerleave",
    cancelable: true,
    composed: true,
    isPrimary: true,
    altitudeAngle: Math.PI / 2,
    azimuthAngle: 0,
    ...rest,
  });
  if (timeStamp !== undefined) Object.defineProperty(event, "timeStamp", { value: timeStamp });
  return event;
}

const PEN = { pointerId: 7, pointerType: "pen" } as const;
const MOUSE = { pointerId: 1, pointerType: "mouse" } as const;

function down(init: Init): PointerEvent {
  return pointerEvent("pointerdown", { button: 0, buttons: 1, pressure: 0.5, ...init });
}

function move(init: Init): PointerEvent {
  return pointerEvent("pointermove", { button: -1, buttons: 1, pressure: 0.5, ...init });
}

function up(init: Init): PointerEvent {
  return pointerEvent("pointerup", { button: 0, buttons: 0, pressure: 0, ...init });
}

describe("pipeline della penna", () => {
  let owner: Lifetime;
  let surface: HTMLElement;
  let log: Entry[];

  beforeEach(() => {
    owner = openLifetime();
    surface = document.createElement("div");
    document.body.append(surface);
    log = [];
  });

  afterEach(() => {
    owner.close();
    surface.remove();
  });

  function attach(options: Partial<PenInputOptions> = {}): PenInput {
    return attachPenInput(surface, {
      // Una camera finta: la scena è a metà scala del client.
      toScene: (clientX, clientY) => ({ x: clientX / 2, y: clientY / 2 }),
      onStart: (stroke) => log.push({ kind: "start", stroke }),
      onSamples: (id, samples) => log.push({ kind: "samples", id, samples: [...samples] }),
      onPredicted: (id, samples) => log.push({ kind: "predicted", id, samples: [...samples] }),
      onEnd: (stroke) => log.push({ kind: "end", stroke }),
      onCancel: (id, reason) => log.push({ kind: "cancel", id, reason }),
      ...options,
    }, owner);
  }

  function dispatch(event: PointerEvent, target: EventTarget = surface): void {
    target.dispatchEvent(event);
  }

  const kinds = (): string[] => log.map((entry) => entry.kind);
  const latest = (): Entry | undefined => log[log.length - 1];
  const ends = (): FinishedStroke[] =>
    log.flatMap((entry) => (entry.kind === "end" ? [entry.stroke] : []));
  const delivered = (id: number): InkSample[] =>
    log.flatMap((entry) => (entry.kind === "samples" && entry.id === id ? entry.samples : []));

  it("un tratto di penna: inizio, campioni subito, fine con i campioni nella scena", () => {
    const input = attach();
    dispatch(down({ ...PEN, clientX: 10, clientY: 20, pressure: 0.4, timeStamp: 100 }));
    // Consegna sincrona: niente attese, il campione c'è già.
    expect(kinds()).toEqual(["start", "samples"]);
    expect(input.drawing).toBe(true);
    expect(input.roleOf(7)).toBe("ink");
    expect(surface.hasPointerCapture(7)).toBe(true);
    dispatch(move({ ...PEN, clientX: 12, clientY: 22, pressure: 0.6, timeStamp: 108 }));
    expect(kinds()).toEqual(["start", "samples", "samples"]);
    dispatch(move({ ...PEN, clientX: 16, clientY: 25, pressure: 0.7, timeStamp: 116.5 }));
    dispatch(up({ ...PEN, clientX: 16, clientY: 25, timeStamp: 120 }));

    expect(log[0]).toEqual({
      kind: "start",
      stroke: { id: 1, pointerType: "pen", pressure: true, timeStamp: 100, continued: false },
    });
    // Durante il tratto i campioni della penna portano gli angoli letti.
    expect(delivered(1)).toEqual([
      { x: 5, y: 10, p: 0.4, t: 0, a: 90, z: 0 },
      { x: 6, y: 11, p: 0.6, t: 8, a: 90, z: 0 },
      { x: 8, y: 12.5, p: 0.7, t: 16.5, a: 90, z: 0 },
    ]);
    // Alla fine sono quelli di default, quindi il dispositivo non ha un
    // sensore: il tratto non porta l'inclinazione.
    expect(ends()).toEqual([{
      id: 1,
      pointerType: "pen",
      pressure: true,
      timeStamp: 100,
      continued: false,
      split: false,
      tilt: false,
      samples: [
        { x: 5, y: 10, p: 0.4, t: 0 },
        { x: 6, y: 11, p: 0.6, t: 8 },
        { x: 8, y: 12.5, p: 0.7, t: 16.5 },
      ],
    }]);
    expect(input.drawing).toBe(false);
    expect(input.roleOf(7)).toBeNull();
    expect(surface.hasPointerCapture(7)).toBe(false);
    // I campioni sono quelli che il codec scrive.
    expect(quantizeInk(ends()[0]!.samples).samples[2]).toEqual({ x: 800, y: 1250, p: 179, t: 17 });
  });

  it("l'inclinazione vera si conserva in gradi in tutto il tratto", () => {
    attach();
    dispatch(down({ ...PEN, clientX: 0, clientY: 0, timeStamp: 0, altitudeAngle: Math.PI / 4, azimuthAngle: Math.PI }));
    dispatch(move({ ...PEN, clientX: 4, clientY: 0, timeStamp: 8, altitudeAngle: Math.PI / 3, azimuthAngle: Math.PI / 2 }));
    dispatch(up({ ...PEN, clientX: 4, clientY: 0, timeStamp: 10 }));
    const [stroke] = ends();
    expect(stroke!.tilt).toBe(true);
    expect(stroke!.samples[1]!.a).toBeCloseTo(60, 10);
    expect(quantizeInk(stroke!.samples).samples.map(({ a, z }) => [a, z])).toEqual([[45, 180], [60, 90]]);
  });

  it("il punto dove la penna si alza entra con pressione e inclinazione del campione prima", () => {
    attach();
    dispatch(down({ ...PEN, clientX: 0, clientY: 0, pressure: 0.3, timeStamp: 0, altitudeAngle: 1 }));
    dispatch(move({ ...PEN, clientX: 10, clientY: 0, pressure: 0.8, timeStamp: 8, altitudeAngle: 1.2 }));
    dispatch(up({ ...PEN, clientX: 14, clientY: 2, timeStamp: 12 }));
    const samples = ends()[0]!.samples;
    expect(samples).toHaveLength(3);
    expect(samples[2]).toEqual({ ...samples[1], x: 7, y: 1, t: 12 });
  });

  it("un tocco senza movimento diventa due campioni nello stesso punto, un punto tondo", () => {
    attach();
    dispatch(down({ ...MOUSE, clientX: 30, clientY: 40, timeStamp: 50 }));
    dispatch(up({ ...MOUSE, clientX: 30, clientY: 40, timeStamp: 140 }));
    expect(ends()[0]!.samples).toEqual([{ x: 15, y: 20, t: 0 }, { x: 15, y: 20, t: 90 }]);
    expect(delivered(1)).toEqual(ends()[0]!.samples);
  });

  it("gli eventi coalescenti entrano nell'ordine, senza doppioni", () => {
    attach();
    dispatch(down({ ...PEN, clientX: 0, clientY: 0, timeStamp: 100 }));
    const dispatched = { ...PEN, clientX: 6, clientY: 0, timeStamp: 112 };
    dispatch(move({
      ...dispatched,
      coalescedEvents: [
        // Più vecchio dell'ultimo campione accettato: si scarta.
        move({ ...PEN, clientX: -5, clientY: 0, timeStamp: 99 }),
        // Lo stesso campione del pointerdown: si scarta.
        move({ ...PEN, clientX: 0, clientY: 0, timeStamp: 100 }),
        move({ ...PEN, clientX: 2, clientY: 0, timeStamp: 104 }),
        move({ ...PEN, clientX: 4, clientY: 0, timeStamp: 108 }),
        move({ ...PEN, clientX: 4, clientY: 0, timeStamp: 108 }),
        // L'evento stesso, come lo mette Chrome in fondo alla lista.
        move(dispatched),
      ],
    }));
    // Un solo lotto per evento, con tutti i campioni nuovi.
    expect(kinds()).toEqual(["start", "samples", "samples"]);
    expect(delivered(1).map(({ x, t }) => [x, t])).toEqual([[0, 0], [1, 4], [2, 8], [3, 12]]);
    // Un evento senza lista coalescente vale per sé.
    dispatch(move({ ...PEN, clientX: 8, clientY: 0, timeStamp: 116 }));
    // Due campioni dello stesso istante in punti diversi restano tutti e due.
    dispatch(move({
      ...PEN,
      clientX: 12,
      clientY: 0,
      timeStamp: 120,
      coalescedEvents: [move({ ...PEN, clientX: 10, clientY: 0, timeStamp: 120 }), move({ ...PEN, clientX: 12, clientY: 0, timeStamp: 120 })],
    }));
    dispatch(up({ ...PEN, clientX: 12, clientY: 0, timeStamp: 121 }));
    expect(ends()[0]!.samples.map(({ x, t }) => [x, t])).toEqual([[0, 0], [1, 4], [2, 8], [3, 12], [4, 16], [5, 20], [6, 20]]);
  });

  it("gli eventi predetti vanno solo all'anteprima e non entrano mai nel tratto", () => {
    attach();
    dispatch(down({ ...PEN, clientX: 0, clientY: 0, timeStamp: 0 }));
    dispatch(move({
      ...PEN,
      clientX: 2,
      clientY: 0,
      timeStamp: 8,
      predictedEvents: [move({ ...PEN, clientX: 4, clientY: 0, timeStamp: 16 }), move({ ...PEN, clientX: 6, clientY: 0, timeStamp: 24 })],
    }));
    expect(latest()).toEqual({
      kind: "predicted",
      id: 1,
      samples: [{ x: 2, y: 0, p: 0.5, t: 16, a: 90, z: 0 }, { x: 3, y: 0, p: 0.5, t: 24, a: 90, z: 0 }],
    });
    // La predizione successiva sostituisce la precedente.
    dispatch(move({
      ...PEN,
      clientX: 3,
      clientY: 0,
      timeStamp: 16,
      predictedEvents: [move({ ...PEN, clientX: 5, clientY: 0, timeStamp: 24 })],
    }));
    expect(latest()).toMatchObject({ kind: "predicted", samples: [{ x: 2.5, t: 24 }] });
    // Un evento senza predizioni la cancella, una volta sola.
    dispatch(move({ ...PEN, clientX: 4, clientY: 0, timeStamp: 24 }));
    expect(latest()).toEqual({ kind: "predicted", id: 1, samples: [] });
    const count = log.length;
    dispatch(move({ ...PEN, clientX: 5, clientY: 0, timeStamp: 32 }));
    expect(log.slice(count).map((entry) => entry.kind)).toEqual(["samples"]);
    // Una predizione ancora aperta alla fine si cancella prima di onEnd.
    dispatch(move({
      ...PEN,
      clientX: 6,
      clientY: 0,
      timeStamp: 40,
      predictedEvents: [move({ ...PEN, clientX: 9, clientY: 0, timeStamp: 48 })],
    }));
    dispatch(up({ ...PEN, clientX: 6, clientY: 0, timeStamp: 41 }));
    expect(log.slice(-2)).toEqual([{ kind: "predicted", id: 1, samples: [] }, expect.objectContaining({ kind: "end" })]);
    expect(ends()[0]!.samples.map(({ x }) => x)).toEqual([0, 1, 1.5, 2, 2.5, 3]);
  });

  it("pointercancel a metà annulla il tratto intero: nessuna fine, nessuna cattura", () => {
    const input = attach();
    dispatch(down({ ...PEN, clientX: 0, clientY: 0, timeStamp: 0 }));
    dispatch(move({
      ...PEN,
      clientX: 4,
      clientY: 0,
      timeStamp: 8,
      predictedEvents: [move({ ...PEN, clientX: 6, clientY: 0, timeStamp: 16 })],
    }));
    dispatch(pointerEvent("pointercancel", { ...PEN, timeStamp: 10 }));
    expect(latest()).toEqual({ kind: "cancel", id: 1, reason: "pointercancel" });
    expect(input.drawing).toBe(false);
    expect(input.roleOf(7)).toBeNull();
    expect(surface.hasPointerCapture(7)).toBe(false);
    const count = log.length;
    dispatch(move({ ...PEN, clientX: 8, clientY: 0, timeStamp: 16 }));
    dispatch(up({ ...PEN, clientX: 8, clientY: 0, timeStamp: 20 }));
    expect(log).toHaveLength(count);
    expect(ends()).toEqual([]);
  });

  it("la cattura persa, la finestra che perde il fuoco e la pagina nascosta annullano il tratto", () => {
    const input = attach();
    dispatch(down({ ...MOUSE, clientX: 0, clientY: 0, timeStamp: 0 }));
    dispatch(pointerEvent("lostpointercapture", { ...MOUSE, timeStamp: 4 }));
    expect(latest()).toEqual({ kind: "cancel", id: 1, reason: "lostcapture" });
    // Il puntatore resta giù ma non disegna più finché non si alza.
    expect(input.roleOf(1)).toBe("ignore");
    dispatch(move({ ...MOUSE, clientX: 9, clientY: 9, timeStamp: 8 }));
    dispatch(up({ ...MOUSE, clientX: 9, clientY: 9, timeStamp: 9 }));
    expect(ends()).toEqual([]);

    dispatch(down({ ...MOUSE, clientX: 0, clientY: 0, timeStamp: 10 }));
    window.dispatchEvent(new Event("blur"));
    expect(latest()).toEqual({ kind: "cancel", id: 2, reason: "blur" });
    expect(input.roleOf(1)).toBeNull();
    dispatch(up({ ...MOUSE, clientX: 0, clientY: 0, timeStamp: 12 }));

    dispatch(down({ ...MOUSE, clientX: 0, clientY: 0, timeStamp: 20 }));
    // Visibile: niente da annullare.
    document.dispatchEvent(new Event("visibilitychange"));
    expect(input.drawing).toBe(true);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    try {
      document.dispatchEvent(new Event("visibilitychange"));
    } finally {
      delete (document as { visibilityState?: unknown }).visibilityState;
    }
    expect(latest()).toEqual({ kind: "cancel", id: 3, reason: "hidden" });
    expect(ends()).toEqual([]);
  });

  it("lo stesso puntatore di nuovo giù vuol dire un pointerup perso: il vecchio tratto si annulla", () => {
    attach();
    dispatch(down({ ...PEN, clientX: 0, clientY: 0, timeStamp: 0 }));
    dispatch(down({ ...PEN, clientX: 50, clientY: 50, timeStamp: 500 }));
    expect(kinds()).toEqual(["start", "samples", "cancel", "start", "samples"]);
    expect(log[2]).toEqual({ kind: "cancel", id: 1, reason: "lostcapture" });
    expect(log[3]).toMatchObject({ kind: "start", stroke: { id: 2, timeStamp: 500 } });
  });

  it("un palmo appoggiato mentre la penna scrive non disegna e non ferma la penna", () => {
    const input = attach();
    dispatch(down({ ...PEN, clientX: 0, clientY: 0, timeStamp: 0 }));
    dispatch(down({ pointerId: 20, pointerType: "touch", clientX: 300, clientY: 300, timeStamp: 5 }));
    expect(input.roleOf(20)).toBe("ignore");
    dispatch(move({ pointerId: 20, pointerType: "touch", clientX: 310, clientY: 300, timeStamp: 6 }));
    dispatch(move({ ...PEN, clientX: 4, clientY: 0, timeStamp: 8 }));
    dispatch(up({ pointerId: 20, pointerType: "touch", clientX: 310, clientY: 300, timeStamp: 9 }));
    dispatch(up({ ...PEN, clientX: 4, clientY: 0, timeStamp: 10 }));
    expect(kinds()).toEqual(["start", "samples", "samples", "end"]);
    expect(ends()[0]!.samples.map(({ x }) => x)).toEqual([0, 2]);
  });

  it("un dito disegna finché non arriva la penna: allora è palmo, e poi muove la vista", () => {
    const input = attach();
    expect(input.penSeen).toBe(false);
    dispatch(down({ pointerId: 20, pointerType: "touch", clientX: 0, clientY: 0, timeStamp: 0 }));
    dispatch(move({ pointerId: 20, pointerType: "touch", clientX: 4, clientY: 0, timeStamp: 8 }));
    expect(log[0]).toMatchObject({ kind: "start", stroke: { pointerType: "touch", pressure: false } });
    expect(delivered(1)).toEqual([{ x: 0, y: 0, t: 0 }, { x: 2, y: 0, t: 8 }]);
    // La penna sospesa sopra la superficie: il dito era un palmo.
    dispatch(move({ ...PEN, buttons: 0, pressure: 0, clientX: 50, clientY: 50, timeStamp: 10 }));
    expect(latest()).toEqual({ kind: "cancel", id: 1, reason: "palm" });
    expect(input.roleOf(20)).toBe("ignore");
    expect(input.penSeen).toBe(true);
    // Un dito con la penna ancora vicina è palmo.
    dispatch(down({ pointerId: 21, pointerType: "touch", clientX: 0, clientY: 0, timeStamp: 12 }));
    expect(input.roleOf(21)).toBe("ignore");
    dispatch(up({ pointerId: 20, pointerType: "touch", timeStamp: 13 }));
    dispatch(up({ pointerId: 21, pointerType: "touch", timeStamp: 13 }));
    // La penna esce dal raggio: un dito ora muove la vista.
    dispatch(pointerEvent("pointerleave", { ...PEN, timeStamp: 14 }));
    dispatch(down({ pointerId: 22, pointerType: "touch", clientX: 0, clientY: 0, timeStamp: 20 }));
    expect(input.roleOf(22)).toBe("navigate");
    expect(input.drawing).toBe(false);
    expect(ends()).toEqual([]);
  });

  it("una penna che si appoggia mentre un dito disegna prende il suo posto", () => {
    attach();
    dispatch(down({ pointerId: 20, pointerType: "touch", clientX: 0, clientY: 0, timeStamp: 0 }));
    dispatch(down({ ...PEN, clientX: 10, clientY: 10, timeStamp: 5 }));
    expect(kinds()).toEqual(["start", "samples", "cancel", "start", "samples"]);
    expect(log[2]).toEqual({ kind: "cancel", id: 1, reason: "palm" });
    expect(log[3]).toMatchObject({ kind: "start", stroke: { id: 2, pointerType: "pen" } });
  });

  it("un secondo dito trasforma il tratto del primo in un gesto di navigazione", () => {
    const input = attach({ touch: "ink" });
    dispatch(down({ pointerId: 20, pointerType: "touch", clientX: 0, clientY: 0, timeStamp: 0 }));
    dispatch(down({ pointerId: 21, pointerType: "touch", clientX: 40, clientY: 0, timeStamp: 30 }));
    expect(latest()).toEqual({ kind: "cancel", id: 1, reason: "gesture" });
    expect(input.roleOf(20)).toBe("navigate");
    expect(input.roleOf(21)).toBe("navigate");
    dispatch(move({ pointerId: 20, pointerType: "touch", clientX: 10, clientY: 0, timeStamp: 40 }));
    dispatch(up({ pointerId: 20, pointerType: "touch", timeStamp: 50 }));
    dispatch(up({ pointerId: 21, pointerType: "touch", timeStamp: 50 }));
    expect(kinds()).toEqual(["start", "samples", "cancel"]);
  });

  it("la politica del tocco si cambia mentre la superficie vive", () => {
    const input = attach();
    input.setTouchPolicy("navigate");
    dispatch(down({ pointerId: 20, pointerType: "touch", clientX: 0, clientY: 0, timeStamp: 0 }));
    expect(input.roleOf(20)).toBe("navigate");
    dispatch(up({ pointerId: 20, pointerType: "touch", timeStamp: 1 }));
    expect(log).toEqual([]);
  });

  it("il mouse disegna col tasto principale e senza pressione; gli altri tasti no", () => {
    const input = attach();
    dispatch(down({ ...MOUSE, button: 1, buttons: 4, clientX: 0, clientY: 0, timeStamp: 0 }));
    expect(input.roleOf(1)).toBe("navigate");
    dispatch(up({ ...MOUSE, button: 1, clientX: 0, clientY: 0, timeStamp: 1 }));
    dispatch(down({ ...MOUSE, button: 2, buttons: 2, clientX: 0, clientY: 0, timeStamp: 2 }));
    expect(input.roleOf(1)).toBe("ignore");
    dispatch(up({ ...MOUSE, button: 2, clientX: 0, clientY: 0, timeStamp: 3 }));
    expect(log).toEqual([]);

    dispatch(down({ ...MOUSE, clientX: 0, clientY: 0, timeStamp: 10, altitudeAngle: 0.3 }));
    dispatch(move({ ...MOUSE, clientX: 6, clientY: 2, timeStamp: 18, pressure: 0.9 }));
    dispatch(up({ ...MOUSE, clientX: 8, clientY: 2, timeStamp: 20 }));
    expect(log[0]).toEqual({
      kind: "start",
      stroke: { id: 1, pointerType: "mouse", pressure: false, timeStamp: 10, continued: false },
    });
    expect(ends()[0]).toMatchObject({
      pressure: false,
      tilt: false,
      samples: [{ x: 0, y: 0, t: 0 }, { x: 3, y: 1, t: 8 }, { x: 4, y: 1, t: 10 }],
    });
    for (const sample of ends()[0]!.samples) expect(Object.keys(sample)).toEqual(["x", "y", "t"]);
  });

  it("il tasto principale rilasciato con un altro ancora giù chiude il tratto", () => {
    const input = attach();
    dispatch(down({ ...MOUSE, clientX: 0, clientY: 0, timeStamp: 0 }));
    dispatch(move({ ...MOUSE, buttons: 3, clientX: 4, clientY: 0, timeStamp: 8 }));
    dispatch(move({ ...MOUSE, buttons: 2, clientX: 8, clientY: 0, timeStamp: 16 }));
    expect(ends()[0]!.samples.map(({ x }) => x)).toEqual([0, 2]);
    expect(input.roleOf(1)).toBe("ignore");
    dispatch(move({ ...MOUSE, buttons: 2, clientX: 12, clientY: 0, timeStamp: 24 }));
    dispatch(up({ ...MOUSE, button: 2, clientX: 12, clientY: 0, timeStamp: 30 }));
    expect(kinds()).toEqual(["start", "samples", "samples", "end"]);
  });

  it("un tipo di puntatore sconosciuto si comporta come il mouse", () => {
    attach();
    dispatch(down({ pointerId: 3, pointerType: "", clientX: 0, clientY: 0, timeStamp: 0 }));
    dispatch(up({ pointerId: 3, pointerType: "", clientX: 2, clientY: 0, timeStamp: 4 }));
    expect(ends()[0]).toMatchObject({ pointerType: "mouse", pressure: false });
  });

  it("una penna sospesa non disegna, né una penna appoggiata senza pressione", () => {
    const input = attach();
    for (let i = 0; i < 5; i++) {
      dispatch(move({ ...PEN, buttons: 0, pressure: 0, clientX: i, clientY: i, timeStamp: i }));
    }
    expect(log).toEqual([]);
    expect(input.penSeen).toBe(true);

    // Appoggiata a pressione 0 e alzata: nessuna traccia.
    dispatch(down({ ...PEN, pressure: 0, clientX: 0, clientY: 0, timeStamp: 10 }));
    expect(input.drawing).toBe(false);
    expect(input.roleOf(7)).toBe("ink");
    dispatch(move({ ...PEN, pressure: 0, clientX: 1, clientY: 0, timeStamp: 12 }));
    dispatch(up({ ...PEN, clientX: 1, clientY: 0, timeStamp: 14 }));
    expect(log).toEqual([]);

    // Appoggiata a pressione 0, poi preme: il tratto comincia lì, a t = 0.
    dispatch(down({ ...PEN, pressure: 0, clientX: 0, clientY: 0, timeStamp: 20 }));
    dispatch(move({ ...PEN, pressure: 0, clientX: 2, clientY: 0, timeStamp: 24 }));
    dispatch(move({
      ...PEN,
      clientX: 6,
      clientY: 0,
      timeStamp: 32,
      pressure: 0.2,
      coalescedEvents: [
        move({ ...PEN, pressure: 0, clientX: 4, clientY: 0, timeStamp: 28 }),
        move({ ...PEN, pressure: 0.1, clientX: 5, clientY: 0, timeStamp: 30 }),
        move({ ...PEN, pressure: 0.2, clientX: 6, clientY: 0, timeStamp: 32 }),
      ],
    }));
    expect(log[0]).toMatchObject({ kind: "start", stroke: { timeStamp: 30 } });
    dispatch(up({ ...PEN, clientX: 6, clientY: 0, timeStamp: 36 }));
    expect(ends()[0]!.samples).toEqual([{ x: 2.5, y: 0, p: 0.1, t: 0 }, { x: 3, y: 0, p: 0.2, t: 2 }]);
  });

  it("un campione fuori dalla scena si salta", () => {
    attach({ toScene: (x, y) => (x === 99 ? { x: Number.NaN, y } : { x, y }) });
    dispatch(down({ ...MOUSE, clientX: 0, clientY: 0, timeStamp: 0 }));
    dispatch(move({ ...MOUSE, clientX: 99, clientY: 0, timeStamp: 4 }));
    dispatch(move({ ...MOUSE, clientX: 5, clientY: 0, timeStamp: 8 }));
    dispatch(up({ ...MOUSE, clientX: 5, clientY: 0, timeStamp: 9 }));
    expect(ends()[0]!.samples).toEqual([{ x: 0, y: 0, t: 0 }, { x: 5, y: 0, t: 8 }]);
  });

  it("un tratto alla volta: un secondo puntatore che disegnerebbe è ignorato", () => {
    const input = attach();
    dispatch(down({ ...PEN, clientX: 0, clientY: 0, timeStamp: 0 }));
    dispatch(down({ ...MOUSE, clientX: 50, clientY: 50, timeStamp: 2 }));
    expect(input.roleOf(1)).toBe("ignore");
    dispatch(move({ ...MOUSE, clientX: 60, clientY: 50, timeStamp: 4 }));
    dispatch(up({ ...MOUSE, clientX: 60, clientY: 50, timeStamp: 5 }));
    dispatch(up({ ...PEN, clientX: 0, clientY: 0, timeStamp: 6 }));
    expect(ends()).toHaveLength(1);
    expect(ends()[0]!.pointerType).toBe("pen");
  });

  describe("limite dei campioni", () => {
    it("divide il tratto senza buchi: la giunzione chiude il primo e apre il secondo", () => {
      attach({ maxSamples: 4 });
      dispatch(down({ ...PEN, clientX: 0, clientY: 0, timeStamp: 100 }));
      for (let i = 1; i <= 7; i++) {
        dispatch(move({ ...PEN, clientX: i * 2, clientY: 0, pressure: 0.1 * i, timeStamp: 100 + i * 10 }));
      }
      dispatch(up({ ...PEN, clientX: 14, clientY: 0, timeStamp: 175 }));
      const strokes = ends();
      expect(strokes.map(({ id, continued, split, timeStamp }) => ({ id, continued, split, timeStamp }))).toEqual([
        { id: 1, continued: false, split: true, timeStamp: 100 },
        { id: 2, continued: true, split: true, timeStamp: 130 },
        { id: 3, continued: true, split: false, timeStamp: 160 },
      ]);
      expect(strokes.map(({ samples }) => samples.map(({ x, t }) => [x, t]))).toEqual([
        [[0, 0], [1, 10], [2, 20], [3, 30]],
        [[3, 0], [4, 10], [5, 20], [6, 30]],
        [[6, 0], [7, 10]],
      ]);
      // La giunzione ha la stessa pressione nei due pezzi.
      expect(strokes[1]!.samples[0]!.p).toBe(strokes[0]!.samples[3]!.p);
      // Ogni pezzo ha ricevuto con onSamples esattamente i suoi campioni.
      for (const stroke of strokes) expect(delivered(stroke.id)).toEqual(stroke.samples.map((s) => ({ ...s, a: 90, z: 0 })));
      expect(kinds().filter((kind) => kind !== "samples")).toEqual(["start", "end", "start", "end", "start", "end"]);
      // Ogni pezzo si quantizza da solo.
      for (const stroke of strokes) expect(() => quantizeInk(stroke.samples)).not.toThrow();
    });

    it("divide anche dentro una lista coalescente e sull'ultimo punto dell'alzata", () => {
      attach({ maxSamples: 3 });
      dispatch(down({ ...MOUSE, clientX: 0, clientY: 0, timeStamp: 0 }));
      dispatch(move({
        ...MOUSE,
        clientX: 8,
        clientY: 0,
        timeStamp: 4,
        coalescedEvents: [1, 2, 3, 4].map((t) => move({ ...MOUSE, clientX: t * 2, clientY: 0, timeStamp: t })),
      }));
      expect(ends().map(({ samples }) => samples.map(({ x }) => x))).toEqual([[0, 1, 2]]);
      dispatch(up({ ...MOUSE, clientX: 10, clientY: 0, timeStamp: 6 }));
      expect(ends().map(({ samples }) => samples.map(({ x }) => x))).toEqual([[0, 1, 2], [2, 3, 4], [4, 5]]);
      expect(delivered(3)).toEqual([{ x: 4, y: 0, t: 0 }, { x: 5, y: 0, t: 2 }]);
    });

    it("al default un tratto di 10 000 campioni non si divide, il successivo sì", () => {
      attach();
      dispatch(down({ ...PEN, clientX: 0, clientY: 0, timeStamp: 0 }));
      for (let i = 1; i < INK_MAX_SAMPLES; i++) {
        dispatch(move({ ...PEN, clientX: i % 300, clientY: Math.floor(i / 300), timeStamp: i }));
      }
      expect(ends()).toEqual([]);
      dispatch(move({ ...PEN, clientX: 5000, clientY: 0, timeStamp: INK_MAX_SAMPLES }));
      dispatch(up({ ...PEN, clientX: 5000, clientY: 0, timeStamp: INK_MAX_SAMPLES + 1 }));
      const [first, second] = ends();
      expect(first!.samples).toHaveLength(INK_MAX_SAMPLES);
      expect(first!.split).toBe(true);
      expect(second!.samples).toHaveLength(2);
      expect(second!.samples[0]).toEqual({ ...first!.samples[INK_MAX_SAMPLES - 1], t: 0 });
      expect(quantizeInk(first!.samples).samples).toHaveLength(INK_MAX_SAMPLES);
    });

    it("rifiuta un limite che non sta fra 2 e 10 000", () => {
      for (const maxSamples of [1, 0, 2.5, INK_MAX_SAMPLES + 1, Number.NaN]) {
        expect(() => attach({ maxSamples })).toThrow(RangeError);
      }
    });
  });

  describe("callback che rientrano", () => {
    it("cancel dentro onSamples ferma il tratto subito", () => {
      let input: PenInput | null = null;
      input = attach({
        onSamples: (id, samples) => {
          log.push({ kind: "samples", id, samples: [...samples] });
          if (samples.some((sample) => sample.x > 1)) input!.cancel();
        },
      });
      dispatch(down({ ...MOUSE, clientX: 0, clientY: 0, timeStamp: 0 }));
      dispatch(move({
        ...MOUSE,
        clientX: 8,
        clientY: 0,
        timeStamp: 8,
        predictedEvents: [move({ ...MOUSE, clientX: 10, clientY: 0, timeStamp: 12 })],
      }));
      dispatch(move({ ...MOUSE, clientX: 9, clientY: 0, timeStamp: 9 }));
      dispatch(up({ ...MOUSE, clientX: 9, clientY: 0, timeStamp: 10 }));
      expect(kinds()).toEqual(["start", "samples", "samples", "cancel"]);
      expect(latest()).toEqual({ kind: "cancel", id: 1, reason: "api" });
    });

    it("cancel dentro onStart non lascia campioni orfani", () => {
      let input: PenInput | null = null;
      input = attach({
        onStart: (stroke) => {
          log.push({ kind: "start", stroke });
          input!.cancel();
        },
      });
      dispatch(down({ ...MOUSE, clientX: 0, clientY: 0, timeStamp: 0 }));
      dispatch(up({ ...MOUSE, clientX: 0, clientY: 0, timeStamp: 1 }));
      expect(kinds()).toEqual(["start", "cancel"]);
    });

    it("cancel dentro onEnd del primo pezzo ferma la continuazione prima che cominci", () => {
      let input: PenInput | null = null;
      input = attach({
        maxSamples: 2,
        onEnd: (stroke) => {
          log.push({ kind: "end", stroke });
          input!.cancel();
        },
      });
      dispatch(down({ ...MOUSE, clientX: 0, clientY: 0, timeStamp: 0 }));
      dispatch(move({ ...MOUSE, clientX: 2, clientY: 0, timeStamp: 1 }));
      dispatch(move({ ...MOUSE, clientX: 4, clientY: 0, timeStamp: 2 }));
      dispatch(move({ ...MOUSE, clientX: 6, clientY: 0, timeStamp: 3 }));
      dispatch(up({ ...MOUSE, clientX: 6, clientY: 0, timeStamp: 4 }));
      expect(kinds()).toEqual(["start", "samples", "samples", "end"]);
      expect(ends()[0]!.split).toBe(true);
    });

    it("destroy dentro una callback non consegna altro", () => {
      let input: PenInput | null = null;
      input = attach({
        onSamples: (id, samples) => {
          log.push({ kind: "samples", id, samples: [...samples] });
          input!.destroy();
        },
      });
      dispatch(down({ ...MOUSE, clientX: 0, clientY: 0, timeStamp: 0 }));
      dispatch(move({ ...MOUSE, clientX: 2, clientY: 0, timeStamp: 1 }));
      expect(kinds()).toEqual(["start", "samples", "cancel"]);
      expect(latest()).toEqual({ kind: "cancel", id: 1, reason: "destroy" });
    });
  });

  describe("smontaggio", () => {
    type Registration = readonly [EventTarget, string, EventListenerOrEventListenerObject | null, boolean];

    function capture(options: boolean | EventListenerOptions | undefined): boolean {
      return typeof options === "boolean" ? options : options?.capture === true;
    }

    function spyListeners(targets: readonly EventTarget[]): { added: Registration[]; removed: Registration[] } {
      const added: Registration[] = [];
      const removed: Registration[] = [];
      for (const target of targets) {
        const add = target.addEventListener.bind(target);
        const remove = target.removeEventListener.bind(target);
        vi.spyOn(target, "addEventListener").mockImplementation((type, listener, options) => {
          added.push([target, type, listener, capture(options)]);
          add(type, listener, options);
        });
        vi.spyOn(target, "removeEventListener").mockImplementation((type, listener, options) => {
          removed.push([target, type, listener, capture(options)]);
          remove(type, listener, options);
        });
      }
      return { added, removed };
    }

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("destroy a metà tratto annulla, toglie ogni ascoltatore con la sua fase ed è idempotente", () => {
      const { added, removed } = spyListeners([surface, document, window]);
      const input = attach();
      expect(added.length).toBeGreaterThan(0);
      expect(new Set(added.map(([target]) => target))).toEqual(new Set([surface, document, window]));
      dispatch(down({ ...PEN, clientX: 0, clientY: 0, timeStamp: 0 }));
      dispatch(move({ ...PEN, clientX: 4, clientY: 0, timeStamp: 8 }));
      input.destroy();
      expect(latest()).toEqual({ kind: "cancel", id: 1, reason: "destroy" });
      expect(surface.hasPointerCapture(7)).toBe(false);
      // Ogni registrazione è tolta con lo stesso bersaglio, tipo, funzione e fase.
      expect(removed).toHaveLength(added.length);
      for (const registration of added) {
        expect(removed.some((r) => r.every((value, i) => value === registration[i]))).toBe(true);
      }
      const count = log.length;
      input.destroy();
      owner.close();
      expect(removed).toHaveLength(added.length);
      // Sordo: nessun evento arriva più.
      dispatch(move({ ...PEN, clientX: 8, clientY: 0, timeStamp: 16 }));
      dispatch(up({ ...PEN, clientX: 8, clientY: 0, timeStamp: 20 }));
      dispatch(down({ ...MOUSE, clientX: 0, clientY: 0, timeStamp: 30 }));
      expect(log).toHaveLength(count);
      expect(input.drawing).toBe(false);
      expect(input.roleOf(1)).toBeNull();
      input.cancel();
      expect(log).toHaveLength(count);
    });

    it("chiudere il padrone smonta la pipeline", () => {
      const { added, removed } = spyListeners([surface, document, window]);
      attach();
      dispatch(down({ ...MOUSE, clientX: 0, clientY: 0, timeStamp: 0 }));
      owner.close();
      expect(latest()).toEqual({ kind: "cancel", id: 1, reason: "destroy" });
      expect(removed).toHaveLength(added.length);
    });

    it("un padrone già chiuso lascia la pipeline sorda fin dall'inizio", () => {
      owner.close();
      const { added, removed } = spyListeners([surface, document, window]);
      const input = attach();
      expect(removed).toHaveLength(added.length);
      dispatch(down({ ...MOUSE, clientX: 0, clientY: 0, timeStamp: 0 }));
      expect(log).toEqual([]);
      expect(input.drawing).toBe(false);
    });
  });
});
