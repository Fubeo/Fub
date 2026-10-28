import { describe, expect, it } from "vitest";
import { Mark } from "prosemirror-model";
import { attrsOf, caretOf, docLines, linesDoc, linesSchema, marksOf, posOf, type WrittenLine } from "./lines";

const schema = linesSchema({ lineClass: "riga" });

const names = (attrs: Record<string, string> | null): string[] => marksOf(schema, attrs).map((mark) => mark.type.name);

describe("il profilo a righe di Scrittura", () => {
  it("dice con le marche di Scrittura ciò che ne ha una, e tiene il resto nella marca opaca", () => {
    expect(names({ "font-weight": "bold", "font-style": "italic", "text-decoration": "underline line-through", "font-family": "Inter", "font-size": "20", fill: "#0072b2" })).toEqual([
      "rest",
      "b",
      "i",
      "u",
      "s",
      "font",
      "size",
      "color",
    ]);
    // Un peso leggero, un colore che non è `#rrggbb` e le linee in un altro
    // ordine restano com'erano.
    const rest = marksOf(schema, { "font-weight": "300", fill: "url(#g) #ff0000", "text-decoration": "line-through underline", "letter-spacing": "2" })[0]!;
    expect(rest.type.name).toBe("rest");
    expect(rest.attrs.attrs).toEqual({ "font-weight": "300", fill: "url(#g) #ff0000", "text-decoration": "line-through underline", "letter-spacing": "2" });
    expect(names(null)).toEqual([]);
  });

  it.each<Record<string, string>>([
    { "font-weight": "bold" },
    { "font-weight": "700", fill: "#0072b2" },
    { fill: "#0072b2", "font-weight": "700" },
    { "text-decoration": "underline" },
    { "text-decoration": "underline line-through", "font-size": "12px" },
    { "text-decoration": "line-through underline" },
    { "data-x": "1", "font-family": "'Inter', sans-serif", fill: "#FF0000", "fub:id": "p2" },
  ])("andata e ritorno ridanno il pezzo, attributo per attributo: %j", (attrs) => {
    const back = attrsOf(marksOf(schema, attrs));
    expect(back).toEqual(attrs);
    expect(Object.keys(back!)).toEqual(Object.keys(attrs));
  });

  it("una marca aggiunta da un comando scrive il suo attributo dopo quelli del pezzo", () => {
    const marks = Mark.setFrom([...marksOf(schema, { fill: "#0072b2" }), schema.marks.b!.create({ value: "bold" })]);
    expect(Object.keys(attrsOf(marks)!)).toEqual(["fill", "font-weight"]);
    expect(attrsOf([schema.marks.i!.create({ value: "italic" })])).toEqual({ "font-style": "italic" });
  });

  it("le righe tornano righe, con gli attributi, i pezzi e le righe vuote", () => {
    const lines: WrittenLine[] = [
      { attrs: { x: "10", dy: "0", "fub:join": "space" }, spans: [{ text: "in ", attrs: null }, { text: "pioggia", attrs: { fill: "#0072b2", "font-weight": "bold" } }] },
      { attrs: { x: "10", dy: "25" }, spans: [] },
      { attrs: {}, spans: [{ text: "fine", attrs: { "letter-spacing": "1" } }] },
    ];
    expect(docLines(linesDoc(schema, lines))).toEqual(lines);
    expect(docLines(linesDoc(schema, []))).toEqual([{ attrs: {}, spans: [] }]);
  });

  it("un punto e la sua posizione si corrispondono", () => {
    const doc = linesDoc(schema, [
      { attrs: {}, spans: [{ text: "ab", attrs: null }] },
      { attrs: {}, spans: [{ text: "cde", attrs: null }] },
    ]);
    for (const caret of [
      { line: 0, offset: 0 },
      { line: 0, offset: 2 },
      { line: 1, offset: 0 },
      { line: 1, offset: 3 },
    ]) {
      expect(caretOf(doc, posOf(doc, caret))).toEqual(caret);
    }
    expect(posOf(doc, { line: 9, offset: 99 })).toBe(doc.content.size - 1);
    expect(caretOf(doc, 0)).toEqual({ line: 0, offset: 0 });
    expect(caretOf(doc, doc.content.size)).toEqual({ line: 1, offset: 3 });
  });
});
