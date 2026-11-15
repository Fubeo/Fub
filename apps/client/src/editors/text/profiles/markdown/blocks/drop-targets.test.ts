import { describe, expect, it, vi } from "vitest";
import { history, undo } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import type { SurfaceDropOffer } from "../../../../core/registry";
import { markdownGrammar } from "../grammar";
import { headingOfPlace, moveToSectionEnd, placeTargets, sectionEnd, targetAt } from "./drop-targets";
import { blockModel } from "./model";

// I bersagli fuori dalla colonna (E2): i titoli della Struttura, «In fondo a …».

function stateOf(doc: string): EditorState {
  const state = EditorState.create({ doc, extensions: [markdown({ base: markdownGrammar }), blockModel, history()] });
  ensureSyntaxTree(state, state.doc.length, 5000);
  return state;
}

const blocksOf = (state: EditorState) => state.field(blockModel).blocks;
const indexAt = (state: EditorState, text: string) => blocksOf(state).findIndex((block) => state.sliceDoc(block.from, block.to).startsWith(text));
const bytes = (text: string) => new TextEncoder().encode(text).length;

/// Il posto che la Struttura offre per il titolo che comincia con `heading`.
function offer(doc: string, heading: string, title: string, rect = { left: 0, top: 0, right: 100, bottom: 28 }): SurfaceDropOffer {
  const at = bytes(doc.slice(0, doc.indexOf(heading)));
  return { kind: "place", documentId: "nota.md", span: { start: at, end: at + bytes(heading) }, title, rect, hover: vi.fn() };
}

const DOC = "Uno\n\n## I conti\n\nDue\n\n### Spese\n\nTre\n\n## Fine\n\nQuattro";

describe("la fine di una sezione", () => {
  it("un H2 finisce al prossimo H2, sottosezioni comprese; un H3 al prossimo H3 o H2", () => {
    const state = stateOf(DOC);
    const blocks = blocksOf(state);
    expect(sectionEnd(blocks, indexAt(state, "## I conti"))).toBe(indexAt(state, "## Fine"));
    expect(sectionEnd(blocks, indexAt(state, "### Spese"))).toBe(indexAt(state, "## Fine"));
    expect(sectionEnd(blocks, indexAt(state, "## Fine")), "l'ultima sezione finisce con la nota").toBe(-1);
  });

  it("sposta il blocco in fondo alla sezione, in un passo d'annullamento", () => {
    const state = stateOf(DOC);
    const blocks = blocksOf(state);
    const uno = indexAt(state, "Uno");
    const spec = moveToSectionEnd(state, blocks, { first: uno, last: uno }, indexAt(state, "## I conti"))!;
    const moved = state.update(spec).state;
    expect(moved.doc.toString()).toBe("## I conti\n\nDue\n\n### Spese\n\nTre\n\nUno\n\n## Fine\n\nQuattro");
    let back = moved;
    undo({ state: moved, dispatch: (tr) => { back = tr.state; } });
    expect(back.doc.toString()).toBe(DOC);
  });

  it("verso l'ultima sezione va in fondo alla nota; anche verso l'alto", () => {
    const state = stateOf(DOC);
    const quattro = indexAt(state, "Quattro");
    const up = moveToSectionEnd(state, blocksOf(state), { first: quattro, last: quattro }, indexAt(state, "### Spese"))!;
    expect(state.update(up).state.doc.toString()).toBe("Uno\n\n## I conti\n\nDue\n\n### Spese\n\nTre\n\nQuattro\n\n## Fine");
    const uno = indexAt(state, "Uno");
    const down = moveToSectionEnd(state, blocksOf(state), { first: uno, last: uno }, indexAt(state, "## Fine"))!;
    expect(state.update(down).state.doc.toString()).toBe("## I conti\n\nDue\n\n### Spese\n\nTre\n\n## Fine\n\nQuattro\n\nUno");
  });

  it("niente da fare: il titolo in mano, un blocco già in fondo, una voce annidata", () => {
    const state = stateOf(DOC);
    const blocks = blocksOf(state);
    const conti = indexAt(state, "## I conti");
    expect(moveToSectionEnd(state, blocks, { first: conti, last: conti }, conti), "il titolo che è il blocco in mano").toBeNull();
    const tre = indexAt(state, "Tre");
    expect(moveToSectionEnd(state, blocks, { first: tre, last: tre }, conti), "Tre sta già in fondo a «I conti»").toBeNull();
    const nested = stateOf("- a\n  - b\n\n## X\n\nY");
    const b = indexAt(nested, "  - b");
    expect(b).toBeGreaterThan(0);
    expect(moveToSectionEnd(nested, blocksOf(nested), { first: b, last: b }, indexAt(nested, "## X")), "una voce annidata non sta al livello dei titoli").toBeNull();
  });

  it("il frontmatter resta il primo blocco", () => {
    const doc = "---\na: 1\n---\n\n## X\n\nY";
    const state = stateOf(doc);
    expect(moveToSectionEnd(state, blocksOf(state), { first: 0, last: 0 }, indexAt(state, "## X"))).toBeNull();
  });
});

describe("il titolo di un posto della Struttura", () => {
  it("si trova dallo span in byte UTF-8, anche dopo una lettera accentata", () => {
    const doc = "Città è qui\n\n## Più su\n\nTesto";
    const state = stateOf(doc);
    const place = offer(doc, "## Più su", "Più su");
    expect(place.span.start, "i byte non sono i caratteri").not.toBe(doc.indexOf("## Più su"));
    expect(headingOfPlace(state, blocksOf(state), place.span, place.title)).toBe(indexAt(state, "## Più su"));
  });

  it("una Struttura rimasta indietro di una battuta trova il titolo col suo testo, il più vicino", () => {
    const doc = "## A\n\nx\n\n## B\n\ny\n\n## A\n\nz";
    const state = stateOf(doc);
    // Lo span punta poco prima del secondo «A»: vince quello, non il primo.
    const second = doc.lastIndexOf("## A");
    expect(headingOfPlace(state, blocksOf(state), { start: second - 3 }, "A")).toBe(blocksOf(state).findIndex((b) => b.from === second));
    expect(headingOfPlace(state, blocksOf(state), { start: 0 }, "Assente"), "un titolo che non c'è più").toBe(-1);
  });
});

describe("i bersagli", () => {
  it("uno per titolo, con l'etichetta «In fondo a …», tolti quelli che non farebbero niente", () => {
    const state = stateOf(DOC);
    const blocks = blocksOf(state);
    const tre = indexAt(state, "Tre");
    const targets = placeTargets(state, blocks, { first: tre, last: tre }, [
      offer(DOC, "## I conti", "I conti"),
      offer(DOC, "### Spese", "Spese"),
      offer(DOC, "## Fine", "Fine", { left: 0, top: 60, right: 100, bottom: 88 }),
    ]);
    // Tre sta già in fondo a «I conti» e a «Spese»: resta «Fine».
    expect(targets.map((target) => target.label)).toEqual(["In fondo a «Fine»"]);
    expect(targetAt(targets, 50, 70)).toBe(targets[0]);
    expect(targetAt(targets, 50, 30), "fuori da ogni riga").toBeNull();
    const spec = targets[0]!.drop(state, blocks, { first: tre, last: tre })!;
    expect(state.update(spec).state.doc.toString()).toBe("Uno\n\n## I conti\n\nDue\n\n### Spese\n\n## Fine\n\nQuattro\n\nTre");
  });

  it("una riga che non si vede, o un posto che non è un titolo, non è un bersaglio", () => {
    const state = stateOf(DOC);
    const uno = indexAt(state, "Uno");
    const targets = placeTargets(state, blocksOf(state), { first: uno, last: uno }, [
      offer(DOC, "## I conti", "I conti", { left: 0, top: 0, right: 0, bottom: 0 }),
      offer(DOC, "Due", ""),
    ]);
    expect(targets).toEqual([]);
  });

  it("l'acceso passa alla shell", () => {
    const state = stateOf(DOC);
    const uno = indexAt(state, "Uno");
    const place = offer(DOC, "## Fine", "Fine");
    const [target] = placeTargets(state, blocksOf(state), { first: uno, last: uno }, [place]);
    target!.hover(true);
    expect(place.hover).toHaveBeenCalledWith(true);
  });
});
