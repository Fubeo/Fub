// I colori di CSS letti come li legge un browser.

import { describe, expect, it } from "vitest";
import { formatHex, parseCssColor } from "./css-color";

const read = (text: string): [string, number] | null => {
  const color = parseCssColor(text);
  return color === null ? null : [formatHex(color), Math.round(color.a * 1000) / 1000];
};

describe("parseCssColor", () => {
  it("legge gli esadecimali corti e lunghi, con la trasparenza", () => {
    expect(read("#F00")).toEqual(["#ff0000", 1]);
    expect(read("#f008")).toEqual(["#ff0000", 0.533]);
    expect(read(" #12AbEf ")).toEqual(["#12abef", 1]);
    expect(read("#12abef80")).toEqual(["#12abef", 0.502]);
    expect(read("#12abe")).toBeNull();
    expect(read("#ggg")).toBeNull();
  });

  it("legge i nomi e transparent", () => {
    expect(read("Navy")).toEqual(["#000080", 1]);
    expect(read("rebeccapurple")).toEqual(["#663399", 1]);
    expect(read("transparent")).toEqual(["#000000", 0]);
    expect(read("currentColor")).toBeNull();
    expect(read("notacolor")).toBeNull();
  });

  it("legge rgb() e rgba() con le virgole e con gli spazi", () => {
    expect(read("rgb(255, 128, 0)")).toEqual(["#ff8000", 1]);
    expect(read("rgba(255,128,0,0.25)")).toEqual(["#ff8000", 0.25]);
    expect(read("rgb(100%, 50%, 0%)")).toEqual(["#ff8000", 1]);
    expect(read("rgb(255 128 0 / 50%)")).toEqual(["#ff8000", 0.5]);
    expect(read("rgba(255 128 0)")).toEqual(["#ff8000", 1]);
    expect(read("rgb(300, -5, 12.6)")).toEqual(["#ff000d", 1]);
    expect(read("rgb(none 128 0)")).toEqual(["#008000", 1]);
  });

  it("non legge le forme che un browser rifiuta", () => {
    expect(read("rgb(255, 50%, 0)")).toBeNull();
    expect(read("rgb(255 128)")).toBeNull();
    expect(read("rgb(255, 128, 0 / 1)")).toBeNull();
    expect(read("rgb(none, 1, 2)")).toBeNull();
    expect(read("rgb(1 2 3 / 4 5)")).toBeNull();
    expect(read("hwb(0, 0%, 0%)")).toBeNull();
    expect(read("color-mix(in srgb, red, blue)")).toBeNull();
  });

  it("legge hsl(), hsla() e hwb()", () => {
    expect(read("hsl(0, 100%, 50%)")).toEqual(["#ff0000", 1]);
    expect(read("hsl(120deg 100% 25%)")).toEqual(["#008000", 1]);
    expect(read("hsla(240, 100%, 50%, .5)")).toEqual(["#0000ff", 0.5]);
    expect(read("hsl(0.5turn 100% 50% / 20%)")).toEqual(["#00ffff", 0.2]);
    expect(read("hsl(-120 100 50)")).toEqual(["#0000ff", 1]);
    expect(read("hsl(0, 100, 50)")).toBeNull();
    expect(read("hwb(0 0% 0%)")).toEqual(["#ff0000", 1]);
    expect(read("hwb(120 20% 20%)")).toEqual(["#33cc33", 1]);
    expect(read("hwb(0 60% 60%)")).toEqual(["#808080", 1]);
  });
});
