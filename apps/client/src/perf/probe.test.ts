// @vitest-environment happy-dom
//
// La sonda delle prestazioni con un orologio e dei fotogrammi finti: si guarda
// la regola (dall'evento al secondo fotogramma, i fotogrammi lunghi, le soglie
// del referto), non il tempo vero di questa macchina.
import { afterEach, describe, expect, it } from "vitest";
import { openLifetime, type Lifetime } from "../ui/lifetime";
import { createProbe, summarize, type ProbeClock } from "./probe";

/// Fotogrammi a mano: `frame(ms)` porta avanti l'orologio e fa girare i
/// callback in attesa, come fa il browser a ogni fotogramma.
function fakeClock(): ProbeClock & { frame(ms: number): void; pending(): number } {
  let now = 0;
  let next = 1;
  const waiting = new Map<number, (time: number) => void>();
  return {
    now: () => now,
    request: (callback) => {
      const id = next++;
      waiting.set(id, callback);
      return id;
    },
    cancel: (id) => void waiting.delete(id),
    frame(ms) {
      now += ms;
      const due = [...waiting.entries()];
      waiting.clear();
      for (const [, callback] of due) callback(now);
    },
    pending: () => waiting.size,
  };
}

function keydown(at: number): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key: "a", bubbles: true });
  Object.defineProperty(event, "timeStamp", { value: at });
  return event;
}

function pointer(type: string, pointerType: string, at: number): Event {
  const event = new Event(type, { bubbles: true });
  Object.defineProperties(event, { timeStamp: { value: at }, pointerType: { value: pointerType } });
  return event;
}

describe("il riassunto dei campioni", () => {
  it("dà conteggio, mediana, p95 e massimo; senza campioni zero", () => {
    expect(summarize([])).toEqual({ count: 0, p50: 0, p95: 0, max: 0 });
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(summarize(values)).toEqual({ count: 100, p50: 50, p95: 95, max: 100 });
    expect(summarize([7])).toEqual({ count: 1, p50: 7, p95: 7, max: 7 });
  });
});

describe("la sonda", () => {
  let lifetime: Lifetime;
  afterEach(() => lifetime.close());

  it("misura un tasto fino al fotogramma che lo mostra: il secondo dopo l'evento", () => {
    lifetime = openLifetime();
    const clock = fakeClock();
    const probe = createProbe(lifetime, clock);
    probe.start();
    document.dispatchEvent(keydown(0));
    clock.frame(5); // il fotogramma con la modifica sta per essere disegnato
    clock.frame(16); // consegnato
    const report = probe.stop();
    expect(report.input.key).toMatchObject({ count: 1, max: 21 });
  });

  it("separa la penna dal puntatore e misura anche il tratto, un campione in volo alla volta", () => {
    lifetime = openLifetime();
    const clock = fakeClock();
    const probe = createProbe(lifetime, clock);
    probe.start();
    document.dispatchEvent(pointer("pointerdown", "mouse", 0));
    clock.frame(8);
    clock.frame(8);
    document.dispatchEvent(pointer("pointerdown", "pen", 16));
    document.dispatchEvent(pointer("pointermove", "pen", 17));
    document.dispatchEvent(pointer("pointermove", "pen", 18));
    clock.frame(8);
    clock.frame(8);
    const report = probe.stop();
    expect(report.input.pointer.count).toBe(1);
    // Il primo movimento aspetta il campione del `pointerdown`: un fotogramma
    // conta una volta, non una per ogni evento che il sistema ha consegnato.
    expect(report.input.pen.count).toBe(1);
    expect(report.input.pen.max).toBe(16);
  });

  it("conta i fotogrammi lunghi dalla distanza fra due fotogrammi", () => {
    lifetime = openLifetime();
    const clock = fakeClock();
    const probe = createProbe(lifetime, clock);
    probe.start();
    for (const gap of [16, 16, 40, 16, 60, 16]) clock.frame(gap);
    const report = probe.stop();
    expect(report.frames).toMatchObject({ count: 6, max: 60, over33: 2, over50: 1 });
  });

  it("aspetta un segno nel DOM e misura dall'ultimo gesto al fotogramma che lo mostra", async () => {
    lifetime = openLifetime();
    const clock = fakeClock();
    const probe = createProbe(lifetime, clock);
    probe.start();
    document.dispatchEvent(pointer("pointerdown", "mouse", 0));
    const shown = probe.waitFor("noteSwitch", "#nota", 1_000);
    clock.frame(16);
    const note = document.createElement("div");
    note.id = "nota";
    document.body.append(note);
    clock.frame(16); // vede il segno
    clock.frame(16); // lo disegna
    clock.frame(16); // consegnato
    await expect(shown).resolves.toBe(true);
    const report = probe.stop();
    expect(report.marks.noteSwitch).toMatchObject({ count: 1, max: 64 });
    note.remove();
  });

  it("col testo, il segno vale solo quando dice quel testo: una nota, non la precedente", async () => {
    lifetime = openLifetime();
    const clock = fakeClock();
    const probe = createProbe(lifetime, clock);
    probe.start();
    const pane = document.createElement("div");
    pane.id = "riquadro";
    pane.textContent = "Nota 1";
    document.body.append(pane);
    const shown = probe.waitFor("noteSwitch", "#riquadro", 1_000, "Nota 2");
    clock.frame(16);
    clock.frame(16);
    expect(probe.stop().marks.noteSwitch, "la nota di prima non conta").toBeUndefined();
    probe.start();
    const again = probe.waitFor("noteSwitch", "#riquadro", 1_000, "Nota 2");
    pane.textContent = "Nota 2";
    for (let i = 0; i < 3; i++) clock.frame(16);
    await expect(again).resolves.toBe(true);
    await expect(shown).resolves.toBe(false);
    pane.remove();
  });

  it("un segno che non arriva entro il tempo dice false e non lascia fotogrammi in attesa", async () => {
    lifetime = openLifetime();
    const clock = fakeClock();
    const probe = createProbe(lifetime, clock);
    probe.start();
    const shown = probe.waitFor("noteSwitch", "#mai", 30);
    clock.frame(16);
    clock.frame(16);
    await expect(shown).resolves.toBe(false);
    probe.stop();
    expect(clock.pending()).toBe(0);
  });

  it("spenta, non ascolta e non tiene fotogrammi; smontata, nemmeno", () => {
    lifetime = openLifetime();
    const clock = fakeClock();
    const probe = createProbe(lifetime, clock);
    document.dispatchEvent(keydown(0));
    clock.frame(16);
    expect(clock.pending()).toBe(0);
    probe.start();
    expect(clock.pending()).toBe(1);
    lifetime.close();
    expect(clock.pending()).toBe(0);
    document.dispatchEvent(keydown(0));
    expect(clock.pending()).toBe(0);
  });
});
