import { describe, expect, it } from "vitest";
import {
  emphasisIn,
  lineRuns,
  newLeading,
  replaceRange,
  restyleWhole,
  richChange,
  richLine,
  richText,
  setInRange,
  styleAt,
  tidyRich,
  toggleEmphasis,
  valuesIn,
  type Rich,
} from "./rich";

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

describe("scrivere e cancellare", () => {
  it("ciò che si scrive prende lo stile del carattere prima, o del primo dopo all'inizio della riga", () => {
    expect(styleAt(TWO, at(1, 3))).toBeNull();
    expect(styleAt(TWO, at(1, 4))).toEqual({ ...BLUE, ...BOLD });
    expect(styleAt(TWO, at(1, 10))).toEqual({ ...BLUE, ...BOLD });
    expect(styleAt(TWO, at(0, 0))).toBeNull();
    const typed = replaceRange(TWO, at(1, 10), at(1, 10), " fine", styleAt(TWO, at(1, 10)));
    expect(lineRuns(typed.rich.lines[1]!)).toEqual(["in ", { text: "pioggia fine", attrs: { ...BLUE, ...BOLD } }]);
    expect(typed.caret).toEqual(at(1, 15));
  });

  it("un a capo spezza la riga: la prima tiene i suoi attributi, la nuova copia la riga e scende dell'interlinea", () => {
    const split = replaceRange(TWO, at(1, 6), at(1, 6), "\n", styleAt(TWO, at(1, 6)));
    expect(split.rich.lines.map((line) => line.attrs)).toEqual([{ x: "10", dy: "0" }, { x: "10", dy: "25" }, { x: "10", dy: "25" }]);
    expect(split.rich.lines.map(lineRuns)).toEqual(["Evaporazione", ["in ", { text: "pio", attrs: { ...BLUE, ...BOLD } }], [{ text: "ggia", attrs: { ...BLUE, ...BOLD } }]]);
    expect(split.caret).toEqual(at(2, 0));
    // Un testo di una riga sola scende di 1,25 volte il suo corpo.
    expect(newLeading({ ...TWO, lines: [TWO.lines[0]!] })).toBe("25");
  });

  it("cancellare a cavallo di due righe le unisce, coi pezzi che restano", () => {
    const joined = replaceRange(TWO, at(0, 3), at(1, 3), "", null);
    expect(richText(joined.rich)).toBe("Evapioggia");
    expect(lineRuns(joined.rich.lines[0]!)).toEqual(["Eva", { text: "pioggia", attrs: { ...BLUE, ...BOLD } }]);
    expect(joined.rich.lines[0]!.attrs).toEqual({ x: "10", dy: "0" });
    expect(joined.caret).toEqual(at(0, 3));
  });

  it("i caratteri che XML non ammette restano fuori", () => {
    expect(richText(replaceRange(TWO, at(0, 0), at(0, 0), "a\u0007b", null).rich)).toBe("abEvaporazione\nin pioggia");
  });
});

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

  it("sul testo intero, righe e pezzi lasciano il loro valore; un corpo nuovo porta in proporzione interlinee e spaziature", () => {
    const spaced: Rich = { ...TWO, attrs: { ...TWO.attrs, "letter-spacing": "1" } };
    const blue = restyleWhole(spaced, "fill", "#009e73");
    expect(blue.attrs.fill).toBe("#009e73");
    expect(lineRuns(blue.lines[1]!)).toEqual(["in ", { text: "pioggia", attrs: BOLD }]);
    const big = restyleWhole({ ...spaced, lines: [TWO.lines[0]!, { ...TWO.lines[1]!, attrs: { ...TWO.lines[1]!.attrs, "font-size": "12", "letter-spacing": "0.5" } }] }, "font-size", "30");
    expect(big.attrs).toEqual({ id: "o1", x: "10", y: "40", "font-size": "30", "letter-spacing": "1.5" });
    expect(big.lines.map((line) => line.attrs)).toEqual([{ x: "10", dy: "0" }, { x: "10", dy: "37.5", "letter-spacing": "0.75" }]);
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

  it("le righe vanno con l'operazione text finché gli attributi sono quelli che lei darebbe", () => {
    expect(richChange(TWO, TWO)).toEqual({ kind: "none" });
    const typed = replaceRange(TWO, at(1, 10), at(1, 10), "\nnubi", null).rich;
    expect(richChange(TWO, typed)).toEqual({ kind: "lines", lines: ["Evaporazione", ["in ", { text: "pioggia", attrs: { ...BLUE, ...BOLD } }], "nubi"] });
    // Una riga in corsivo spezzata sopra la seconda: le righe dopo non
    // stanno più al loro posto, e il testo si riscrive intero.
    const italic: Rich = { ...TWO, lines: [TWO.lines[0]!, { ...TWO.lines[1]!, attrs: { ...TWO.lines[1]!.attrs, "font-style": "italic" } }] };
    const split = replaceRange(italic, at(0, 4), at(0, 4), "\n", null).rich;
    expect(richChange(italic, split).kind).toBe("elem");
    const under: Rich = { ...TWO, attrs: { ...TWO.attrs, "text-decoration": "underline" } };
    expect(richChange(under, toggleEmphasis(under, at(0, 0), at(0, 4), "underline")).kind).toBe("elem");
  });
});
