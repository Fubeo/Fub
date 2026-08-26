// @vitest-environment happy-dom
// Test dell'atlas: in happy-dom `getContext("2d")` è null, quindi la parte
// disegnabile (gradienti, sprite) non è testabile qui — ma lo sono le
// decisioni pure che governano l'atlas: la scelta del bucket (quale sprite
// finisce su schermo), la chiave di rigenerazione (quando il pittore deve
// ricuocere), la lettura dei token (il contratto col tema) e la degradazione
// no-op quando il canvas non ha contesto (un host senza stili, o i test).

import { describe, expect, it, vi } from "vitest";
import {
  RADIUS_BUCKETS,
  radiusBucket,
  atlasKey,
  drawNode,
  hexRgb,
  generateAtlas,
  readTints,
  type Atlas,
  type Tints,
} from "./atlas";

describe("radiusBucket", () => {
  it("sceglie il primo bucket che copre il radius", () => {
    expect(radiusBucket(RADIUS_BUCKETS, 4)).toBe(0);
    expect(radiusBucket(RADIUS_BUCKETS, 6)).toBe(0); // inclusivo sul max
    expect(radiusBucket(RADIUS_BUCKETS, 6.5)).toBe(1);
    expect(radiusBucket(RADIUS_BUCKETS, 9)).toBe(1);
    expect(radiusBucket(RADIUS_BUCKETS, 13)).toBe(2);
    // oltre l'ultimo bucket: l'ultimo (nessun indice fuori range)
    expect(radiusBucket(RADIUS_BUCKETS, 100)).toBe(2);
    expect(radiusBucket([], 5)).toBe(-1); // bucket vuoti → -1, gestito dal chiamante
  });
});

describe("atlasKey", () => {
  const t: Tints = {
    node: "#aaa",
    active: "#b00",
    hover: "#c00",
    text: "#eee",
    background: "#000",
    source: "aaa|b00|c00|eee|000",
  };
  it("cambia se cambia la fonte (tema)", () => {
    expect(atlasKey(t, RADIUS_BUCKETS)).not.toBe(atlasKey({ ...t, source: "xxx" }, RADIUS_BUCKETS));
  });
  it("cambia se cambiano i bucket", () => {
    const others = [{ min: 0, max: 10 }];
    expect(atlasKey(t, RADIUS_BUCKETS)).not.toBe(atlasKey(t, others));
  });
});

describe("hexRgb", () => {
  it("parsa #rgb e #rrggbb", () => {
    expect(hexRgb("#abc")).toEqual([170, 187, 204]);
    expect(hexRgb("#ff8800")).toEqual([255, 136, 0]);
  });
  it("ritorna null per valori non esadecimali (es. rgb(...))", () => {
    expect(hexRgb("rgb(1, 2, 3)")).toBeNull();
    expect(hexRgb("")).toBeNull();
    expect(hexRgb("#xyz")).toBeNull();
    expect(hexRgb("#12345")).toBeNull();
  });
});

describe("readTints", () => {
  it("legge i token dal computed style dell'host (pattern panels/graph.ts)", () => {
    const host = document.createElement("div");
    const style = {
      color: "#e6e6ea",
      getPropertyValue(name: string): string {
        const map: Record<string, string> = {
          "--graph-node": "#8a8a99",
          "--graph-node-active": "#a3e635",
          "--graph-node-hover": "#98c379",
          "--text": "#e6e6ea",
          "--bg": "#000000",
        };
        return map[name] ?? "";
      },
    } as unknown as CSSStyleDeclaration;
    vi.spyOn(globalThis, "getComputedStyle").mockReturnValue(style);

    const t = readTints(host);
    expect(t.node).toBe("#8a8a99");
    expect(t.active).toBe("#a3e635");
    expect(t.hover).toBe("#98c379");
    expect(t.text).toBe("#e6e6ea");
    expect(t.background).toBe("#000000");
    expect(t.source).toBe("#8a8a99|#a3e635|#98c379|#e6e6ea|#000000");
    vi.restoreAllMocks();
  });

  it("non lancia su un host senza stili e con fallback", () => {
    const host = document.createElement("div");
    vi.spyOn(globalThis, "getComputedStyle").mockReturnValue({
      color: "#e6e6ea",
      getPropertyValue: () => "",
    } as unknown as CSSStyleDeclaration);
    const t = readTints(host);
    expect(t.node).toBe("#e6e6ea"); // fallback all'ink
    expect(t.background).toBe("#000000"); // fallback nero per il trail
    vi.restoreAllMocks();
  });
});

describe("generateAtlas e drawNode (degradazione no-op)", () => {
  it("generateAtlas con getContext null produce un atlas senza canvas (no lancio)", () => {
    const t: Tints = {
      node: "#8a8a99",
      active: "#a3e635",
      hover: "#98c379",
      text: "#e6e6ea",
      background: "#000",
      source: "f",
    };
    const atlas = generateAtlas(t, RADIUS_BUCKETS);
    expect(atlas.canvas).toBeNull();
    expect(atlas.cell).toBeGreaterThan(0);
    expect(atlas.bucket).toBe(RADIUS_BUCKETS);
    // la fonte va nella chiave: un atlas «vuoto» resta confrontabile
    expect(atlas.source).toBe(atlasKey(t, RADIUS_BUCKETS));
  });

  it("drawNode con ctx null o atlas senza canvas non lancia", () => {
    const t: Tints = { node: "#aaa", active: "#bbb", hover: "#ccc", text: "#ddd", background: "#000", source: "f" };
    const atlas = generateAtlas(t, RADIUS_BUCKETS);
    expect(() => drawNode(null, atlas, 0, 0, 6, "node")).not.toThrow();
    const fake = {} as unknown as CanvasRenderingContext2D;
    expect(() => drawNode(fake, atlas, 0, 0, 6, "node", 0.5)).not.toThrow();
  });

  it("drawNode con canvas finto fa drawImage con la cella giusta", () => {
    // La scelta di sorgente (riga = ruolo, colonna = bucket) è il contratto
    // dell'atlas: un drawImage con coordinate sbagliate pescherebbe lo
    // sprite di un altro colore/raggio.
    const atlas: Atlas = { canvas: {}, bucket: RADIUS_BUCKETS, source: "f", cell: 64, cells: 3, rows: 3 } as unknown as Atlas;
    const calls: unknown[] = [];
    const fake = {
      globalAlpha: 1,
      drawImage(...args: unknown[]) {
        calls.push(args);
      },
    } as unknown as CanvasRenderingContext2D;
    // raggio 7 → bucket 1, ruolo "hover" → riga 2: sx = 1·64, sy = 2·64
    drawNode(fake, atlas, 10, 20, 7, "hover");
    expect(calls).toHaveLength(1);
    // drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh) — 9 argomenti
    const [src, sx, sy, sw, sh, dx, dy] = calls[0] as unknown[];
    expect(src).toBe(atlas.canvas);
    expect(sx).toBe(64);
    expect(sy).toBe(128);
    expect(sw).toBe(64);
    expect(sh).toBe(64);
    // il target: raggio 7 → GLOW 1.8 → taglia 25.2, centrato su (10, 20)
    expect(dx).toBeCloseTo(10 - 25.2 / 2, 6);
    expect(dy).toBeCloseTo(20 - 25.2 / 2, 6);
  });

  it("drawNode con alone modula globalAlpha e rifà drawImage", () => {
    const atlas: Atlas = { canvas: {}, bucket: RADIUS_BUCKETS, source: "f", cell: 64, cells: 3, rows: 3 } as unknown as Atlas;
    const alphas: number[] = [];
    let calls = 0;
    const fake = {
      drawImage() {
        calls++;
      },
    } as unknown as CanvasRenderingContext2D;
    // intercetta il setter di globalAlpha: registra ogni valore scritto
    Object.defineProperty(fake, "globalAlpha", {
      configurable: true,
      enumerable: true,
      get: () => alphas[alphas.length - 1] ?? 1,
      set(v: number) {
        alphas.push(v);
      },
    });
    drawNode(fake, atlas, 0, 0, 6, "node", 0.42);
    expect(calls).toBe(2);
    expect(alphas[0]).toBeCloseTo(0.42, 10);
    expect(alphas[1]).toBe(1);
  });
});
