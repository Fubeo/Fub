// I tasti che `session.keys(testo)` manda al driver (`keyActions`).
//
// Un modificatore nel testo resta premuto fino alla fine, come nell'«Element
// Send Keys» del W3C: `keys("f")` è Ctrl+F. Prima ogni carattere era
// premuto e rilasciato da solo, e Ctrl si alzava prima della `f`: una sonda
// che premeva Ctrl+F, Ctrl+, o Ctrl+Z scriveva una lettera nella nota e
// scambiava il proprio errore per una scorciatoia rotta di Fub.
import { describe, expect, it } from "vitest";

import { KEY, keyActions } from "./driver.mjs";

const down = (value) => ({ type: "keyDown", value });
const up = (value) => ({ type: "keyUp", value });

describe("i tasti di session.keys", () => {
  it("un testo semplice: ogni carattere premuto e rilasciato", () => {
    expect(keyActions("ab")).toEqual([down("a"), up("a"), down("b"), up("b")]);
  });

  it("Ctrl resta premuto sotto la lettera e si alza alla fine", () => {
    expect(keyActions(`${KEY.control}f`)).toEqual([down(KEY.control), down("f"), up("f"), up(KEY.control)]);
  });

  it("più modificatori: si alzano tutti, nell'ordine inverso", () => {
    expect(keyActions(`${KEY.control}${KEY.shift}p`)).toEqual([
      down(KEY.control),
      down(KEY.shift),
      down("p"),
      up("p"),
      up(KEY.shift),
      up(KEY.control),
    ]);
  });

  it("un modificatore ripetuto si alza, e il tasto Null li alza tutti", () => {
    expect(keyActions(`${KEY.control}z${KEY.control}z`)).toEqual([
      down(KEY.control),
      down("z"),
      up("z"),
      up(KEY.control),
      down("z"),
      up("z"),
    ]);
    expect(keyActions(`${KEY.control}${KEY.alt}b${KEY.null}x`)).toEqual([
      down(KEY.control),
      down(KEY.alt),
      down("b"),
      up("b"),
      up(KEY.alt),
      up(KEY.control),
      down("x"),
      up("x"),
    ]);
  });

  it("F2 è \\uE032: \\uE031 è F1", () => {
    expect(KEY.f2).toBe("");
    expect(keyActions(KEY.f2)).toEqual([down(""), up("")]);
  });
});
