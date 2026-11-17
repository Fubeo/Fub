import { describe, expect, it, vi } from "vitest";
import { history, undo } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import type { SurfaceNoteOffer, SurfacePlaceOffer } from "../../../../core/registry";
import { markdownGrammar } from "../grammar";
import { headingOfPlace, moveToSectionEnd, noteTargets, placeTargets, sectionEnd, targetAt } from "./drop-targets";
import { blockBytes } from "./move-to";
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
function offer(doc: string, heading: string, title: string, rect = { left: 0, top: 0, right: 100, bottom: 28 }): SurfacePlaceOffer {
  const at = bytes(doc.slice(0, doc.indexOf(heading)));
  return { kind: "place", document: { documentId: "nota.md", vault: undefined }, span: { start: at, end: at + bytes(heading) }, title, rect, hover: vi.fn() };
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
    expect(headingOfPlace(state, blocksOf(state), { start: doc.indexOf("x") }, "Assente"), "un titolo che non c'è più").toBe(-1);
  });

  it("i titoli formattati: la riga dello span basta, e il ripiego confronta il testo puro della Struttura", () => {
    const doc = "Uno\n\n## I **conti**\n\nDue\n\n## Vedi [[Marzo]]\n\nTre\n\n## Titolo ^abc\n\nQuattro\n\n## `x` e *y* \\# [z](u)\n\nFine";
    const state = stateOf(doc);
    const blocks = blocksOf(state);
    // Il nome della Struttura è `Heading.text` del provider, senza segni.
    const cases: [string, string][] = [
      ["## I **conti**", "I conti"],
      ["## Vedi [[Marzo]]", "Vedi Marzo"],
      ["## Titolo ^abc", "Titolo"],
      ["## `x` e *y* \\# [z](u)", "x e y # z"],
    ];
    for (const [heading, title] of cases) {
      const place = offer(doc, heading, title);
      expect(headingOfPlace(state, blocks, place.span, title), `${heading} dallo span`).toBe(indexAt(state, heading));
      // Lo span su un'altra riga (la Struttura indietro di una battuta): vince il nome.
      expect(headingOfPlace(state, blocks, { start: 0 }, title), `${heading} dal nome`).toBe(indexAt(state, heading));
    }
    const uno = indexAt(state, "Uno");
    const targets = placeTargets(state, blocks, { first: uno, last: uno }, cases.map(([heading, title]) => offer(doc, heading, title)));
    expect(targets.map((target) => target.label)).toEqual(cases.map(([, title]) => `In fondo a «${title}»`));
  });

  it("una nota coi CRLF: gli span contano i `\\r`, e il rilascio va sul titolo omonimo giusto", () => {
    // Ottanta `\r` prima del primo «A»: contati come caratteri, lo span
    // cadrebbe oltre il secondo «A», a due righe da lì, e vincerebbe quello.
    const filler = Array.from({ length: 40 }, (_, i) => [`riga ${i}`, ""]).flat();
    const disk = [...filler, "## A", "", "uno", "", "## A", "", "due", "", "## B", "", "tre"].join("\r\n");
    const state = EditorState.create({
      doc: disk,
      extensions: [EditorState.lineSeparator.of("\r\n"), markdown({ base: markdownGrammar }), blockModel, history()],
    });
    ensureSyntaxTree(state, state.doc.length, 5000);
    const blocks = blocksOf(state);
    expect(state.sliceDoc(), "la sorgente esce coi suoi a capo").toBe(disk);
    const first = bytes(disk.slice(0, disk.indexOf("## A")));
    const place: SurfacePlaceOffer = { kind: "place", document: { documentId: "nota.md", vault: undefined }, span: { start: first, end: first + 4 }, title: "A", rect: { left: 0, top: 0, right: 100, bottom: 28 }, hover: vi.fn() };
    const headings = blocks.map((block, i) => [block, i] as const).filter(([block]) => block.kind === "heading" && state.sliceDoc(block.from, block.to).startsWith("## A"));
    expect(headings).toHaveLength(2);
    expect(headingOfPlace(state, blocks, place.span, "A"), "il primo «A», quello dello span").toBe(headings[0]![1]);
    const tre = indexAt(state, "tre");
    const [target] = placeTargets(state, blocks, { first: tre, last: tre }, [place]);
    const moved = state.update(target!.drop(state, blocks, { first: tre, last: tre })!).state;
    // Il posto si legge sul testo del documento: gli a capo del pezzo spostato
    // in una nota CRLF sono di `moveSiblings` (move.ts), non di questo modulo.
    expect(moved.doc.toString().endsWith("## A\n\nuno\n\ntre\n\n## A\n\ndue\n\n## B")).toBe(true);
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

describe("le note del cassetto (E13)", () => {
  const note = (title: string, rect = { left: 0, top: 300, right: 240, bottom: 328 }): SurfaceNoteOffer =>
    ({ kind: "note", document: { documentId: `${title}.md`, vault: undefined }, title, rect, hover: vi.fn() });

  it("una nota per riga, «Sposta in «…»»; il rilascio non tocca il documento, lo dice `note`", () => {
    const state = stateOf(DOC);
    const uno = indexAt(state, "Uno");
    const progetto = note("Progetto");
    const targets = noteTargets([progetto, note("Nascosta", { left: 0, top: 0, right: 0, bottom: 0 }), offer(DOC, "## Fine", "Fine")]);
    expect(targets.map((target) => target.label), "la riga che non si vede e il titolo della Struttura no").toEqual(["Sposta in «Progetto»"]);
    expect(targets[0]!.note).toEqual({ document: { documentId: "Progetto.md", vault: undefined }, title: "Progetto" });
    expect(targets[0]!.drop(state, blocksOf(state), { first: uno, last: uno })).toBeNull();
    targets[0]!.hover(true);
    expect(progetto.hover).toHaveBeenCalledWith(true);
    expect(placeTargets(state, blocksOf(state), { first: uno, last: uno }, [progetto]), "una nota non è un posto della Struttura").toEqual([]);
  });

  it("i byte del blocco sono quelli del file: i `\\r` e i caratteri di più byte contano", () => {
    const disk = "Città\r\n\r\n- uno\r\n  - figlio\r\n\r\nFine";
    const state = EditorState.create({ doc: disk, extensions: [EditorState.lineSeparator.of("\r\n"), markdown({ base: markdownGrammar }), blockModel] });
    ensureSyntaxTree(state, state.doc.length, 5000);
    const blocks = blocksOf(state);
    const item = blocks.findIndex((block) => block.depth === 0 && state.sliceDoc(block.from, block.to).startsWith("- uno"));
    const { at, text } = blockBytes(state, blocks, { first: item, last: item });
    expect(text).toBe("- uno\r\n  - figlio");
    expect(at).toEqual([bytes("Città\r\n\r\n"), bytes("Città\r\n\r\n- uno\r\n  - figlio")]);
  });
});
