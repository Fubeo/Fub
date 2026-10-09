import { describe, expect, it } from "vitest";
import {
  anchorsOf,
  emphasisIn,
  emphasisOf,
  emphasizeKeeping,
  emphasizeWhole,
  leadingOf,
  lineRuns,
  newLeading,
  replaceRange,
  restyleKeeping,
  restyleWhole,
  richChange,
  richElem,
  richOf,
  seenValues,
  spacingsOf,
  richLine,
  richText,
  setInRange,
  styleAt,
  tidyRich,
  toggleEmphasis,
  valuesIn,
  withLeading,
  withSpacing,
  type Rich,
} from "./rich";
import type { Elem } from "../scene/serialize";

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

  it("le righe di un testo in area dicono come continua il paragrafo, quando cambia", () => {
    const area: Rich = {
      ...TWO,
      attrs: { ...TWO.attrs, "fub:wrap": "120" },
      lines: [richLine({ x: "10", dy: "0" }, "Il testo"), richLine({ x: "10", dy: "25", "fub:join": "space" }, "in area")],
    };
    // Un a capo comincia un paragrafo: la riga nuova non copia il suo.
    const typed = replaceRange(area, at(1, 7), at(1, 7), "\nva", null).rich;
    expect(typed.lines[2]!.attrs).toEqual({ x: "10", dy: "25" });
    expect(richChange(area, typed)).toEqual({ kind: "lines", lines: ["Il testo", "in area", "va"] });
    // Gli a capo rifatti cambiano come continuano le righe.
    const flowed: Rich = { ...area, lines: [richLine({ x: "10", dy: "0" }, "Il testo in"), richLine({ x: "10", dy: "25", "fub:join": "word" }, "area")] };
    expect(richChange(area, flowed)).toEqual({ kind: "lines", lines: ["Il testo in", "area"], joins: [null, "word"] });
    const more: Rich = { ...area, lines: [...area.lines, richLine({ x: "10", dy: "25", "fub:join": "space" }, "va")] };
    expect(richChange(area, more)).toEqual({ kind: "lines", lines: ["Il testo", "in area", "va"], joins: [null, "space", "space"] });
  });

  it("un testo su tracciato ha la riga sola nel suo textPath", () => {
    const old: Elem = {
      tag: "text",
      attrs: { id: "o1", "font-size": "20" },
      children: [
        { tag: "title", attrs: {}, text: "Arco" },
        { tag: "textPath", attrs: { href: "#r1", startOffset: "50%" }, runs: ["Sul ", { text: "colle", attrs: BOLD }] },
      ],
    };
    const rich = richOf(old, {});
    expect(rich.lines).toEqual([richLine({}, ["Sul ", { text: "colle", attrs: BOLD }])]);
    const typed = replaceRange(rich, at(0, 9), at(0, 9), "!", null).rich;
    expect(richChange(rich, typed)).toEqual({ kind: "lines", lines: [["Sul ", { text: "colle", attrs: BOLD }, "!"]] });
    expect(richElem(old, { ...typed, attrs: { ...old.attrs, fill: "#0072b2" } })).toEqual({
      tag: "text",
      attrs: { id: "o1", "font-size": "20", fill: "#0072b2" },
      children: [old.children![0], { tag: "textPath", attrs: { href: "#r1", startOffset: "50%" }, runs: ["Sul ", { text: "colle", attrs: BOLD }, "!"] }],
    });
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
