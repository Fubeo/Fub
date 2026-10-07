// Il profilo di un contorno a spessore variabile: i profili pronti, i
// punti che lo strumento Spessore aggiunge, allarga, sposta e toglie, la
// linea centrale misurata, e il contorno che il file scrive in `d`.

import { describe, expect, it } from "vitest";
import sparse from "../../../__fixtures__/scene/sparse.svg?raw";
import { parsePath } from "../scene/geometry";
import { readScene } from "../scene/read";
import { readVarWidth, spineOf, type WidthPoint } from "../scene/varwidth";
import {
  flippedProfile,
  movedPoint,
  presetOf,
  presetProfile,
  PRESETS,
  profileWidth,
  rightOf,
  scaledProfile,
  SpineMeasure,
  swappedProfile,
  uniformWidth,
  widthAttrs,
  withoutPoint,
  withPoint,
  withWidths,
  type WidthShape,
} from "./profile";

const line = parsePath("M0 0 L100 0")!;
const shape = (profile: readonly WidthPoint[], spine = line): WidthShape => ({ cap: "butt", join: "miter", profile, spine });

describe("i profili pronti", () => {
  it("sono larghi al più quanto lo spessore, e si riconoscono", () => {
    expect(presetProfile("uniform", 8)).toEqual([[0, 4, 4], [1, 4, 4]]);
    expect(presetProfile("taper", 8)).toEqual([[0, 4, 4], [1, 0, 0]]);
    expect(presetProfile("drop", 8)).toEqual([[0, 0, 0], [0.5, 3, 3], [1, 4, 4]]);
    expect(presetProfile("spindle", 8)).toEqual([[0, 0, 0], [0.5, 4, 4], [1, 0, 0]]);
    for (const preset of PRESETS) {
      expect(profileWidth(presetProfile(preset, 8))).toBe(8);
      expect(presetOf(presetProfile(preset, 8))).toBe(preset);
    }
  });

  it("si riconoscono anche coi numeri arrotondati del file, e non altrimenti", () => {
    // Uno spessore di 7.77: i tre quarti della metà, scritti al centesimo.
    expect(presetOf([[0, 0, 0], [0.5, 2.91, 2.91], [1, 3.885, 3.885]])).toBe("drop");
    expect(presetOf([[0, 0, 0], [0.5, 2.8, 2.91], [1, 3.885, 3.885]])).toBeNull();
    expect(presetOf([[0, 4, 4], [0.5, 4, 4], [1, 4, 4]])).toBeNull();
    expect(presetOf([[0, 4, 3], [1, 4, 3]])).toBeNull();
  });

  it("lo spessore è la larghezza più grande, da un lato all'altro; uniforme solo con i lati uguali ovunque", () => {
    expect(profileWidth([[0, 1, 5], [0.5, 3, 2], [1, 0, 0]])).toBe(6);
    expect(uniformWidth([[0, 2, 2], [1, 2, 2]])).toBe(4);
    expect(uniformWidth([[0, 2, 2], [0.4, 2, 2], [1, 2, 2]])).toBe(4);
    expect(uniformWidth([[0, 2, 3], [1, 2, 3]])).toBeNull();
    expect(uniformWidth([[0, 2, 2], [1, 1, 1]])).toBeNull();
  });

  it("si scala, si rovescia lungo la linea e scambia i lati", () => {
    const profile: WidthPoint[] = [[0, 1, 2], [0.3, 4, 0], [1, 0, 6]];
    expect(scaledProfile(profile, 2)).toEqual([[0, 2, 4], [0.3, 8, 0], [1, 0, 12]]);
    expect(flippedProfile(profile)).toEqual([[0, 0, 6], [0.7, 4, 0], [1, 1, 2]]);
    expect(swappedProfile(profile)).toEqual([[0, 2, 1], [0.3, 0, 4], [1, 6, 0]]);
    expect(flippedProfile(flippedProfile(profile)).flat()).toEqual(profile.flat().map((value) => expect.closeTo(value, 12)));
  });
});

describe("i punti del profilo", () => {
  const taper: WidthPoint[] = [[0, 4, 4], [1, 0, 0]];

  it("uno nuovo nasce con le larghezze che il profilo aveva lì; vicino a uno che c'è, è lui", () => {
    expect(withPoint(taper, 0.25)).toEqual({ profile: [[0, 4, 4], [0.25, expect.any(Number), expect.any(Number)], [1, 0, 0]], index: 1 });
    const [, left, right] = withPoint(taper, 0.25).profile[1]!;
    expect(left).toBe(right);
    expect(left).toBeGreaterThan(0);
    expect(left).toBeLessThan(4);
    expect(withPoint(taper, 0.99996)).toEqual({ profile: taper, index: 1 });
    expect(withPoint(taper, 0)).toEqual({ profile: taper, index: 0 });
  });

  it("si allarga da un lato o dall'altro, mai sotto zero", () => {
    expect(withWidths(taper, 1, 3, -2)).toEqual([[0, 4, 4], [1, 3, 0]]);
    // Il profilo di partenza resta com'era.
    expect(taper).toEqual([[0, 4, 4], [1, 0, 0]]);
  });

  it("si sposta fra i vicini, e i capi restano", () => {
    const profile: WidthPoint[] = [[0, 1, 1], [0.3, 2, 2], [0.6, 3, 3], [1, 1, 1]];
    expect(movedPoint(profile, 1, 0.5)[1]).toEqual([0.5, 2, 2]);
    expect(movedPoint(profile, 1, 0.9)[1]).toEqual([0.5999, 2, 2]);
    expect(movedPoint(profile, 1, -1)[1]).toEqual([0.0001, 2, 2]);
    expect(movedPoint(profile, 0, 0.5)).toEqual(profile);
    expect(movedPoint(profile, 3, 0.5)).toEqual(profile);
  });

  it("si toglie in mezzo; i capi no, e nemmeno l'ultima larghezza", () => {
    const profile: WidthPoint[] = [[0, 0, 0], [0.5, 3, 3], [1, 0, 0]];
    expect(withoutPoint([[0, 1, 1], [0.5, 3, 3], [1, 1, 1]], 1)).toEqual([[0, 1, 1], [1, 1, 1]]);
    expect(withoutPoint(profile, 0)).toBeNull();
    expect(withoutPoint(profile, 2)).toBeNull();
    expect(withoutPoint(profile, 1)).toBeNull();
  });
});

describe("la linea centrale misurata", () => {
  it("dà il punto e il verso a ogni frazione della lunghezza", () => {
    const measure = new SpineMeasure(parsePath("M0 0 L30 0 L30 40")!);
    expect(measure.total).toBe(70);
    expect(measure.placeAt(0)).toEqual({ at: [0, 0], along: [1, 0] });
    expect(measure.placeAt(0.5)).toEqual({ at: [30, 5], along: [0, 1] });
    expect(measure.placeAt(1)).toEqual({ at: [30, 40], along: [0, 1] });
    expect(measure.placeAt(2)).toEqual({ at: [30, 40], along: [0, 1] });
  });

  it("trova dove passa più vicina, e da che parte sta il punto: a destra è sotto, per chi va verso destra", () => {
    const measure = new SpineMeasure(line);
    expect(measure.spotAt([25, 4])).toEqual({ u: 0.25, at: [25, 0], along: [1, 0], distance: 4, side: 1 });
    expect(measure.spotAt([25, -4])).toMatchObject({ u: 0.25, distance: 4, side: -1 });
    expect(measure.spotAt([-10, 0])).toMatchObject({ u: 0, distance: 10 });
    expect(rightOf([1, 0])).toEqual([-0, 1]);
  });

  it("misura le curve e la chiusura", () => {
    const ring = new SpineMeasure(parsePath("M0 0 L10 0 L10 10 L0 10 Z")!);
    expect(ring.total).toBe(40);
    expect(ring.placeAt(0.875).at).toEqual([0, 5]);
    const arc = new SpineMeasure(parsePath("M0 0 C0 55.23 44.77 100 100 100")!);
    // Un quarto di cerchio di raggio 100, a meno della spezzata.
    expect(arc.total).toBeCloseTo((Math.PI * 100) / 2, 0);
    const middle = arc.placeAt(0.5).at;
    expect(Math.hypot(middle[0] - 100, middle[1])).toBeCloseTo(100, 0);
  });

  it("una linea lunga zero ha comunque un verso", () => {
    const dot = new SpineMeasure(parsePath("M5 5 L5 5")!);
    expect(dot.total).toBe(0);
    expect(dot.placeAt(0.5)).toEqual({ at: [5, 5], along: [1, 0] });
  });
});

describe("il contorno scritto", () => {
  it("viene dalla geometria scritta e riletta", () => {
    const written = widthAttrs(shape([[0, 4.004, 4], [0.33333, 2, 1], [1, 0, 0]]))!;
    expect(written.geom).toBe("butt miter 0 4 4 0.3333 2 1 1 0 0 M0 0 L100 0");
    const reread = readVarWidth(written.geom)!;
    expect(reread.profile).toEqual([[0, 4, 4], [0.3333, 2, 1], [1, 0, 0]]);
    expect(spineOf(reread)).toEqual(line);
    expect(written.d).toBe(widthAttrs({ ...shape(reread.profile), spine: spineOf(reread) })!.d);
  });

  it("le linee del mirror di Rust hanno il d che la superficie calcola", () => {
    const lines = readScene(sparse).items.filter((item) => item.kind === "element" && item.varwidth !== undefined);
    expect(lines).toHaveLength(1);
    for (const item of lines) {
      if (item.kind !== "element") continue;
      const v = item.varwidth!;
      const source = sparse.slice(item.utf16[0], item.utf16[1]);
      const [geom, d] = [/\sfub:geom="([^"]*)"/.exec(source)![1], /\sd="([^"]*)"/.exec(source)![1]];
      expect(widthAttrs({ cap: v.cap, join: v.join, profile: v.profile, spine: spineOf(v) })).toEqual({ geom, d });
    }
  });

  it("non si scrive senza nessuna larghezza, o con una linea di più pezzi", () => {
    expect(widthAttrs(shape([[0, 0, 0], [1, 0, 0]]))).toBeNull();
    expect(widthAttrs(shape([[0, 1, 1], [1, 1, 1]], parsePath("M0 0 L10 0 M20 0 L30 0")!))).toBeNull();
  });
});
