// Il testo del disegno: le righe come le scrive il file, e l'elemento che le
// porta.

import { describe, expect, it } from "vitest";
import { BLANK_LINE, editableText, LINE_SPACING, TEXT_FAMILY, TEXT_SIZE, TEXT_SIZES, textElem, textLines } from "./text";

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

  it("parte dalla dimensione media di tre, con l'interlinea dell'operazione `text`", () => {
    expect(TEXT_SIZES.map((option) => [option.value, option.label])).toEqual([
      [24, "draw.size.small"],
      [32, "draw.size.medium"],
      [48, "draw.size.large"],
    ]);
    expect(TEXT_SIZE).toBe(32);
    expect(LINE_SPACING).toBe(1.25);
    expect(TEXT_FAMILY).toBe("Inter, sans-serif");
  });
});
