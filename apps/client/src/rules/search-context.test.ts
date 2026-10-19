import { describe, expect, it } from "vitest";
import { occurrenceContext } from "./search-context";

const bytes = (text: string) => new TextEncoder().encode(text);
const at = (text: string, word: string) => {
  const start = bytes(text.slice(0, text.indexOf(word))).length;
  return [start, start + bytes(word).length] as const;
};
const marked = (context: { text: string; highlight: { start: number; end: number } }) => {
  const all = bytes(context.text);
  const decoder = new TextDecoder();
  return decoder.decode(all.subarray(context.highlight.start, context.highlight.end));
};

describe("occurrenceContext", () => {
  it("porta la riga dell'occorrenza con una riga prima e una dopo", () => {
    const text = "uno\ndue\ntre città\nquattro\ncinque\n";
    const [start, end] = at(text, "città");
    const context = occurrenceContext(bytes(text), start, end);
    expect(context.text).toBe("due\ntre città\nquattro");
    expect(marked(context)).toBe("città");
  });

  it("toglie i \\r e tiene l'occorrenza sulle sue parole", () => {
    const text = "prima\r\nqui è\r\ndopo\r\n";
    const [start, end] = at(text, "è");
    const context = occurrenceContext(bytes(text), start, end);
    expect(context.text).toBe("prima\nqui è\ndopo");
    expect(marked(context)).toBe("è");
  });

  it("una riga lunghissima si taglia attorno all'occorrenza", () => {
    const text = `${"à".repeat(400)} cercata ${"b".repeat(400)}`;
    const [start, end] = at(text, "cercata");
    const context = occurrenceContext(bytes(text), start, end);
    expect(context.text.startsWith("…")).toBe(true);
    expect(context.text.endsWith("…")).toBe(true);
    expect(context.text).not.toContain("�");
    expect(marked(context)).toBe("cercata");
  });

  it("le righe vuote ai bordi non entrano", () => {
    const text = "titolo\n\nqui la parola\n\naltro";
    const [start, end] = at(text, "parola");
    const context = occurrenceContext(bytes(text), start, end);
    expect(context.text).toBe("qui la parola");
    expect(marked(context)).toBe("parola");
  });

  it("una posizione oltre la fine si stringe al testo", () => {
    const context = occurrenceContext(bytes("corto"), 40, 50);
    expect(context.text).toBe("corto");
    expect(context.highlight.start).toBe(context.highlight.end);
  });
});
