// @vitest-environment happy-dom
// Test dell'atlas: in happy-dom `getContext("2d")` è null, quindi la parte
// disegnabile (gradienti, sprite) non è testabile qui — ma lo sono le
// decisioni pure che governano l'atlas: la scelta del bucket (quale sprite
// finisce su schermo), la chiave di rigenerazione (quando il pittore deve
// ricuocere), la lettura dei token (il contratto col tema) e la degradazione
// no-op quando il canvas non ha contesto (un host senza stili, o i test).

import { describe, expect, it, vi } from "vitest";
import {
  BUCKET_RAGGI,
  bucketDiRaggio,
  chiaveAtlas,
  disegnaNodo,
  esadecimaleRgb,
  generaAtlas,
  leggiTinte,
  type Atlas,
  type Tinte,
} from "./atlas";

describe("bucketDiRaggio", () => {
  it("sceglie il primo bucket che copre il raggio", () => {
    expect(bucketDiRaggio(BUCKET_RAGGI, 4)).toBe(0);
    expect(bucketDiRaggio(BUCKET_RAGGI, 6)).toBe(0); // inclusivo sul max
    expect(bucketDiRaggio(BUCKET_RAGGI, 6.5)).toBe(1);
    expect(bucketDiRaggio(BUCKET_RAGGI, 9)).toBe(1);
    expect(bucketDiRaggio(BUCKET_RAGGI, 13)).toBe(2);
    // oltre l'ultimo bucket: l'ultimo (nessun indice fuori range)
    expect(bucketDiRaggio(BUCKET_RAGGI, 100)).toBe(2);
    expect(bucketDiRaggio([], 5)).toBe(-1); // bucket vuoti → -1, gestito dal chiamante
  });
});

describe("chiaveAtlas", () => {
  const t: Tinte = {
    nodo: "#aaa",
    attivo: "#b00",
    hover: "#c00",
    testo: "#eee",
    sfondo: "#000",
    fonte: "aaa|b00|c00|eee|000",
  };
  it("cambia se cambia la fonte (tema)", () => {
    expect(chiaveAtlas(t, BUCKET_RAGGI)).not.toBe(chiaveAtlas({ ...t, fonte: "xxx" }, BUCKET_RAGGI));
  });
  it("cambia se cambiano i bucket", () => {
    const altri = [{ min: 0, max: 10 }];
    expect(chiaveAtlas(t, BUCKET_RAGGI)).not.toBe(chiaveAtlas(t, altri));
  });
});

describe("esadecimaleRgb", () => {
  it("parsa #rgb e #rrggbb", () => {
    expect(esadecimaleRgb("#abc")).toEqual([170, 187, 204]);
    expect(esadecimaleRgb("#ff8800")).toEqual([255, 136, 0]);
  });
  it("ritorna null per valori non esadecimali (es. rgb(...))", () => {
    expect(esadecimaleRgb("rgb(1, 2, 3)")).toBeNull();
    expect(esadecimaleRgb("")).toBeNull();
    expect(esadecimaleRgb("#xyz")).toBeNull();
    expect(esadecimaleRgb("#12345")).toBeNull();
  });
});

describe("leggiTinte", () => {
  it("legge i token dal computed style dell'host (pattern panels/graph.ts)", () => {
    const host = document.createElement("div");
    const stile = {
      color: "#e6e6ea",
      getPropertyValue(nome: string): string {
        const mappa: Record<string, string> = {
          "--graph-node": "#8a8a99",
          "--graph-node-active": "#a3e635",
          "--graph-node-hover": "#98c379",
          "--text": "#e6e6ea",
          "--bg": "#000000",
        };
        return mappa[nome] ?? "";
      },
    } as unknown as CSSStyleDeclaration;
    vi.spyOn(globalThis, "getComputedStyle").mockReturnValue(stile);

    const t = leggiTinte(host);
    expect(t.nodo).toBe("#8a8a99");
    expect(t.attivo).toBe("#a3e635");
    expect(t.hover).toBe("#98c379");
    expect(t.testo).toBe("#e6e6ea");
    expect(t.sfondo).toBe("#000000");
    expect(t.fonte).toBe("#8a8a99|#a3e635|#98c379|#e6e6ea|#000000");
    vi.restoreAllMocks();
  });

  it("non lancia su un host senza stili e con fallback", () => {
    const host = document.createElement("div");
    vi.spyOn(globalThis, "getComputedStyle").mockReturnValue({
      color: "#e6e6ea",
      getPropertyValue: () => "",
    } as unknown as CSSStyleDeclaration);
    const t = leggiTinte(host);
    expect(t.nodo).toBe("#e6e6ea"); // fallback all'ink
    expect(t.sfondo).toBe("#000000"); // fallback nero per il trail
    vi.restoreAllMocks();
  });
});

describe("generaAtlas e disegnaNodo (degradazione no-op)", () => {
  it("generaAtlas con getContext null produce un atlas senza canvas (no lancio)", () => {
    const t: Tinte = {
      nodo: "#8a8a99",
      attivo: "#a3e635",
      hover: "#98c379",
      testo: "#e6e6ea",
      sfondo: "#000",
      fonte: "f",
    };
    const a = generaAtlas(t, BUCKET_RAGGI);
    expect(a.canvas).toBeNull();
    expect(a.cella).toBeGreaterThan(0);
    expect(a.bucket).toBe(BUCKET_RAGGI);
    // la fonte va nella chiave: un atlas «vuoto» resta confrontabile
    expect(a.fonte).toBe(chiaveAtlas(t, BUCKET_RAGGI));
  });

  it("disegnaNodo con ctx null o atlas senza canvas non lancia", () => {
    const t: Tinte = { nodo: "#aaa", attivo: "#bbb", hover: "#ccc", testo: "#ddd", sfondo: "#000", fonte: "f" };
    const a = generaAtlas(t, BUCKET_RAGGI);
    expect(() => disegnaNodo(null, a, 0, 0, 6, "nodo")).not.toThrow();
    const finto = {} as unknown as CanvasRenderingContext2D;
    expect(() => disegnaNodo(finto, a, 0, 0, 6, "nodo", 0.5)).not.toThrow();
  });

  it("disegnaNodo con canvas finto fa drawImage con la cella giusta", () => {
    // La scelta di sorgente (riga = ruolo, colonna = bucket) è il contratto
    // dell'atlas: un drawImage con coordinate sbagliate pescherebbe lo
    // sprite di un altro colore/raggio.
    const a: Atlas = { canvas: {}, bucket: BUCKET_RAGGI, fonte: "f", cella: 64, celle: 3, righe: 3 } as unknown as Atlas;
    const chiamate: unknown[] = [];
    const finto = {
      globalAlpha: 1,
      drawImage(...args: unknown[]) {
        chiamate.push(args);
      },
    } as unknown as CanvasRenderingContext2D;
    // raggio 7 → bucket 1, ruolo "hover" → riga 2: sx = 1·64, sy = 2·64
    disegnaNodo(finto, a, 10, 20, 7, "hover");
    expect(chiamate).toHaveLength(1);
    // drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh) — 9 argomenti
    const [src, sx, sy, sw, sh, dx, dy] = chiamate[0] as unknown[];
    expect(src).toBe(a.canvas);
    expect(sx).toBe(64);
    expect(sy).toBe(128);
    expect(sw).toBe(64);
    expect(sh).toBe(64);
    // il target: raggio 7 → GLOW 1.8 → taglia 25.2, centrato su (10, 20)
    expect(dx).toBeCloseTo(10 - 25.2 / 2, 6);
    expect(dy).toBeCloseTo(20 - 25.2 / 2, 6);
  });

  it("disegnaNodo con alone modula globalAlpha e rifà drawImage", () => {
    const a: Atlas = { canvas: {}, bucket: BUCKET_RAGGI, fonte: "f", cella: 64, celle: 3, righe: 3 } as unknown as Atlas;
    const alphas: number[] = [];
    let chiamate = 0;
    const finto = {
      drawImage() {
        chiamate++;
      },
    } as unknown as CanvasRenderingContext2D;
    // intercetta il setter di globalAlpha: registra ogni valore scritto
    Object.defineProperty(finto, "globalAlpha", {
      configurable: true,
      enumerable: true,
      get: () => alphas[alphas.length - 1] ?? 1,
      set(v: number) {
        alphas.push(v);
      },
    });
    disegnaNodo(finto, a, 0, 0, 6, "nodo", 0.42);
    expect(chiamate).toBe(2);
    expect(alphas[0]).toBeCloseTo(0.42, 10);
    expect(alphas[1]).toBe(1);
  });
});
