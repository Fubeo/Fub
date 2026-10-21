// @vitest-environment happy-dom
//
// I blocchi chiusi e il documento che si scrive soltanto nel corpo: ciò che il
// formato rifiuterebbe al salvataggio non entra nemmeno nel buffer, e il resto
// si scrive come sempre. La proiezione è quella del codec
// (`__fixtures__/rich-closed.json`): un paragrafo aperto, uno chiuso, una
// tabella chiusa e un altro paragrafo aperto.
import { afterEach, describe, expect, it } from "vitest";
import type { Node as PmNode } from "prosemirror-model";
import { TextSelection } from "prosemirror-state";
import closedFixture from "../../__fixtures__/rich-closed.json";
import type { EditorChange } from "../core/text-operation";
import { insertBreak, insertNote } from "./commands";
import { addComment } from "./comments";
import { keepsOutside, listKinds, outsideOf } from "./closed";
import { mountStrip, RichEngine } from "./engine";
import { parseProjection } from "./projection";
import { richSchema } from "./schema";
import { setTracking } from "./track";
import { t } from "../../i18n/strings";

const CLOSED = closedFixture.source;

let engines: RichEngine[] = [];
afterEach(() => {
  for (const engine of engines) engine.destroy();
  engines = [];
  document.body.replaceChildren();
});

function engine(source = CLOSED): { e: RichEngine; changes: EditorChange[] } {
  const parent = document.createElement("div");
  document.body.append(parent);
  const changes: EditorChange[] = [];
  const e = new RichEngine(parent, { label: () => "documento", onChange: (c) => changes.push(c), onSelectionChange: () => {} });
  engines.push(e);
  e.setDoc(source);
  return { e, changes };
}

/// La posizione dentro il testo `needle` del blocco `block`, con `offset`
/// caratteri di scarto.
function inside(doc: PmNode, block: number, needle: string, offset = 0): number {
  let found = -1;
  const start = doc.resolve(0).posAtIndex(block);
  doc.child(block).descendants((node, pos) => {
    if (found < 0 && node.isText && node.text!.includes(needle)) found = start + 1 + pos + node.text!.indexOf(needle) + offset;
    return found < 0;
  });
  if (found < 0) throw new Error(`${needle} non c'è nel blocco ${block}`);
  return found;
}

describe("un blocco chiuso", () => {
  it("si mostra segnato, con il perché", () => {
    const { e } = engine();
    expect(e.hasClosed()).toBe(true);
    expect(e.bodyOnly()).toBe(true);
    const marked = document.querySelectorAll(".rich-locked");
    expect([...marked].map((el) => el.tagName)).toEqual(["P", "TABLE"]);
    expect(marked[0]!.getAttribute("title")).toBe(t("rich.locked"));
  });

  it("non si scrive, e un blocco aperto sì", () => {
    const { e, changes } = engine();
    e.select(inside(e.state.doc, 1, "chiuso", 2));
    e.dispatch(e.state.tr.insertText("x"));
    expect(changes).toEqual([]);
    expect(e.getDoc()).toBe(CLOSED);
    expect(e.state.doc.child(1).textContent).toBe("chiuso");
    // Né la cella della tabella chiusa.
    e.select(inside(e.state.doc, 2, "chiuso", 1));
    e.dispatch(e.state.tr.insertText("x"));
    expect(changes).toEqual([]);

    e.select(inside(e.state.doc, 0, "Aperto", 6));
    e.dispatch(e.state.tr.insertText("!"));
    expect(changes).toHaveLength(1);
    const written = parseProjection(changes[0]!.text);
    expect(written.blocks.map((block) => block.locked === true)).toEqual([false, true, true, false]);
  });

  it("non si cancella con una selezione che lo attraversa, né con un'azione", () => {
    const { e, changes } = engine();
    const doc = e.state.doc;
    e.dispatch(e.state.tr.setSelection(TextSelection.create(doc, inside(doc, 0, "Aperto", 2), inside(doc, 3, "Ancora", 2))));
    e.dispatch(e.state.tr.deleteSelection());
    expect(changes).toEqual([]);
    expect(e.state.doc.childCount).toBe(4);
    // Il grassetto si offre dove il testo si scrive, non dentro il blocco chiuso.
    e.select(inside(e.state.doc, 1, "chiuso"), inside(e.state.doc, 1, "chiuso", 3));
    expect(e.actionState("markdown.bold").enabled).toBe(false);
    expect(e.run("markdown.bold")).toBe(false);
    expect(e.allows(insertBreak("\n"))).toBe(false);
    e.select(inside(e.state.doc, 0, "Aperto"), inside(e.state.doc, 0, "Aperto", 3));
    expect(e.actionState("markdown.bold").enabled).toBe(true);
    expect(e.run("markdown.bold")).toBe(true);
    expect(changes).toHaveLength(1);
  });

  it("si sposta intero, nell'ordine degli altri blocchi chiusi", () => {
    const { e, changes } = engine();
    const doc = e.state.doc;
    const move = (from: number, to: number) => {
      const block = e.state.doc.child(from);
      const at = e.state.doc.resolve(0).posAtIndex(from);
      const tr = e.state.tr.delete(at, at + block.nodeSize);
      tr.insert(tr.doc.resolve(0).posAtIndex(to), block);
      e.dispatch(tr);
    };
    // La tabella in fondo: i chiusi restano paragrafo e tabella.
    move(2, 3);
    expect(changes).toHaveLength(1);
    const written = parseProjection(changes[0]!.text);
    expect(written.blocks.map((b) => b.locked === true)).toEqual([false, true, false, true]);
    // Il paragrafo chiuso dopo la tabella scambierebbe i due: il formato non
    // li ritroverebbe.
    move(1, 3);
    expect(changes).toHaveLength(1);
    expect(e.state.doc.child(1).eq(doc.child(1))).toBe(true);
  });

  it("arrivato da un altro riquadro o dal disco entra com'è", () => {
    const { e, changes } = engine();
    const other = CLOSED.replace(`"x":"chiuso","k":"eyJsYW5nIjoiaXQtSVQifQ"}]},{"t":"table"`, `"x":"riaperto","k":"eyJsYW5nIjoiaXQtSVQifQ"}]},{"t":"table"`);
    expect(other).not.toBe(CLOSED);
    e.syncDoc(other);
    expect(e.state.doc.child(1).textContent).toBe("riaperto");
    expect(changes).toEqual([]);
    // E da lì la regola vale per il blocco nuovo.
    e.select(inside(e.state.doc, 1, "riaperto", 2));
    e.dispatch(e.state.tr.insertText("x"));
    expect(changes).toEqual([]);
  });
});

describe("un documento che si scrive soltanto nel corpo", () => {
  it("non cambia commenti, note, registrazione, pagina né elenchi nuovi", () => {
    const { e, changes } = engine();
    const doc = e.state.doc;
    e.select(inside(doc, 0, "Aperto"), inside(doc, 0, "Aperto", 3));
    expect(e.apply(addComment("Un commento.", "Ada"))).toBe(false);
    expect(e.allows(insertNote("Una nota.", false))).toBe(false);
    expect(e.apply(insertNote("Una nota.", false))).toBe(false);
    expect(e.allows(setTracking(true))).toBe(false);
    expect(e.run("markdown.list.bullet")).toBe(false);
    expect(e.actionState("markdown.list.ordered").enabled).toBe(false);
    expect(changes).toEqual([]);
    // Il resto del corpo sì: un titolo, un a capo.
    expect(e.run("markdown.heading.2")).toBe(true);
    expect(e.allows(insertBreak("\n"))).toBe(true);
    expect(changes).toHaveLength(1);
  });

  it("spegne nella striscia ciò che sta fuori dal corpo", () => {
    const { e } = engine();
    e.select(inside(e.state.doc, 0, "Aperto"), inside(e.state.doc, 0, "Aperto", 3));
    const strip = mountStrip(e, () => null, { review: true, pickImage: async () => null });
    const named = (key: Parameters<typeof t>[0]) =>
      [...strip.element.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.getAttribute("aria-label") === t(key))!;
    for (const key of ["rich.page", "rich.hf", "rich.note", "rich.track"] as const) expect(named(key).disabled, key).toBe(true);
    for (const key of ["rich.table", "rich.image"] as const) expect(named(key).disabled, key).toBe(false);
    // Dentro il blocco chiuso non entra niente; una tabella va dopo, e lo lascia.
    e.select(inside(e.state.doc, 1, "chiuso", 2));
    strip.refresh();
    for (const key of ["rich.image", "rich.break.page"] as const) expect(named(key).disabled, key).toBe(true);
    expect(named("rich.table").disabled).toBe(false);
    strip.destroy();
  });

  it("dice perché nella superficie", async () => {
    const { mountRichSurface, RICH_PROFILE } = await import("./surface");
    const engineModule = await import("./engine");
    const parent = document.createElement("div");
    document.body.append(parent);
    const surface = mountRichSurface(
      RICH_PROFILE,
      { paneId: "pane", documentId: "lettera.docx", parent, formatId: "docx" },
      { onChange: () => {}, onSelectionChange: () => {}, loadEngine: () => Promise.resolve(engineModule) },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    surface.buffer!.setDoc(CLOSED);
    const notice = parent.querySelector<HTMLElement>(".rich-notice")!;
    expect(notice.textContent).toBe(t("rich.locked.notice"));
    expect(surface.editorActions!.editable()).toBe(true);
    // Senza blocchi chiusi, il perché è quello di ciò che sta fuori.
    surface.buffer!.setDoc(CLOSED.replaceAll(`"locked":true,`, ""));
    expect(notice.textContent).toBe(t("rich.body_only.notice"));
    surface.destroy();
  });
});

describe("ciò che sta fuori dal corpo", () => {
  const para = (text: string, attrs: Record<string, unknown> = {}) => richSchema.nodes.para.create(attrs, text ? richSchema.text(text) : null);
  const note = (k: string | null) => richSchema.nodes.atom.create({ kind: "note", k, note: k === null ? "nuova" : null });
  const doc = (...blocks: PmNode[]) => richSchema.nodes.doc.create(null, blocks);

  it("conta quali note ci sono, non dove", () => {
    const a = doc(richSchema.nodes.para.create(null, [richSchema.text("uno"), note("N1")]), para("due"));
    const moved = doc(para("uno"), richSchema.nodes.para.create(null, [richSchema.text("due"), note("N1")]));
    const lost = doc(para("uno"), para("due"));
    const added = doc(richSchema.nodes.para.create(null, [richSchema.text("uno"), note("N1"), note(null)]), para("due"));
    expect(outsideOf(moved)).toBe(outsideOf(a));
    expect(keepsOutside(a, moved)).toBe(true);
    expect(keepsOutside(a, lost)).toBe(false);
    expect(keepsOutside(a, added)).toBe(false);
  });

  it("lascia gli elenchi della specie che il documento ha", () => {
    const bullet = { kind: "list", ordered: false, level: 0 };
    const a = doc(para("uno", { role: bullet }), para("due"));
    expect([...listKinds(a)]).toEqual([false]);
    expect(keepsOutside(a, doc(para("uno", { role: bullet }), para("due", { role: { ...bullet, level: 1 } })))).toBe(true);
    expect(keepsOutside(a, doc(para("uno"), para("due")))).toBe(true);
    expect(keepsOutside(a, doc(para("uno", { role: bullet }), para("due", { role: { ...bullet, ordered: true } })))).toBe(false);
  });
});
