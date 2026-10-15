// Gli id di §7: forma, uniformità dei caratteri e ritentativi.

import { describe, expect, it } from "vitest";
import { createId, DEFS_ID, isNewId, PAPER_ID, type RandomBytes } from "./ids";

/// Una sorgente che restituisce `values` in giro, byte dopo byte.
function cycle(values: readonly number[]): RandomBytes {
  let next = 0;
  return (bytes) => {
    for (let i = 0; i < bytes.length; i++) bytes[i] = values[next++ % values.length]!;
  };
}

describe("gli id di FubDraw (§7)", () => {
  it("un oggetto è o e 8 caratteri base36, un livello l e 8, una risorsa r e 8", () => {
    for (let i = 0; i < 200; i++) {
      expect(createId("object", () => false)).toMatch(/^o[0-9a-z]{8}$/);
      expect(createId("layer", () => false)).toMatch(/^l[0-9a-z]{8}$/);
      expect(createId("resource", () => false)).toMatch(/^r[0-9a-z]{8}$/);
    }
    expect(PAPER_ID).toBe("fub-paper");
    expect(DEFS_ID).toBe("fub-defs");
  });

  it("riconosce la forma degli id nuovi", () => {
    expect(isNewId("o7k2m9x4q", "object")).toBe(true);
    expect(isNewId("l3f8a0c2d", "layer")).toBe(true);
    for (const id of ["l3f8a0c2d", "o7k2m9x4", "o7k2m9x4qq", "O7K2M9X4Q", "o7k2m9x4-", "o7k2m9x4é", "", "fub-paper", "#root"]) {
      expect(isNewId(id, "object"), id).toBe(false);
    }
    expect(isNewId("o7k2m9x4q", "layer")).toBe(false);
    expect(isNewId("r1a2b3c4d", "resource")).toBe(true);
    expect(isNewId("o7k2m9x4q", "resource")).toBe(false);
    expect(isNewId("fub-defs", "resource")).toBe(false);
  });

  it("ogni carattere è uniforme: i byte da 252 in su si scartano", () => {
    // I byte 0…251 una volta ciascuno, alternati a byte da scartare: ogni
    // richiesta di 16 byte dà esattamente un id, e ogni carattere esce sette
    // volte.
    const bytes: number[] = [];
    for (let b = 0; b < 252; b++) bytes.push(b, 252 + (b % 4));
    const random = cycle(bytes);
    const counts = new Map<string, number>();
    // I 252 byte buoni sono 31 id e mezzo: se ne generano 32 e si contano i
    // primi 252 caratteri, un giro esatto della sorgente.
    let all = "";
    for (let i = 0; i < 32; i++) all += createId("object", () => false, random).slice(1);
    for (const c of all.slice(0, 252)) counts.set(c, (counts.get(c) ?? 0) + 1);
    expect(counts.size).toBe(36);
    expect([...counts.values()].every((n) => n === 7)).toBe(true);
    expect(all.slice(0, 9)).toBe("012345678");
  });

  it("un id già usato si scarta e se ne genera un altro", () => {
    const taken = new Set(["o00000000"]);
    // Ogni tentativo chiede 16 byte: i primi 16 danno o00000000, i
    // successivi o11111111.
    const random = cycle([...Array<number>(16).fill(0), ...Array<number>(16).fill(1)]);
    expect(createId("object", (id) => taken.has(id), random)).toBe("o11111111");
  });

  it("una sorgente guasta non gira per sempre", () => {
    expect(() => createId("layer", () => true, cycle([7]))).toThrow(/sorgente di caso/);
  });
});
