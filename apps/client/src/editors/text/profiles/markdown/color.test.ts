import { describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { colorsAt, setContentColor, type ColorKind, type ContentColor } from "./color";
import { colorClasses, renderInline } from "./render-inline";

// I colori del contenuto (K1): classi fisse, un tag che avvolge, una classe
// che cambia al posto di un secondo tag.

const at = (doc: string, anchor: number, head = anchor) =>
  EditorState.create({ doc, selection: EditorSelection.single(anchor, head) });

const color = (state: EditorState, kind: ColorKind, value: ContentColor | null, range?: { from: number; to: number }) => {
  let next: EditorState | null = null;
  const ran = setContentColor(kind, value, range)({ state, dispatch: (tr) => void (next = tr.state) });
  return { ran, state: next as EditorState | null, doc: (next as EditorState | null)?.doc.toString() ?? null };
};

describe("le classi ammesse", () => {
  it("al più un colore del testo e uno del fondo, dei nove nomi", () => {
    expect(colorClasses("fub-color-red")).toBe("fub-color-red");
    expect(colorClasses(" fub-bg-blue  fub-color-gray ")).toBe("fub-color-gray fub-bg-blue");
    expect(colorClasses("fub-color-red fub-color-blue")).toBeNull();
    expect(colorClasses("fub-color-teal")).toBeNull();
    expect(colorClasses("fub-color-red altro")).toBeNull();
    expect(colorClasses("")).toBeNull();
  });

  it("la resa porta il tag con le sue classi, e ignora le altre", () => {
    const render = (source: string) => renderInline({ source, references: new Map(), footnotes: new Map() }, 0, source.length);
    expect(render('a <span class="fub-color-red">b</span> c')).toContain('<span class="fub-color-red"');
    expect(render('<mark class="fub-bg-yellow">b</mark>')).toContain('<mark class="fub-bg-yellow"');
    expect(render('<span class="evil">b</span>')).not.toContain('class="evil"');
  });
});

describe("dare un colore", () => {
  it("avvolge la selezione e la tiene sul testo", () => {
    const result = color(at("uno due tre", 4, 7), "text", "red");
    expect(result.doc).toBe('uno <span class="fub-color-red">due</span> tre');
    const main = result.state!.selection.main;
    expect(result.state!.sliceDoc(main.from, main.to)).toBe("due");
  });

  it("senza selezione colora la riga dopo i segni del blocco", () => {
    expect(color(at("## Titolo", 5), "fill", "yellow").doc).toBe('## <mark class="fub-bg-yellow">Titolo</mark>');
    expect(color(at("- [ ] fare", 8), "text", "blue").doc).toBe('- [ ] <span class="fub-color-blue">fare</span>');
    expect(color(at("> citato", 4), "text", "gray").doc).toBe('> <span class="fub-color-gray">citato</span>');
  });

  it("cambia la classe del tag che c'è già, anche aggiungendo il fondo", () => {
    const doc = 'a <span class="fub-color-red">due</span> b';
    const inside = doc.indexOf("due");
    const blue = color(at(doc, inside, inside + 3), "text", "blue");
    expect(blue.doc).toBe('a <span class="fub-color-blue">due</span> b');
    expect(color(at(doc, inside, inside + 3), "fill", "green").doc).toBe('a <span class="fub-color-red fub-bg-green">due</span> b');
    expect(colorsAt(at(doc, inside, inside + 3))).toEqual({ text: "red", fill: null });
    // Lo stesso colore non cambia niente.
    expect(color(at(doc, inside, inside + 3), "text", "red").ran).toBe(false);
  });

  it("«Predefinito» toglie la classe, e con l'ultima il tag", () => {
    const doc = 'a <span class="fub-color-red">due</span> b';
    const inside = doc.indexOf("due");
    expect(color(at(doc, inside, inside + 3), "text", null).doc).toBe("a due b");
    const both = '<mark class="fub-color-red fub-bg-green">x</mark>';
    expect(color(at(both, both.indexOf("x"), both.indexOf("x") + 1), "fill", null).doc).toBe('<mark class="fub-color-red">x</mark>');
    expect(color(at("niente", 0, 6), "text", null).ran).toBe(false);
  });

  it("in una riga vuota scrive la coppia vuota col cursore dentro", () => {
    const result = color(at("", 0), "text", "purple");
    expect(result.doc).toBe('<span class="fub-color-purple"></span>');
    expect(result.state!.selection.main.head).toBe('<span class="fub-color-purple">'.length);
    expect(color(at("", 0), "text", null).ran).toBe(false);
  });

  it("il menu del blocco sceglie il tratto e lascia il cursore", () => {
    const doc = "uno\ndue";
    const result = color(at(doc, 1), "fill", "pink", { from: 4, to: 7 });
    expect(result.doc).toBe('uno\n<mark class="fub-bg-pink">due</mark>');
    expect(result.state!.selection.main.head).toBe(1);
  });

  it("una nota di sola lettura non cambia", () => {
    const state = EditorState.create({ doc: "x", extensions: EditorState.readOnly.of(true), selection: EditorSelection.single(0, 1) });
    expect(color(state, "text", "red").ran).toBe(false);
  });
});
