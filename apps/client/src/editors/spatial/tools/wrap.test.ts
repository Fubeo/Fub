// Gli a capo di un testo in area: dove si va a capo, la parola che non ci
// sta, i pezzi che passano da una riga all'altra, i paragrafi e il punto
// del cursore. Si misura con la stima: ogni grafema 0,6 volte il corpo.

import { describe, expect, it } from "vitest";
import { estimate, type Font } from "./measure";
import type { Rich, Span } from "./rich";
import { joinOf, reflow, unwrap, wrapParagraphs, wrapSpans, type WrappedLine } from "./wrap";

/// Un corpo di 10: ogni grafema è largo 6.
const FONT: Font = { family: "Inter, sans-serif", size: 10, weight: "normal", style: "normal", spacing: 0 };
const BOLD = { "font-weight": "bold" };

/// `text` in righe larghe al più `chars` grafemi.
function wrap(text: string | readonly Span[], chars: number, fontOf: (span: Span) => Font = () => FONT) {
  const spans = typeof text === "string" ? [{ text, attrs: null }] : text;
  return wrapSpans(spans, chars * 6, fontOf, estimate);
}

/// Il testo di ogni riga, e come continua la prima.
const shown = (lines: readonly WrappedLine[]): Array<[string, string | null]> => lines.map((line) => [line.spans.map((s) => s.text).join(""), line.join]);

/// Le righe rimesse insieme, come le legge chi non va a capo.
const rejoined = (lines: readonly WrappedLine[]): string =>
  lines.map((line) => (line.join === "space" ? " " : "") + line.spans.map((s) => s.text).join("")).join("");

describe("dove si va a capo", () => {
  it("ogni riga prende le parole che ci stanno; lo spazio dell'a capo non si scrive", () => {
    const out = wrap("Il testo in area va a capo da solo", 10);
    expect(shown(out.lines)).toEqual([
      ["Il testo", null],
      ["in area va", "space"],
      ["a capo da", "space"],
      ["solo", "space"],
    ]);
    expect(out.overflow).toBe(false);
  });

  it("dopo un trattino che segue una lettera, e non dopo uno che comincia una parola", () => {
    expect(shown(wrap("un trat-tino", 9).lines)).toEqual([
      ["un trat-", null],
      ["tino", "word"],
    ]);
    for (const hyphen of ["‐", "–", "—"]) expect(shown(wrap(`ab${hyphen}cdef`, 4).lines)[0]).toEqual([`ab${hyphen}`, null]);
    // Un trattino dopo uno spazio non è un a capo: la parola si spezza.
    expect(shown(wrap("a -bcdef", 4).lines)).toEqual([
      ["a", null],
      ["-bcd", "space"],
      ["ef", "word"],
    ]);
  });

  it("una parola più larga del riquadro si spezza fra due grafemi, dove ne stanno di più", () => {
    expect(shown(wrap("precipitevolissimevolmente", 10).lines)).toEqual([
      ["precipitev", null],
      ["olissimevo", "word"],
      ["lmente", "word"],
    ]);
    expect(shown(wrap("Un precipitevolissimevolmente", 10).lines)).toEqual([
      ["Un", null],
      ["precipitev", "space"],
      ["olissimevo", "word"],
      ["lmente", "word"],
    ]);
    // Mai dentro un grafema.
    expect(shown(wrap("ééé", 2).lines)).toEqual([
      ["éé", null],
      ["é", "word"],
    ]);
  });

  it("un grafema più largo del riquadro sta da solo, e la riga va oltre", () => {
    const out = wrap("ab cd", 0.5);
    expect(shown(out.lines)).toEqual([
      ["a", null],
      ["b", "word"],
      ["c", "space"],
      ["d", "word"],
    ]);
    expect(out.overflow).toBe(true);
  });

  it("gli spazi in fondo non contano, e quelli in più restano alla fine della riga", () => {
    expect(shown(wrap("abcde ", 5).lines)).toEqual([["abcde ", null]]);
    expect(shown(wrap("ab  cd", 3).lines)).toEqual([
      ["ab ", null],
      ["cd", "space"],
    ]);
    // Gli spazi in testa non sono un a capo, e una riga non è fatta di soli
    // spazi.
    expect(shown(wrap("  ab", 4).lines)).toEqual([["  ab", null]]);
    expect(shown(wrap("  abcd", 3).lines)).toEqual([
      ["  a", null],
      ["bcd", "word"],
    ]);
  });

  it("un paragrafo vuoto è una riga vuota", () => {
    expect(shown(wrap("", 5).lines)).toEqual([["", null]]);
    expect(shown(wrap([], 5).lines)).toEqual([["", null]]);
  });

  it("le righe rimesse insieme sono il paragrafo, carattere per carattere", () => {
    const texts = ["Il testo in area va a capo da solo", "un trat-tino e—un altro", "precipitevolissimevolmente", "ab  cd  ef ", "  in testa", "👨‍👩‍👧👨‍👩‍👧 é x-y-z"];
    for (const text of texts) {
      for (const chars of [1, 2, 3, 5, 8, 13]) expect(rejoined(wrap(text, chars).lines), `${text} a ${chars}`).toBe(text);
    }
  });
});

describe("i pezzi e i caratteri", () => {
  it("un pezzo che passa da una riga all'altra diventa due pezzi con gli stessi attributi", () => {
    const out = wrap(
      [
        { text: "Il te", attrs: null },
        { text: "sto in", attrs: BOLD },
      ],
      5,
    );
    expect(out.lines).toEqual([
      { spans: [{ text: "Il", attrs: null }], join: null },
      {
        spans: [
          { text: "te", attrs: null },
          { text: "sto", attrs: BOLD },
        ],
        join: "space",
      },
      { spans: [{ text: "in", attrs: BOLD }], join: "space" },
    ]);
  });

  it("ogni pezzo si misura col suo carattere", () => {
    const big = { "font-size": "20" };
    const fontOf = (span: Span): Font => (span.attrs === big ? { ...FONT, size: 20 } : FONT);
    // «AB», a corpo 20, vale quattro grafemi: in 7 «ab AB cd» va a capo dopo
    // «AB».
    expect(
      shown(
        wrap(
          [
            { text: "ab ", attrs: null },
            { text: "AB", attrs: big },
            { text: " cd", attrs: null },
          ],
          7,
          fontOf,
        ).lines,
      ),
    ).toEqual([
      ["ab AB", null],
      ["cd", "space"],
    ]);
    expect(shown(wrap("abc def", 6, () => ({ ...FONT, spacing: 6 })).lines)).toEqual([
      ["abc", null],
      ["def", "space"],
    ]);
  });
});

describe("i paragrafi di un testo in area", () => {
  const TEXT = { id: "o5e6f7g8h", "fub:wrap": "60", x: "100", y: "200", "font-size": "10" };
  const rich = (...lines: Array<[Record<string, string>, string]>): Rich => ({
    attrs: TEXT,
    inherited: {},
    lines: lines.map(([attrs, text]) => ({ attrs, spans: text === "" ? [] : [{ text, attrs: null }] })),
  });
  const texts = (value: Rich): Array<[Record<string, string>, string]> => value.lines.map((line) => [{ ...line.attrs }, line.spans.map((s) => s.text).join("")]);

  it("le righe che continuano un paragrafo si uniscono, con lo spazio che l'a capo ha tolto", () => {
    const value = rich(
      [{ x: "100", dy: "0" }, "Il testo"],
      [{ "fub:join": "space", x: "100", dy: "14" }, "in area"],
      [{ "fub:join": "word", x: "100", dy: "14" }, "va"],
      [{ x: "100", dy: "14" }, "Nuovo"],
      [{ "fub:join": "other", x: "100", dy: "14" }, "Altro"],
    );
    expect(texts(unwrap(value))).toEqual([
      [{ x: "100", dy: "0" }, "Il testo in areava"],
      [{ x: "100", dy: "14" }, "Nuovo"],
      [{ x: "100", dy: "14" }, "Altro"],
    ]);
    // La prima riga comincia sempre un paragrafo.
    expect(texts(unwrap(rich([{ "fub:join": "space", dy: "0" }, "Uno"])))).toEqual([[{ dy: "0" }, "Uno"]]);
    expect(joinOf({ "fub:join": "word" })).toBe("word");
    expect(joinOf({ "fub:join": "other" })).toBeNull();
  });

  it("le righe di un paragrafo copiano il paragrafo senza id, all'interlinea del testo", () => {
    const paragraphs = rich([{ id: "t1", x: "100", dy: "0", "font-style": "italic" }, "Il testo in area va a capo"], [{ x: "100", dy: "14" }, "Fine"]);
    const out = wrapParagraphs(paragraphs, 60, estimate, "14");
    expect(texts(out.rich)).toEqual([
      [{ id: "t1", x: "100", dy: "0", "font-style": "italic" }, "Il testo"],
      [{ x: "100", dy: "14", "font-style": "italic", "fub:join": "space" }, "in area va"],
      [{ x: "100", dy: "14", "font-style": "italic", "fub:join": "space" }, "a capo"],
      [{ x: "100", dy: "14" }, "Fine"],
    ]);
    expect(out.overflow).toBe(false);
  });

  it("reflow rifà gli a capo con l'interlinea che il testo ha, e porta il cursore", () => {
    const value = rich([{ x: "100", dy: "0" }, "Il testo in"], [{ "fub:join": "space", x: "100", dy: "17" }, "area va a capo"]);
    const out = reflow(value, 60, estimate);
    expect(texts(out.rich)).toEqual([
      [{ x: "100", dy: "0" }, "Il testo"],
      [{ x: "100", dy: "17", "fub:join": "space" }, "in area va"],
      [{ x: "100", dy: "17", "fub:join": "space" }, "a capo"],
    ]);
    // «in» passa alla riga dopo; il punto dopo «ar» lo segue.
    expect(out.caret({ line: 1, offset: 2 })).toEqual({ line: 1, offset: 5 });
    expect(out.caret({ line: 0, offset: 9 })).toEqual({ line: 1, offset: 0 });
    expect(out.caret({ line: 0, offset: 8 })).toEqual({ line: 0, offset: 8 });
    expect(out.caret({ line: 1, offset: 14 })).toEqual({ line: 2, offset: 6 });
  });

  it("i pezzi tornano i pezzi di prima", () => {
    const value: Rich = {
      attrs: TEXT,
      inherited: {},
      lines: [
        { attrs: { dy: "0" }, spans: [{ text: "Il ", attrs: null }, { text: "testo", attrs: BOLD }] },
        { attrs: { dy: "14", "fub:join": "space" }, spans: [{ text: "in area", attrs: BOLD }] },
      ],
    };
    const out = reflow(value, 120, estimate);
    expect(out.rich.lines).toEqual([
      {
        attrs: { dy: "0" },
        spans: [
          { text: "Il ", attrs: null },
          { text: "testo in area", attrs: BOLD },
        ],
      },
    ]);
  });
});
