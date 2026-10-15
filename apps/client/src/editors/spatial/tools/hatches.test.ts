// Le campiture: come si scrivono in `fub:pattern`, il `pattern` che ne
// discende, quando un `pattern` è una campitura di FubDraw, le campiture
// pronte, il ripiego e il colore delle righe.

import { describe, expect, it } from "vitest";
import { doc } from "../scene/test-support";
import {
  clampWidth,
  coverage,
  formatHatch,
  hatchElem,
  hatchFallback,
  hatchImage,
  hatchOf,
  inkFor,
  normalAngle,
  parseHatch,
  presetHatch,
  presetOf,
  type Hatch,
} from "./hatches";
import { resourcesOf } from "./resources";
import { LAYER, open } from "./test-support";

const DIAGONAL: Hatch = { kind: "lines", angle: -45, spacing: 8, width: 1.5, color: "#000000", background: "#56b4e9" };

describe("fub:pattern", () => {
  it("dice il genere, l'angolo, il passo, lo spessore, il colore e il fondo, se c'è", () => {
    expect(parseHatch("lines -45 8 1.5 #000000 #56b4e9")).toEqual(DIAGONAL);
    expect(parseHatch(" dots 45 12.25 3 #ffffff ")).toEqual({ kind: "dots", angle: 45, spacing: 12.25, width: 3, color: "#ffffff", background: null });
    expect(parseHatch("cross\t0  0.5 0.5 #d55e00 #000000")).toEqual({ kind: "cross", angle: 0, spacing: 0.5, width: 0.5, color: "#d55e00", background: "#000000" });
    expect(parseHatch("lines 180 8 1 #000000")?.angle).toBe(180);
    expect(parseHatch("lines -0 8 1 #000000")?.angle).toBe(0);
  });

  it("si riscrive com'era", () => {
    for (const text of ["lines -45 8 1.5 #000000 #56b4e9", "dots 45 12.25 3 #ffffff", "cross 0 1000 0.1 #d55e00 #000000"]) expect(formatHatch(parseHatch(text)!)).toBe(text);
  });

  it("non si legge fuori dalla sua forma", () => {
    for (const text of [
      "",
      "lines",
      "waves -45 8 1.5 #000000",
      "lines -180 8 1.5 #000000",
      "lines 181 8 1.5 #000000",
      "lines -45.125 8 1.5 #000000",
      "lines -45 0.4 0.2 #000000",
      "lines -45 1001 1.5 #000000",
      "lines -45 8 0.05 #000000",
      "lines -45 8 8.5 #000000",
      "lines -45 8 1.5 #00000",
      "lines -45 8 1.5 #FF0000",
      "lines -45 8 1.5 red",
      "lines -45 8 1.5 #000000 none",
      "lines -45 8 1.5 #000000 #ffffff #ffffff",
      "lines -45 8px 1.5 #000000",
    ]) {
      expect(parseHatch(text), text).toBeNull();
    }
  });
});

describe("il pattern di una campitura", () => {
  it("righe: il fondo, e una riga nel mezzo del quadrato, girato dell'angolo", () => {
    expect(hatchElem("rh", DIAGONAL)).toEqual({
      tag: "pattern",
      attrs: { id: "rh", "fub:role": "private", "fub:pattern": "lines -45 8 1.5 #000000 #56b4e9", patternUnits: "userSpaceOnUse", width: "8", height: "8", patternTransform: "rotate(-45)" },
      children: [
        { tag: "rect", attrs: { width: "8", height: "8", fill: "#56b4e9" } },
        { tag: "rect", attrs: { y: "3.25", width: "8", height: "1.5", fill: "#000000" } },
      ],
    });
  });

  it("righe incrociate senza fondo e senza angolo, e puntini", () => {
    expect(hatchElem("rh", { ...DIAGONAL, kind: "cross", angle: 0, spacing: 8.01, background: null }, "shared")).toEqual({
      tag: "pattern",
      attrs: { id: "rh", "fub:role": "shared", "fub:pattern": "cross 0 8.01 1.5 #000000", patternUnits: "userSpaceOnUse", width: "8.01", height: "8.01" },
      children: [
        { tag: "rect", attrs: { y: "3.255", width: "8.01", height: "1.5", fill: "#000000" } },
        { tag: "rect", attrs: { x: "3.255", width: "1.5", height: "8.01", fill: "#000000" } },
      ],
    });
    expect(hatchElem("rh", { ...DIAGONAL, kind: "dots", angle: 45, width: 3.01 }).children).toEqual([
      { tag: "rect", attrs: { width: "8", height: "8", fill: "#56b4e9" } },
      { tag: "circle", attrs: { cx: "4", cy: "4", r: "1.505", fill: "#000000" } },
    ]);
  });

  it("è di FubDraw se è esattamente quello che FubDraw scriverebbe", () => {
    const written = (attrs: string, children: string): string =>
      `<pattern id="rh" fub:pattern="lines -45 8 1.5 #000000 #56b4e9" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(-45)"${attrs}>${children}</pattern>`;
    const CHILDREN = '\n  <rect width="8" height="8" fill="#56b4e9"/>\n  <rect y="3.25" width="8" height="1.5" fill="#000000"/>\n';
    const read = (pattern: string): Hatch | null => {
      const opened = open(doc(`<defs id="fub-defs">${pattern}</defs>${LAYER}<rect id="oa" width="10" height="10" fill="url(#rh) #000000"/></g>`));
      return hatchOf(resourcesOf(opened.engine.model!).get("rh")!);
    };
    expect(read(written(' fub:role="private"', CHILDREN))).toEqual(DIAGONAL);
    expect(read(written(' fub:role="shared"', CHILDREN))).toEqual(DIAGONAL);
    // Un altro programma: un ruolo che non è suo, nessun ruolo, un attributo
    // in più, un figlio cambiato o in più, il valore che non dice il
    // contenuto.
    expect(read(written(' fub:role="swatch" fub:name="Righe"', CHILDREN))).toBeNull();
    expect(read(written("", CHILDREN))).toBeNull();
    expect(read(written(' fub:role="private" x="1"', CHILDREN))).toBeNull();
    expect(read(written(' fub:role="private"', CHILDREN.replace('y="3.25"', 'y="3.2"')))).toBeNull();
    expect(read(written(' fub:role="private"', `${CHILDREN}<circle r="1"/>`))).toBeNull();
    expect(read(written(' fub:role="private"', CHILDREN).replace("lines -45 8 1.5", "lines -45 8 2"))).toBeNull();
  });
});

describe("le campiture pronte", () => {
  it("nascono nere, senza fondo, col passo 8", () => {
    expect(presetHatch("diagonal")).toEqual({ kind: "lines", angle: -45, spacing: 8, width: 1.5, color: "#000000", background: null });
    expect(presetHatch("cross")).toMatchObject({ kind: "cross", angle: 45, width: 1.5 });
    expect(presetHatch("horizontal")).toMatchObject({ kind: "lines", angle: 0 });
    expect(presetHatch("dots")).toMatchObject({ kind: "dots", angle: 45, width: 3 });
    expect(presetHatch("grid")).toMatchObject({ kind: "cross", angle: 0 });
  });

  it("da un'altra tengono il passo e i colori, e lo spessore fra righe e righe", () => {
    const wide = { ...DIAGONAL, spacing: 16, width: 2, color: "#ffffff" };
    expect(presetHatch("grid", wide)).toEqual({ ...wide, kind: "cross", angle: 0 });
    // Fra righe e puntini lo spessore riparte, in proporzione al passo.
    expect(presetHatch("dots", wide)).toEqual({ ...wide, kind: "dots", angle: 45, width: 6 });
    expect(presetHatch("horizontal", { ...wide, kind: "dots", width: 6 })).toEqual({ ...wide, angle: 0, width: 3 });
  });

  it("si riconoscono a meno di mezzo giro per le righe e di un quarto per il resto", () => {
    const of = (kind: Hatch["kind"], angle: number) => presetOf({ ...DIAGONAL, kind, angle });
    expect([of("lines", -45), of("lines", 135), of("lines", 0), of("lines", 180), of("lines", 30)]).toEqual(["diagonal", "diagonal", "horizontal", "horizontal", null]);
    expect([of("cross", 45), of("cross", -45), of("cross", 135), of("cross", 0), of("cross", 90), of("cross", 10)]).toEqual(["cross", "cross", "cross", "grid", "grid", null]);
    expect([of("dots", 45), of("dots", -135), of("dots", 0)]).toEqual(["dots", "dots", null]);
  });
});

describe("i numeri", () => {
  it("l'angolo torna fra -180 escluso e 180, ai centesimi", () => {
    expect([190, -180, 360, -0, 540.004, -45].map(normalAngle)).toEqual([-170, 180, 0, 0, 180, -45]);
  });

  it("lo spessore resta fra il minimo e il passo", () => {
    expect([clampWidth(0, 8), clampWidth(9, 8), clampWidth(1.234, 8)]).toEqual([0.1, 8, 1.23]);
  });
});

describe("il ripiego e il colore delle righe", () => {
  it("le righe coprono lo spessore sul passo; incrociate, due volte meno l'incrocio; i puntini il loro cerchio", () => {
    expect(coverage({ kind: "lines", spacing: 8, width: 2 })).toBe(0.25);
    expect(coverage({ kind: "cross", spacing: 8, width: 2 })).toBe(0.4375);
    expect(coverage({ kind: "dots", spacing: 8, width: 4 })).toBeCloseTo(Math.PI / 16, 12);
  });

  it("il ripiego mescola le righe col fondo; senza fondo è il colore delle righe", () => {
    expect(hatchFallback(DIAGONAL)).toBe("#4692bd");
    expect(hatchFallback({ ...DIAGONAL, background: null })).toBe("#000000");
    expect(hatchFallback({ ...DIAGONAL, color: "#ffffff", background: "#000000", width: 8 })).toBe("#ffffff");
  });

  it("le righe sono nere o bianche, quelle che si leggono meglio sul fondo, nere a parità e senza fondo", () => {
    expect([inkFor("#ffff00"), inkFor("#000080"), inkFor("#777777"), inkFor("#56b4e9"), inkFor(null)]).toEqual(["#000000", "#ffffff", "#000000", "#000000", "#000000"]);
  });

  it("il campione del pannello: le righe a un passo di 6 px", () => {
    expect(hatchImage(DIAGONAL)).toBe("repeating-linear-gradient(-45deg, #000000 0 1.13px, #56b4e9 1.13px 6px)");
    expect(hatchImage({ ...DIAGONAL, kind: "cross", angle: 0, background: null })).toBe(
      "repeating-linear-gradient(0deg, #000000 0 1.13px, transparent 1.13px 6px), repeating-linear-gradient(90deg, #000000 0 1.13px, transparent 1.13px 6px), linear-gradient(transparent, transparent)",
    );
    expect(hatchImage({ ...DIAGONAL, kind: "dots", angle: 0, width: 3 })).toContain("radial-gradient(circle at 25% 25%, #000000 2.25px, transparent 2.75px)");
  });
});
