import { describe, expect, it } from "vitest";
import { CANVAS_JUMP_LIMIT, CanvasJumps, type JumpCamera } from "./jumps";

/** Una camera di prova: lo zoom dice quale è, così le prove leggono una sola cifra. */
const at = (zoom: number): JumpCamera => ({ x: zoom * 10, y: -zoom, zoom });

describe("la pila dei salti (T56)", () => {
  it("con la pila vuota Indietro e Avanti non vanno da nessuna parte", () => {
    const jumps = new CanvasJumps();
    expect(jumps.back()).toBeNull();
    expect(jumps.forward()).toBeNull();
  });

  it("Indietro torna alla camera di prima di un salto, Avanti alla camera dopo, e si ferma ai due estremi", () => {
    const jumps = new CanvasJumps();
    jumps.record(at(1), at(2));
    expect(jumps.forward()).toBeNull();
    expect(jumps.back()).toEqual(at(1));
    expect(jumps.back()).toBeNull();
    expect(jumps.forward()).toEqual(at(2));
    expect(jumps.forward()).toBeNull();
  });

  it("più salti si rifanno in ordine, all'indietro e in avanti", () => {
    const jumps = new CanvasJumps();
    jumps.record(at(1), at(2));
    jumps.record(at(2), at(3));
    jumps.record(at(3), at(4));
    expect(jumps.back()).toEqual(at(3));
    expect(jumps.back()).toEqual(at(2));
    expect(jumps.forward()).toEqual(at(3));
    expect(jumps.back()).toEqual(at(2));
    expect(jumps.back()).toEqual(at(1));
    expect(jumps.back()).toBeNull();
  });

  it("un salto dopo un Indietro perde l'Avanti, come nel browser", () => {
    const jumps = new CanvasJumps();
    jumps.record(at(1), at(2));
    jumps.record(at(2), at(3));
    expect(jumps.back()).toEqual(at(2));
    jumps.record(at(2), at(5));
    expect(jumps.forward()).toBeNull();
    expect(jumps.back()).toEqual(at(2));
    expect(jumps.back()).toEqual(at(1));
    expect(jumps.back()).toBeNull();
  });

  it("tiene al più CANVAS_JUMP_LIMIT salti: i più vecchi cadono", () => {
    expect(CANVAS_JUMP_LIMIT).toBe(50);
    const jumps = new CanvasJumps();
    // Sessanta salti: restano gli ultimi cinquanta, da quello che parte da 10.
    for (let i = 0; i < 60; i++) jumps.record(at(i), at(i + 1));
    for (let i = 59; i >= 10; i--) expect(jumps.back()).toEqual(at(i));
    expect(jumps.back()).toBeNull();
  });

  it("la camera registrata non segue chi la muove dopo, e quella restituita è una copia nuova", () => {
    const jumps = new CanvasJumps();
    const from = { x: 1, y: 2, zoom: 1 };
    const to = { x: 3, y: 4, zoom: 2 };
    jumps.record(from, to);
    from.x = 99;
    to.zoom = 99;
    const first = jumps.back();
    expect(first).toEqual({ x: 1, y: 2, zoom: 1 });
    expect(jumps.forward()).toEqual({ x: 3, y: 4, zoom: 2 });
    const second = jumps.back();
    expect(second).toEqual({ x: 1, y: 2, zoom: 1 });
    expect(second).not.toBe(first);
  });
});
