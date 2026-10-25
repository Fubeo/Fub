// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { Fragment, Slice, type Node as PmNode } from "prosemirror-model";
import { EditorState, NodeSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import type { EditorChange } from "../core/text-operation";
import { backspace, splitParagraph } from "./commands";
import { RichEngine } from "./engine";
import { parseProjection, type Block, type Projection } from "./projection";
import { extractSegments, replaceChecked } from "./proof";
import { richSchema, toDoc } from "./schema";
import { t } from "../../i18n/strings";
import { safeHref } from "./paste";

let engines: RichEngine[] = [];
afterEach(() => {
  for (const engine of engines) engine.destroy();
  engines = [];
  document.body.replaceChildren();
});

function source(blocks: readonly Block[], head: Partial<Projection> = {}): string {
  return JSON.stringify({ format: "fub-rich", version: 1, ...head, blocks });
}

const para = (x: string, extra: Record<string, unknown> = {}): Block =>
  ({ t: "para", role: { kind: "body" }, k: "P", c: [{ t: "text", x, k: "R" }], ...extra }) as Block;

function engine(text: string, changes: EditorChange[] = []): RichEngine {
  const parent = document.createElement("div");
  document.body.append(parent);
  const made = new RichEngine(parent, { label: () => "documento", onChange: (c) => changes.push(c), onSelectionChange: () => {} });
  made.setDoc(text);
  engines.push(made);
  return made;
}

function at(doc: PmNode, needle: string, offset = 0): number {
  let found = -1;
  doc.descendants((node, pos) => {
    if (found < 0 && node.isText && node.text!.includes(needle)) found = pos + node.text!.indexOf(needle) + offset;
    return found < 0;
  });
  if (found < 0) throw new Error(`${needle} non c'è`);
  return found;
}

const blocksOf = (e: RichEngine) => parseProjection(e.getDoc()).blocks;

describe("il motore ricco", () => {
  it("un testo che non si legge non si scrive, e non diventa un documento vuoto salvabile", () => {
    const changes: EditorChange[] = [];
    const e = engine("{non è una proiezione", changes);
    expect(e.intake().kind).toBe("invalid");
    expect(e.editable()).toBe(false);
    expect(e.getDoc()).toBe("{non è una proiezione");
    expect(e.run("markdown.bold")).toBe(false);
    expect(changes).toEqual([]);
  });

  it("un oggetto si annuncia per specie e testo alternativo, e il segnaposto dice che cosa è", () => {
    engine(
      source([
        {
          t: "para",
          role: { kind: "body" },
          k: "P",
          c: [
            { t: "atom", k: "I", kind: "image", label: "Un pino" },
            { t: "atom", k: "N", kind: "note" },
            { t: "atom", k: "M", kind: "marker" },
          ],
        } as Block,
      ]),
    );
    const [image, note, marker] = [...document.body.querySelectorAll<HTMLElement>(".rich-atom")];
    expect(image.getAttribute("role")).toBe("img");
    expect(image.getAttribute("aria-label")).toMatch(/: Un pino$/);
    expect(image.textContent).toBe(`▣${t("rich.atom.image")}`);
    expect(image.title).toBe(`${image.getAttribute("aria-label")}. ${t("rich.atom.kept")}`);
    expect(note.getAttribute("aria-label")).not.toBe("");
    expect(note.getAttribute("aria-label")).not.toContain(":");
    // Il richiamo è il suo numero, scritto dal tema (`notes.ts`).
    expect(note.textContent).toBe("");
    expect(note.dataset.number).toBe("1");
    expect(marker.hasAttribute("role")).toBe(false);
    expect(marker.textContent).toBe("");
  });

  it("i segnaposto dicono specie e misura: un'immagine, una forma, una casella di testo, una formula", () => {
    engine(
      source([
        {
          t: "para",
          role: { kind: "body" },
          k: "P",
          c: [
            { t: "atom", k: "I", kind: "image", label: "Il cortile", w: 113.4, h: 85.05 },
            { t: "atom", k: "S", kind: "shape", w: 72, h: 36 },
            { t: "atom", k: "B", kind: "text_box", w: 72, h: 36 },
            { t: "atom", k: "E", kind: "equation", label: "a+b" },
          ],
        } as Block,
      ]),
    );
    const said = [...document.body.querySelectorAll<HTMLElement>(".rich-atom-name")].map((el) => el.textContent);
    expect(said).toEqual([
      `${t("rich.atom.image")} · 4 × 3 cm`,
      `${t("rich.atom.shape")} · 2,5 × 1,3 cm`,
      `${t("rich.atom.text_box")} · 2,5 × 1,3 cm`,
      `${t("rich.atom.equation")} a+b`,
    ]);
    for (const atom of document.body.querySelectorAll<HTMLElement>(".rich-atom")) expect(atom.title).toContain(t("rich.atom.kept"));
  });

  it("una proiezione in sola lettura non si scrive", () => {
    const e = engine(source([para("ciao")], { readonly: "revisions" }));
    expect(e.intake()).toEqual({ kind: "ok", readonly: "revisions" });
    expect(e.editable()).toBe(false);
    expect(e.actionState("markdown.bold")).toEqual({ enabled: false, active: null });
  });

  it("la sola lettura della shell spegne e riaccende la scrittura", () => {
    const e = engine(source([para("ciao")]));
    e.setReadOnly(true);
    expect(e.editable()).toBe(false);
    e.setReadOnly(false);
    expect(e.editable()).toBe(true);
  });

  it("una battuta è un input, l'annullamento un undo e il ripristino un redo", () => {
    const changes: EditorChange[] = [];
    const e = engine(source([para("ciao")]), changes);
    e.dispatch(e.state.tr.insertText("!", at(e.state.doc, "ciao", 4)));
    expect(blocksOf(e)).toEqual([para("ciao!")]);
    expect(e.run("text.undo")).toBe(true);
    expect(blocksOf(e)).toEqual([para("ciao")]);
    expect(e.run("text.redo")).toBe(true);
    expect(changes.map((c) => c.origin)).toEqual(["input", "undo", "redo"]);
    // L'operazione porta dal testo di prima a quello dopo.
    expect(changes[0].text).toBe(e.getDoc());
  });

  it("ciò che arriva da fuori non entra nella cronologia e non torna come modifica", () => {
    const changes: EditorChange[] = [];
    const e = engine(source([para("uno"), para("due")]), changes);
    e.dispatch(e.state.tr.insertText("1", at(e.state.doc, "uno", 3)));
    const remote = source([para("uno1"), para("due, da un altro riquadro")]);
    e.syncDoc(remote);
    expect(e.getDoc()).toBe(remote);
    expect(changes).toHaveLength(1);
    // L'annullamento toglie la battuta locale, non il testo arrivato.
    e.run("text.undo");
    expect(blocksOf(e)).toEqual([para("uno"), para("due, da un altro riquadro")]);
  });

  it("a capo divide il paragrafo con le sue proprietà, e la sezione resta dopo la seconda metà", () => {
    const e = engine(source([para("primaseconda", { sect: "S" }), para("dopo")]));
    e.select(at(e.state.doc, "seconda"));
    expect(splitParagraph(e.state, (tr) => e.dispatch(tr))).toBe(true);
    const blocks = blocksOf(e);
    expect(blocks.map((b) => (b.t === "para" ? [b.k, b.sect, b.c?.map((i) => (i.t === "text" ? i.x : ""))] : null))).toEqual([
      ["P", undefined, ["prima"]],
      ["P", "S", ["seconda"]],
      ["P", undefined, ["dopo"]],
    ]);
  });

  it("in fondo a un titolo a capo dà testo normale; una voce vuota esce dall'elenco", () => {
    const heading = { t: "para", role: { kind: "heading", level: 1 }, k: "H", c: [{ t: "text", x: "Titolo", k: "R" }] } as Block;
    const e = engine(source([heading]));
    e.select(at(e.state.doc, "Titolo", 6));
    splitParagraph(e.state, (tr) => e.dispatch(tr));
    expect(blocksOf(e).map((b) => (b.t === "para" ? b.role : null))).toEqual([
      { kind: "heading", level: 1 },
      { kind: "body" },
    ]);

    const empty = { t: "para", role: { kind: "list", ordered: false, level: 0 }, k: "L" } as Block;
    const l = engine(source([empty]));
    l.select(1);
    splitParagraph(l.state, (tr) => l.dispatch(tr));
    expect(blocksOf(l)).toEqual([{ t: "para", role: { kind: "body" }, k: "L" }]);
  });

  it("il Backspace dopo una sezione la seleziona invece di toglierla", () => {
    const e = engine(source([para("prima", { sect: "S" }), para("dopo")]));
    e.select(at(e.state.doc, "dopo"));
    backspace(e.state, (tr) => e.dispatch(tr));
    expect(e.state.selection).toBeInstanceOf(NodeSelection);
    expect((e.state.selection as NodeSelection).node.type).toBe(richSchema.nodes.section);
    expect(blocksOf(e)[0]).toMatchObject({ sect: "S" });
  });

  it("le azioni della barra dicono stato e applicabilità", () => {
    const e = engine(source([para("parola")]));
    const from = at(e.state.doc, "parola");
    e.select(from, from + 6);
    expect(e.actionState("markdown.bold")).toEqual({ enabled: true, active: false });
    e.run("markdown.bold");
    expect(e.actionState("markdown.bold")).toEqual({ enabled: true, active: true });
    expect(e.actionState("markdown.table.row.after").enabled).toBe(false);
    expect(e.actionState("markdown.list.indent").enabled).toBe(false);
    e.run("markdown.list.bullet");
    expect(blocksOf(e)[0]).toMatchObject({ role: { kind: "list", ordered: false, level: 0 } });
    e.run("markdown.list.indent");
    expect(blocksOf(e)[0]).toMatchObject({ role: { kind: "list", ordered: false, level: 1 } });
  });

  it("la tabella non perde i k delle righe che ProseMirror crea riparandola", () => {
    const table = {
      t: "table",
      k: "T",
      rows: [
        { k: "R1", cells: [{ k: "C1", blocks: [para("a")] }, { k: "C2", blocks: [para("b")] }] },
        { k: "R2", cells: [{ k: "C3", blocks: [para("c")] }, { k: "C4", blocks: [para("d")] }] },
      ],
    } as Block;
    const e = engine(source([table]));
    const { row, cell } = richSchema.nodes;
    const bare = row.create(null, [cell.create(null, richSchema.nodes.para.create()), cell.create(null, richSchema.nodes.para.create())]);
    const end = at(e.state.doc, "d", 1) + 3;
    e.dispatch(e.state.tr.insert(end, bare));
    const rows = (blocksOf(e)[0] as Extract<Block, { t: "table" }>).rows;
    expect(rows.map((r) => [r.k, r.cells.map((c) => c.k)])).toEqual([
      ["R1", ["C1", "C2"]],
      ["R2", ["C3", "C4"]],
      ["R2", ["C3", "C4"]],
    ]);
  });
});

describe("ciò che si incolla", () => {
  it("perde i k che il documento non ha e i collegamenti che non vanno sul web", () => {
    const e = engine(source([para("qui")]));
    const { para: p } = richSchema.nodes;
    const foreign = richSchema.marks.run.create({ k: "ALTRO" });
    const evil = richSchema.marks.link.create({ href: "javascript:alert(1)" });
    const web = richSchema.marks.link.create({ href: "https://fub.app" });
    const pasted = p.create({ role: { kind: "body" }, k: "ESTRANEO" }, [
      richSchema.text("uno ", [foreign]),
      richSchema.text("due ", [evil]),
      richSchema.text("tre", [web]),
    ]);
    e.select(at(e.state.doc, "qui", 3));
    e.paste(new Slice(Fragment.from([p.create(), pasted]), 1, 0));
    const blocks = blocksOf(e);
    expect(blocks[blocks.length - 1]).toEqual({
      t: "para",
      role: { kind: "body" },
      c: [{ t: "text", x: "uno due " }, { t: "text", x: "tre", href: "https://fub.app" }],
    });
  });

  it("non duplica una nota copiata, e un'immagine estranea cade", () => {
    const note = { t: "atom", k: "N", kind: "note" };
    const image = { t: "atom", k: "I", kind: "image" };
    const e = engine(source([{ t: "para", role: { kind: "body" }, k: "P", c: [{ t: "text", x: "testo", k: "R" }, note, image] } as Block]));
    const { atom } = richSchema.nodes;
    e.select(at(e.state.doc, "testo"));
    e.paste(
      new Slice(
        Fragment.from([atom.create({ k: "N", kind: "note" }), atom.create({ k: "I", kind: "image" }), atom.create({ k: "X", kind: "image" })]),
        0,
        0,
      ),
    );
    const c = (blocksOf(e)[0] as Extract<Block, { t: "para" }>).c!;
    expect(c.filter((i) => i.t === "atom").map((i) => i.k)).toEqual(["I", "N", "I"]);
  });

  it("riconosce gli indirizzi sicuri", () => {
    expect(["https://a.b", "http://a.b", "mailto:x@y.z", "#segno"].every(safeHref)).toBe(true);
    expect(["javascript:alert(1)", "file:///etc/passwd", "data:text/html,x", "relativo"].some(safeHref)).toBe(false);
  });
});

describe("la prosa per il correttore", () => {
  it("un segmento per paragrafo: gli oggetti sono segnaposto, i segni spariscono, gli a-capo separano", () => {
    const e = engine(
      source([
        {
          t: "para",
          role: { kind: "body" },
          c: [
            { t: "text", x: "pa" },
            { t: "atom", k: "M", kind: "marker" },
            { t: "text", x: "rola" },
            { t: "atom", k: "F", kind: "field", label: "3" },
            { t: "text", x: "riga\naltra" },
          ],
        } as Block,
        para("1234"),
        para("ultima"),
      ]),
    );
    const segments = extractSegments(e.state.doc);
    expect(segments).toHaveLength(2);
    expect(segments[0].text).toBe("parola￼riga\naltra");
    expect(segments[1].text).toBe("ultima");
    // Il testo verbatim torna alle sue posizioni nel documento.
    const piece = segments[1].pieces[0];
    expect(e.state.doc.textBetween(piece.docFrom, piece.docTo)).toBe("ultima");
  });

  it("una correzione scrive soltanto se il testo è ancora quello del rilievo", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const doc = toDoc(parseProjection(source([para("un errrore qui")])));
    const view = new EditorView(parent, { state: EditorState.create({ schema: richSchema, doc }) });
    try {
      const from = at(view.state.doc, "errrore");
      expect(replaceChecked(view, from, from + 7, "errrore", "errore")).toBe(true);
      expect(view.state.doc.textContent).toBe("un errore qui");
      // Il menu era stato aperto su un testo che nel frattempo è cambiato.
      expect(replaceChecked(view, from, from + 7, "errrore", "errore")).toBe(false);
      expect(view.state.doc.textContent).toBe("un errore qui");
    } finally {
      view.destroy();
    }
  });
});
