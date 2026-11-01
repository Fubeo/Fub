// Il profilo di un contorno a spessore variabile: i profili pronti, i
// punti che lo strumento Spessore aggiunge, allarga, sposta e toglie, la
// linea centrale misurata, e il contorno che il file scrive in `d`.

import { describe, expect, it } from "vitest";
import sparse from "../../../__fixtures__/scene/sparse.svg?raw";
import { parsePath } from "../scene/geometry";
import { readScene } from "../scene/read";
import { readVarWidth, spineOf, type WidthPoint } from "../scene/varwidth";
import { profileWidth, uniformWidth, widthAttrs, type WidthShape } from "./profile";

const line = parsePath("M0 0 L100 0")!;
const shape = (profile: readonly WidthPoint[], spine = line): WidthShape => ({ cap: "butt", join: "miter", profile, spine });

describe("i profili pronti", () => {

  it("lo spessore è la larghezza più grande, da un lato all'altro; uniforme solo con i lati uguali ovunque", () => {
    expect(profileWidth([[0, 1, 5], [0.5, 3, 2], [1, 0, 0]])).toBe(6);
    expect(uniformWidth([[0, 2, 2], [1, 2, 2]])).toBe(4);
    expect(uniformWidth([[0, 2, 2], [0.4, 2, 2], [1, 2, 2]])).toBe(4);
    expect(uniformWidth([[0, 2, 3], [1, 2, 3]])).toBeNull();
    expect(uniformWidth([[0, 2, 2], [1, 1, 1]])).toBeNull();
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
