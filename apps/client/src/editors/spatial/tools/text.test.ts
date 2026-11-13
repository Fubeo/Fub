// Il testo del disegno: le righe come le scrive il file, e l'elemento che le
// porta.

import { describe, expect, it } from "vitest";
import { BLANK_LINE, editableText, newTextElem, textElem, textLines, TEXT_FAMILY, TEXT_SIZE, wordsOf } from "./text";

describe("le righe di un testo", () => {
  it("vanno a capo a ogni fine riga, e le vuote in testa e in coda non ci sono", () => {
    expect(textLines("uno\ndue\r\ntre\rquattro cinque sei")).toEqual(["uno", "due", "tre", "quattro", "cinque", "sei"]);
    expect(textLines("\n  \nCiao\n\n")).toEqual(["Ciao"]);
    expect(textLines("")).toEqual([]);
    expect(textLines(" \n\t\n")).toEqual([]);
  });

  it("una riga vuota fra due scritte è uno spazio indivisibile, che si rilegge vuoto", () => {
    const lines = textLines("sopra\n\n   \nsotto");
    expect(BLANK_LINE).toBe(" ");
    expect(lines).toEqual(["sopra", BLANK_LINE, BLANK_LINE, "sotto"]);
    expect(editableText(lines)).toBe("sopra\n\n\nsotto");
  });

  it("gli spazi in fila valgono uno, e ai bordi niente, come li mostra SVG", () => {
    expect(textLines("  a   b\t\tc  ")).toEqual(["a b c"]);
    // Gli spazi indivisibili si scrivono come sono.
    expect(textLines("a  b")).toEqual(["a  b"]);
  });

  it("lascia fuori ciò che XML non ammette, e tiene il resto", () => {
    expect(textLines("a\u0000b\u0007c\u000bd\u001fe￾f￿")).toEqual(["abcdef"]);
    expect(textLines("x\ud800y\udc00z")).toEqual(["xyz"]);
    expect(textLines("😀 è")).toEqual(["😀 è"]);
  });
});

describe("l'elemento di un testo nuovo", () => {
  it("ha un `tspan` per riga, ognuna un'interlinea più giù, col carattere dell'interfaccia", () => {
    expect(textElem("o1", [10.123, 20], ["uno", "due"], { color: "#0072b2", size: 32 })).toEqual({
      tag: "text",
      attrs: { id: "o1", x: "10.12", y: "20", fill: "#0072b2", "font-family": "Inter, sans-serif", "font-size": "32" },
      children: [
        { tag: "tspan", attrs: { x: "10.12", dy: "0" }, text: "uno" },
        { tag: "tspan", attrs: { x: "10.12", dy: "40" }, text: "due" },
      ],
    });
  });

});

describe("il testo nuovo dello strumento Testo, e le sue parole", () => {
  it("è una riga sulla linea di base, col carattere e il corpo di serie e il colore del gesto", () => {
    expect(newTextElem("o1", [100, 80], "Testo", "#0072b2")).toEqual({
      tag: "text",
      attrs: { id: "o1", x: "100", y: "80", fill: "#0072b2", "font-family": TEXT_FAMILY, "font-size": String(TEXT_SIZE) },
      children: [{ tag: "tspan", attrs: { x: "100", dy: "0" }, text: "Testo" }],
    });
  });

  it("le parole di un testo libero si rileggono come si scrivono, una riga per tspan", () => {
    const elem = textElem("o1", [10, 20], ["Ciao", BLANK_LINE, "a tutti"], { color: "#000000", size: 32 });
    expect(wordsOf(elem)).toBe("Ciao\n\na tutti");
    expect(wordsOf({ ...elem, children: [{ tag: "title", attrs: {}, text: "Nome" }, ...elem.children!] })).toBe("Ciao\n\na tutti");
  });

  it("niente parole per ciò che l'operazione `text` non riscrive senza perdite", () => {
    const elem = textElem("o1", [10, 20], ["Uno", "Due"], { color: "#000000", size: 32 });
    const [first, second] = elem.children!;
    const cases = [
      { ...elem, tag: "rect" },
      { ...elem, children: [] },
      { ...elem, attrs: { ...elem.attrs, "fub:wrap": "320" } },
      { ...elem, attrs: { ...elem.attrs, "fub:inside": "o2" } },
      { ...elem, attrs: { ...elem.attrs, "fub:along": "0.5" } },
      { ...elem, attrs: { ...elem.attrs, "xml:space": "preserve" } },
      { ...elem, children: [{ tag: "textPath", attrs: { href: "#p" }, text: "Lungo" }] },
      { ...elem, children: [first!, { ...second!, attrs: { ...second!.attrs, fill: "#ff0000" } }] },
      { ...elem, children: [first!, { ...second!, attrs: { ...second!.attrs, "fub:join": "space" } }] },
      { ...elem, children: [{ tag: "tspan", attrs: { x: "10", dy: "0" }, runs: ["Uno ", { text: "due", attrs: { "font-weight": "700" } }] }] },
    ];
    for (const each of cases) expect(wordsOf(each as never), JSON.stringify(each)).toBeNull();
  });
});
