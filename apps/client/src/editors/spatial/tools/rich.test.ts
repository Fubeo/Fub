import { describe, expect, it } from "vitest";
import { anchorsOf, emphasisIn, emphasisOf, emphasizeKeeping, emphasizeWhole, leadingOf, lineRuns, restyleKeeping, restyleWhole, seenValues, spacingsOf, richLine, setInRange, tidyRich, toggleEmphasis, valuesIn, withLeading, withSpacing, type Rich } from "./rich";

const BOLD = { "font-weight": "bold" };
const BLUE = { fill: "#0072b2" };

/// Un testo di due righe: «Evaporazione» e «in pioggia», con «pioggia» blu e
/// in grassetto.
const TWO: Rich = {
  attrs: { id: "o1", x: "10", y: "40", "font-size": "20" },
  inherited: { fill: "#000000", "font-family": "", "font-size": "16", "font-weight": "normal", "font-style": "normal", "letter-spacing": "normal" },
  lines: [
    richLine({ x: "10", dy: "0" }, "Evaporazione"),
    richLine({ x: "10", dy: "25" }, ["in ", { text: "pioggia", attrs: { ...BLUE, ...BOLD } }]),
  ],
};

const at = (line: number, offset: number): { line: number; offset: number } => ({ line, offset });
describe("formattare", () => {
  it("il grassetto si accende se manca a qualcuno, e si spegne se ce l'hanno tutti", () => {
    expect(emphasisIn(TWO, at(1, 0), at(1, 10), "bold")).toBe(false);
    const bold = toggleEmphasis(TWO, at(1, 0), at(1, 10), "bold");
    expect(lineRuns(bold.lines[1]!)).toEqual([{ text: "in ", attrs: BOLD }, { text: "pioggia", attrs: { ...BLUE, ...BOLD } }]);
    const plain = toggleEmphasis(bold, at(1, 0), at(1, 10), "bold");
    // Il peso uguale a quello della riga si toglie dal pezzo.
    expect(lineRuns(plain.lines[1]!)).toEqual(["in ", { text: "pioggia", attrs: BLUE }]);
  });

  it("dentro un testo in grassetto, una parola si spegne scrivendo il peso normale", () => {
    const heavy: Rich = { ...TWO, attrs: { ...TWO.attrs, ...BOLD } };
    const one = toggleEmphasis(heavy, at(0, 0), at(0, 4), "bold");
    expect(lineRuns(one.lines[0]!)).toEqual([{ text: "Evap", attrs: { "font-weight": "normal" } }, "orazione"]);
    expect(emphasisIn(one, at(0, 2), at(0, 2), "bold")).toBe(false);
    expect(emphasisIn(one, at(0, 6), at(0, 6), "bold")).toBe(true);
  });

  it("la sottolineatura del testo scende ai pezzi che la tengono, quando una parola la perde", () => {
    const under: Rich = { ...TWO, attrs: { ...TWO.attrs, "text-decoration": "underline" } };
    expect(emphasisIn(under, at(1, 3), at(1, 10), "underline")).toBe(true);
    const off = toggleEmphasis(under, at(1, 3), at(1, 10), "underline");
    expect(off.attrs).toEqual({ id: "o1", x: "10", y: "40", "font-size": "20" });
    expect(off.lines[0]!.attrs).toEqual({ x: "10", dy: "0", "text-decoration": "underline" });
    expect(off.lines[1]!.attrs).toEqual({ x: "10", dy: "25" });
    expect(lineRuns(off.lines[1]!)).toEqual([{ text: "in ", attrs: { "text-decoration": "underline" } }, { text: "pioggia", attrs: { ...BLUE, ...BOLD } }]);
    expect(emphasisIn(off, at(1, 0), at(1, 3), "underline")).toBe(true);
    expect(emphasisIn(off, at(1, 3), at(1, 10), "underline")).toBe(false);
    // Barrato e sottolineato stanno insieme, nell'ordine del file.
    const both = toggleEmphasis(off, at(1, 0), at(1, 3), "strike");
    expect(lineRuns(both.lines[1]!)[0]).toEqual({ text: "in ", attrs: { "text-decoration": "underline line-through" } });
  });

  it("sul testo intero, righe e pezzi lasciano il loro valore; un corpo nuovo porta interlinee e spaziature, ciascuna sul suo corpo", () => {
    const spaced: Rich = { ...TWO, attrs: { ...TWO.attrs, "letter-spacing": "1" } };
    const blue = restyleWhole(spaced, "fill", "#009e73");
    expect(blue.attrs.fill).toBe("#009e73");
    expect(lineRuns(blue.lines[1]!)).toEqual(["in ", { text: "pioggia", attrs: BOLD }]);
    const big = restyleWhole({ ...spaced, lines: [TWO.lines[0]!, { ...TWO.lines[1]!, attrs: { ...TWO.lines[1]!.attrs, "font-size": "12", "letter-spacing": "0.5" } }] }, "font-size", "30");
    expect(big.attrs).toEqual({ id: "o1", x: "10", y: "40", "font-size": "30", "letter-spacing": "1.5" });
    // L'interlinea era 1,25 volte il corpo più grande delle due righe, 20;
    // la spaziatura della riga 0,5 sul suo corpo 12.
    expect(big.lines.map((line) => line.attrs)).toEqual([{ x: "10", dy: "0" }, { x: "10", dy: "37.5", "letter-spacing": "1.25" }]);
  });

  it("il pannello legge il testo intero: i valori dei caratteri, l'interlinea, la spaziatura, le enfasi e l'allineamento", () => {
    expect(seenValues(TWO, "fill")).toEqual(["#000000", "#0072b2"]);
    expect(seenValues(TWO, "font-size")).toEqual(["20"]);
    expect(leadingOf(TWO, 1)).toBe(1.25);
    expect(leadingOf(TWO, 0)).toBeNull();
    expect(emphasisOf(TWO, "bold")).toBeNull();
    expect(emphasisOf(TWO, "italic")).toBe(false);
    expect(spacingsOf(TWO)).toEqual([0]);
    expect(anchorsOf(TWO)).toEqual(["start"]);
    // Un pezzo più grande allarga l'interlinea della sua riga.
    const big: Rich = { ...TWO, lines: [TWO.lines[0]!, richLine({ x: "10", dy: "25" }, ["in ", { text: "pioggia", attrs: { "font-size": "40" } }])] };
    expect(leadingOf(big, 1)).toBe(0.625);
    expect(withLeading(big, 1.2).lines[1]!.attrs.dy).toBe("48");
    // La spaziatura sul corpo di ciascuno.
    const spaced = withSpacing(big, 0.05);
    expect(spaced.attrs["letter-spacing"]).toBe("1");
    expect(lineRuns(spaced.lines[1]!)).toEqual(["in ", { text: "pioggia", attrs: { "font-size": "40", "letter-spacing": "2" } }]);
    expect(spacingsOf(spaced)).toEqual([0.05]);
  });

  it("un'enfasi sul testo intero: il peso sul testo, una linea scritta dal testo e lasciata da righe e pezzi", () => {
    const bold = emphasizeWhole(TWO, "bold", true);
    expect(bold.attrs["font-weight"]).toBe("bold");
    expect(lineRuns(bold.lines[1]!)).toEqual(["in ", { text: "pioggia", attrs: BLUE }]);
    expect(emphasisOf(bold, "bold")).toBe(true);
    const under: Rich = { ...TWO, lines: [TWO.lines[0]!, richLine({ x: "10", dy: "25", "text-decoration": "line-through" }, ["in ", { text: "pioggia", attrs: { "text-decoration": "underline" } }])] };
    const all = emphasizeWhole(under, "underline", true);
    expect(all.attrs["text-decoration"]).toBe("underline");
    expect(all.lines[1]!.attrs["text-decoration"]).toBe("line-through");
    expect(lineRuns(all.lines[1]!)).toBe("in pioggia");
    expect(emphasisOf(all, "underline")).toBe(true);
    expect(emphasisOf(emphasizeWhole(all, "strike", false), "strike")).toBe(false);
  });

  it("un colore uguale a quello della riga non si scrive nel pezzo", () => {
    const black = setInRange(TWO, at(1, 0), at(1, 10), "fill", "#000000");
    expect(lineRuns(black.lines[1]!)).toEqual(["in ", { text: "pioggia", attrs: BOLD }]);
    expect(valuesIn(black, at(1, 0), at(1, 10), "fill")).toEqual(["#000000", "#000000"]);
    expect(valuesIn(TWO, at(1, 5), at(1, 5), "fill")).toEqual(["#0072b2"]);
  });
});

describe("il testo come lo scrive il file", () => {
  it("gli spazi in fila valgono uno anche fra due pezzi, e le righe vuote ai bordi non ci sono", () => {
    const messy: Rich = {
      ...TWO,
      lines: [
        richLine({ x: "10", dy: "0" }, "  "),
        richLine({ x: "10", dy: "25" }, [" Ciao\t ", { text: " mondo ", attrs: BOLD }]),
        richLine({ x: "10", dy: "25" }, ""),
        richLine({ x: "10", dy: "25" }, "due"),
        richLine({ x: "10", dy: "25" }, " "),
      ],
    };
    const tidy = tidyRich(messy);
    expect(tidy.lines.map(lineRuns)).toEqual([["Ciao ", { text: "mondo", attrs: BOLD }], "\u00a0", "due"]);
    // La prima riga che resta scende quanto la prima di prima.
    expect(tidy.lines[0]!.attrs).toEqual({ x: "10", dy: "0" });
    expect(tidyRich({ ...TWO, lines: [richLine({ dy: "0" }, " \t ")] }).lines).toEqual([]);
  });



});

describe("uno stile dato a un testo", () => {
  it("scrive il valore sul testo, e le parole che ne hanno un altro lo tengono", () => {
    const styled = restyleKeeping(TWO, "fill", "#d55e00");
    expect(styled.attrs.fill).toBe("#d55e00");
    expect(lineRuns(styled.lines[1]!)).toEqual(["in ", { text: "pioggia", attrs: { ...BLUE, ...BOLD } }]);
  });

  it("toglie il valore uguale a chi lo scriveva", () => {
    const blue = restyleKeeping(TWO, "fill", "#0072B2");
    expect(lineRuns(blue.lines[1]!)).toEqual(["in ", { text: "pioggia", attrs: BOLD }]);
  });

  it("un corpo nuovo porta con sé l'interlinea e la spaziatura scritte", () => {
    const spaced: Rich = { ...TWO, attrs: { ...TWO.attrs, "letter-spacing": "2" } };
    const big = restyleKeeping(spaced, "font-size", "40");
    expect(big.attrs["font-size"]).toBe("40");
    expect(big.attrs["letter-spacing"]).toBe("4");
    expect(big.lines[1]!.attrs.dy).toBe("50");
  });

  it("il sottolineato si accende sul testo, e le righe e le parole restano come sono", () => {
    const under = emphasizeKeeping(TWO, "underline", true);
    expect(under.attrs["text-decoration"]).toBe("underline");
    expect(under.lines).toBe(TWO.lines);
  });
});
