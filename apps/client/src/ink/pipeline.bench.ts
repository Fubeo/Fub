// @vitest-environment happy-dom
// Quanto costa il percorso caldo dell'inchiostro, in TypeScript.
//
// Si lancia con `npm run bench:ink`. Stampa, per ogni scenario, la mediana dei
// giri in nanosecondi per evento. È l'equivalente di `cargo bench -p fub-ink`,
// che misura lo stesso riduttore in Rust: serve a vedere una regressione di
// ordine di grandezza e a sapere quanto margine ha il budget di un evento (a
// 240 Hz, 4 166 667 ns), non a decidere un decimale. Non asserisce tempi, che
// su una macchina carica non sono stabili: asserisce soltanto che il lavoro
// c'è stato. Ha la sua configurazione (`bench/vitest.ink.config.ts`) perché
// non è un test e non deve girare con la suite.
//
// Tre cose diverse, perché hanno costi e padroni diversi:
//
// - il riduttore (`Session`), senza browser: la parte portabile;
// - l'adattatore del browser sopra eventi veri di happy-dom, il cui costo di
//   `dispatchEvent` è nel numero: confronta fra versioni dell'adattatore, non
//   con Rust;
// - l'anteprima (`previewOutline`), che a ogni movimento rifà il contorno di
//   tutto il tratto: cresce con la sua lunghezza, ed è la parte che pesa.

import { describe, expect, it } from "vitest";
import { openLifetime } from "../ui/lifetime";
import { attachInkInput } from "./dom/pointer-adapter";
import { pointerSample, type InkPointerType, type PointerSample } from "./input/pointer";
import { Session } from "./input/session";
import type { StabilizerConfig } from "./input/stabilizer";
import type { InkSample } from "./sample";
import { PEN } from "./tools/pen";
import { previewOutline } from "./tools/stroke";

/// Misura `fn`, che fa il lavoro di `events` eventi: qualche giro per scaldare,
/// poi giri per un secondo e mezzo almeno (e cinque in ogni caso); stampa la
/// mediana e il minimo in nanosecondi per evento.
function measure(label: string, events: number, fn: () => number): void {
  it(label, () => {
    for (let i = 0; i < 3; i++) fn();
    const runs: number[] = [];
    let work = 0;
    const end = performance.now() + 1_500;
    while (performance.now() < end || runs.length < 5) {
      const start = performance.now();
      work += fn();
      runs.push(performance.now() - start);
    }
    runs.sort((a, b) => a - b);
    const nanos = (ms: number): number => Math.round((ms * 1e6) / events);
    console.info(`${label.padEnd(46)} ${String(nanos(runs[runs.length >> 1]!)).padStart(9)} ns/evento (minimo ${nanos(runs[0]!)}, ${runs.length} giri)`);
    expect(work).toBeGreaterThan(0);
  }, 120_000);
}

/// Il campione in `at`, misurato in eventi (frazionario per i coalescenti):
/// un cerchio lento, 4 ms fra un evento e l'altro.
function sampleAt(kind: InkPointerType, at: number): PointerSample {
  const phase = at * 0.01;
  return pointerSample({
    pointerId: 1,
    pointerType: kind,
    x: 400 + 300 * Math.cos(phase),
    y: 300 + 200 * Math.sin(phase),
    timeStamp: at * 4,
    pressure: kind === "pen" ? 0.2 + 0.6 * (Math.sin(phase) * 0.5 + 0.5) : 0.5,
  });
}

interface Flow {
  readonly down: PointerSample;
  readonly moves: ReadonlyArray<{ readonly coalesced: PointerSample[]; readonly event: PointerSample; readonly predicted: PointerSample[] }>;
  readonly up: PointerSample;
}

/// Un tratto di `events` eventi: la stessa forma di quello di `benches/pipeline.rs`.
function flow(kind: InkPointerType, events: number, coalesced: number, predicted: number): Flow {
  const moves = [];
  for (let i = 1; i < events; i++) {
    moves.push({
      coalesced: Array.from({ length: coalesced }, (_, k) => sampleAt(kind, i - 1 + (k + 1) / (coalesced + 1))),
      event: sampleAt(kind, i),
      predicted: Array.from({ length: predicted }, (_, k) => sampleAt(kind, i + k + 1)),
    });
  }
  return { down: sampleAt(kind, 0), moves, up: sampleAt(kind, events) };
}

function run(session: Session, stroke: Flow): number {
  let effects = session.pointerDown(stroke.down).length;
  for (const move of stroke.moves) effects += session.pointerMove(move.coalesced, move.event, move.predicted).length;
  return effects + session.pointerUp(stroke.up).length;
}

const EVENTS = 2_000;
const MEAN: StabilizerConfig = { amount: 0.5, pulledString: false, catchUp: true, catchUpOnEnd: true };
const mouse = flow("mouse", EVENTS, 0, 0);
const pen = flow("pen", EVENTS, 4, 3);

describe(`riduttore (Session), ${EVENTS} eventi per iterazione`, () => {
  measure("mouse, senza coalescenti", EVENTS, () => run(new Session(), mouse));
  measure("penna 240 Hz, 4 coalescenti, 3 predetti", EVENTS, () => run(new Session(), pen));
  measure("penna con stabilizzatore a media", EVENTS, () => run(new Session({ stabilizer: MEAN }), pen));
});

describe("adattatore del browser (happy-dom), 500 eventi per iterazione", () => {
  const events = 500;

  function pointerEvent(type: string, init: PointerEventInit & { timeStamp: number }): PointerEvent {
    const { timeStamp, ...rest } = init;
    const event = new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, isPrimary: true, altitudeAngle: Math.PI / 2, azimuthAngle: 0, ...rest });
    Object.defineProperty(event, "timeStamp", { value: timeStamp });
    return event;
  }

  /// Gli eventi di un tratto, già costruiti: l'iterazione misura l'adattatore e
  /// non la costruzione.
  function dom(kind: "mouse" | "pen", coalesced: number): PointerEvent[] {
    const device = { pointerId: 1, pointerType: kind };
    const at = (i: number): PointerEventInit & { timeStamp: number } => ({
      ...device,
      clientX: 400 + 300 * Math.cos(i * 0.01),
      clientY: 300 + 200 * Math.sin(i * 0.01),
      pressure: 0.5,
      button: -1,
      buttons: 1,
      timeStamp: i * 4,
    });
    const list = [pointerEvent("pointerdown", { ...at(0), button: 0 })];
    for (let i = 1; i < events; i++) {
      const group = Array.from({ length: coalesced }, (_, k) => pointerEvent("pointermove", at(i - 1 + (k + 1) / (coalesced + 1))));
      list.push(pointerEvent("pointermove", { ...at(i), coalescedEvents: group }));
    }
    list.push(pointerEvent("pointerup", { ...at(events), button: 0, buttons: 0, pressure: 0 }));
    return list;
  }

  const mouseEvents = dom("mouse", 0);
  const penEvents = dom("pen", 4);

  function stroke(list: readonly PointerEvent[]): number {
    const owner = openLifetime();
    const surface = document.createElement("div");
    document.body.append(surface);
    let samples = 0;
    attachInkInput(
      surface,
      {
        toScene: (x, y) => ({ x, y }),
        onStart: () => {},
        onSamples: (_id, list) => void (samples += list.length),
        onEnd: () => {},
        onCancel: () => {},
      },
      owner,
    );
    for (const event of list) surface.dispatchEvent(event);
    owner.close();
    surface.remove();
    return samples;
  }

  measure("mouse", events, () => stroke(mouseEvents));
  measure("penna, 4 coalescenti", events, () => stroke(penEvents));
});

describe("anteprima: il contorno di tutto il tratto, a ogni movimento (ns per anteprima)", () => {
  const brush = PEN.brush(4, { pressure: true, continued: false });
  const line = (n: number): InkSample[] =>
    Array.from({ length: n }, (_, i): InkSample => ({ x: 400 + 300 * Math.cos(i * 0.01), y: 300 + 200 * Math.sin(i * 0.01), t: i * 4, p: 0.3 + ((i * 7) % 10) / 20 }));
  for (const n of [100, 1_000, 5_000, 10_000]) {
    const samples = line(n);
    measure(`${n} campioni`, 1, () => previewOutline(samples, [], brush, false).length);
  }
});
