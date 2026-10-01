// Test della gelatina: oscillatori di sola resa, pilotati dalle velocità.
// Niente DOM e niente motore: le velocità della struttura si scrivono a mano.

import { describe, expect, it } from "vitest";
import { createStructure, organicConfig, type GraphData, type Structure } from "./types";
import { NODE_CAP, createWobble, deformationOf, kick, stepWobble } from "./wobble";

const DATA: GraphData = { nodes: ["a", "b"], edges: [{ from: "a", to: "b" }] };

/// Due nodi in orizzontale (a a sinistra di b), un arco a→b.
function pair(): Structure {
  const s = createStructure(DATA, organicConfig(), 1);
  s.x[0] = -50;
  s.y[0] = 0;
  s.x[1] = 50;
  s.y[1] = 0;
  return s;
}

const shape = { angle: 0, stretch: 1 };

/// Fa girare la gelatina per `seconds` a `hz` fotogrammi al secondo.
function run(w: ReturnType<typeof createWobble>, s: Structure, seconds: number, hz: number, intensity = 1): void {
  const frames = Math.round(seconds * hz);
  for (let k = 0; k < frames; k++) stepWobble(w, s, 1 / hz, intensity, 1);
}

describe("gelatina", () => {
  it("a riposo resta tonda e non tiene acceso il loop", () => {
    const s = pair();
    const w = createWobble(s);
    expect(stepWobble(w, s, 1 / 60, 1, 1)).toBe(false);
    deformationOf(w, 0, shape);
    expect(shape.stretch).toBe(1);
    expect(w.bend[0]).toBe(0);
  });

  it("una scossa oscilla (la forma si inverte) e si spegne entro un secondo", () => {
    const s = pair();
    const w = createWobble(s);
    kick(w, 0, 0.3, 0);
    let sawPositive = false;
    let sawNegative = false;
    for (let k = 0; k < 60; k++) {
      stepWobble(w, s, 1 / 60, 1, 1);
      if (w.e1[0] > 0.02) sawPositive = true;
      if (w.e1[0] < -0.02) sawNegative = true;
    }
    expect(sawPositive).toBe(true);
    expect(sawNegative).toBe(true);
    // Un secondo dopo: tutto fermo, il loop può dormire.
    expect(stepWobble(w, s, 1 / 60, 1, 1)).toBe(false);
    expect(w.e1[0]).toBe(0);
  });

  it("la risposta non dipende dal ritmo dei fotogrammi", () => {
    const at = (hz: number): number => {
      const s = pair();
      const w = createWobble(s);
      kick(w, 0, 0.3, 0);
      // Un sesto di secondo è un numero intero di fotogrammi a 30, 60 e 144 Hz.
      run(w, s, 1 / 6, hz);
      return w.e1[0];
    };
    const ref = at(60);
    expect(Math.abs(ref)).toBeGreaterThan(0.05);
    expect(at(30)).toBeCloseTo(ref, 2);
    expect(at(144)).toBeCloseTo(ref, 2);
  });

  it("un nodo in volo si allunga lungo il moto, entro il massimo", () => {
    const s = pair();
    const w = createWobble(s);
    // In diagonale, veloce: l'asse è a 45°.
    s.vx[0] = 4000;
    s.vy[0] = 4000;
    run(w, s, 0.5, 60);
    deformationOf(w, 0, shape);
    expect(shape.angle).toBeCloseTo(Math.PI / 4, 1);
    expect(shape.stretch).toBeGreaterThan(1.2);
    expect(shape.stretch).toBeLessThanOrEqual(1 + NODE_CAP + 0.05);
    // L'altro nodo è fermo e resta tondo.
    deformationOf(w, 1, shape);
    expect(shape.stretch).toBeLessThan(1.05);
  });

  it("a una frenata di colpo il nodo si schiaccia sulla direzione in cui andava", () => {
    const s = pair();
    const w = createWobble(s);
    s.vx[0] = 4000;
    run(w, s, 0.5, 60);
    expect(w.e1[0]).toBeGreaterThan(0); // allungato in orizzontale
    s.vx[0] = 0; // l'urto
    let squashed = false;
    for (let k = 0; k < 30; k++) {
      stepWobble(w, s, 1 / 60, 1, 1);
      if (w.e1[0] < -0.02) squashed = true;
    }
    expect(squashed).toBe(true);
  });

  it("a intensità 0 non succede niente, e una gelatina viva torna a riposo", () => {
    const s = pair();
    const w = createWobble(s);
    kick(w, 0, 0.3, 0);
    s.vx[0] = 4000;
    expect(stepWobble(w, s, 1 / 60, 0, 1)).toBe(false);
    expect(w.e1[0]).toBe(0);
    expect(w.v1[0]).toBe(0);
  });

  it("a sim ferma (scala 0) le velocità rimaste non deformano niente", () => {
    const s = pair();
    const w = createWobble(s);
    s.vx[0] = 4000;
    for (let k = 0; k < 60; k++) stepWobble(w, s, 1 / 60, 1, 0);
    expect(w.moving).toBe(false);
  });

  it("un arco trascinato di traverso si piega all'indietro e poi vibra", () => {
    const s = pair();
    const w = createWobble(s);
    // L'arco va da a (sinistra) a b (destra): la normale del pittore è (0, 1).
    // Gli estremi si muovono verso +y: il centro resta indietro, verso −y.
    s.vy[0] = 3000;
    s.vy[1] = 3000;
    run(w, s, 0.3, 60);
    expect(w.bend[0]).toBeLessThan(-0.05);
    s.vy[0] = 0;
    s.vy[1] = 0;
    let overshoot = false;
    for (let k = 0; k < 30; k++) {
      stepWobble(w, s, 1 / 60, 1, 1);
      if (w.bend[0] > 0.02) overshoot = true;
    }
    expect(overshoot).toBe(true);
  });
});
