// @vitest-environment happy-dom
//
// La proiezione vera, nei due versi (`crates/fub-format-rich/tests/ts_projection.rs`):
// quella che il codec dà di un `.docx` si legge e si riscrive identica, e le
// modifiche fatte con i comandi della superficie danno la proiezione che il
// codec salva. Questa seconda è uno snapshot su file di questo test: si
// rigenera con `npx vitest run src/editors/rich/fixture.test.ts -u`.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Node as PmNode } from "prosemirror-model";
import { TextSelection } from "prosemirror-state";
import projectionFixture from "../../__fixtures__/rich-projection.json";
import type { EditorChange } from "../core/text-operation";
import { RichEngine } from "./engine";
import { parseProjection, writeProjection } from "./projection";
import { insertImage, insertNote, insertTable, setColor, setFont, setHighlight, setLayout, setLink, setSize, setStyle } from "./commands";
import { addComment, replyComment, resolveComment } from "./comments";
import { BlockWriter, toDoc } from "./schema";
import { setColumns, setLandscape, setMargins } from "./page";
import { setReviewAuthor, setTracking } from "./track";

const SOURCE = projectionFixture.source;

let engines: RichEngine[] = [];
afterEach(() => {
  for (const engine of engines) engine.destroy();
  engines = [];
  document.body.replaceChildren();
});

function engine(changes: EditorChange[] = []): RichEngine {
  const parent = document.createElement("div");
  document.body.append(parent);
  const made = new RichEngine(parent, { label: () => "documento", onChange: (c) => changes.push(c), onSelectionChange: () => {} });
  engines.push(made);
  return made;
}

/// La posizione dentro il testo `needle`, con `offset` caratteri di scarto.
function find(doc: PmNode, needle: string, offset = 0): number {
  let found = -1;
  doc.descendants((node, pos) => {
    if (found >= 0) return false;
    if (node.isText && node.text!.includes(needle)) found = pos + node.text!.indexOf(needle) + offset;
    return true;
  });
  if (found < 0) throw new Error(`${needle} non c'è`);
  return found;
}

/// Un PNG di un pixel, in base64: quello dell'esempio comune di Rust.
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";

describe("la proiezione del codec", () => {
  it("si legge e si riscrive identica", () => {
    const projection = parseProjection(SOURCE);
    expect(writeProjection(projection)).toBe(SOURCE);
  });

  it("passa dal documento ProseMirror e torna identica", () => {
    const projection = parseProjection(SOURCE);
    const blocks = new BlockWriter().write(toDoc(projection));
    expect(writeProjection(projection, blocks)).toBe(SOURCE);
  });

  it("aperta nella superficie non cambia finché nessuno scrive", () => {
    const changes: EditorChange[] = [];
    const e = engine(changes);
    e.setDoc(SOURCE);
    e.select(find(e.state.doc, "Fine."));
    expect(e.getDoc()).toBe(SOURCE);
    expect(changes).toEqual([]);
    expect(e.intake()).toEqual({ kind: "ok", readonly: null });
  });

  it("modificata con i comandi della superficie dà la proiezione che il codec salva", async () => {
    const changes: EditorChange[] = [];
    const e = engine(changes);
    e.setDoc(SOURCE);
    // Si scrive in fondo al secondo paragrafo.
    const end = find(e.state.doc, "link") + "link".length + 1;
    e.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, end)).insertText(" Scritto dalla shell."));
    // Grassetto su «Figura».
    const figure = find(e.state.doc, "Figura");
    e.select(figure, figure + "Figura".length);
    expect(e.run("markdown.bold")).toBe(true);
    // L'aspetto di «dalla shell»: carattere, dimensione, colori, maiuscoletto.
    const shell = find(e.state.doc, "dalla shell");
    e.select(shell, shell + "dalla shell".length);
    expect(e.apply(setFont("Courier New"))).toBe(true);
    expect(e.apply(setSize(18))).toBe(true);
    expect(e.apply(setColor("#c00000"))).toBe(true);
    expect(e.apply(setHighlight("#00ffff"))).toBe(true);
    expect(e.run("rich.small_caps")).toBe(true);
    expect(e.look()).toEqual({ font: "Courier New", size: 18, color: "#c00000", hl: "#00ffff" });
    // Una riga dopo la prima della tabella.
    e.select(find(e.state.doc, "cella 00"));
    expect(e.run("markdown.table.row.after")).toBe(true);
    // E una colonna a destra della prima.
    e.select(find(e.state.doc, "cella 00"));
    expect(e.run("markdown.table.column.after")).toBe(true);
    // Il paragrafo della sezione: centrato, rientrato, interlinea 1,5 e
    // spazio prima; la prosa torna alla prima riga dello stile.
    e.select(find(e.state.doc, "Fine della prima sezione"));
    expect(e.run("rich.align.center")).toBe(true);
    expect(e.run("rich.indent.increase")).toBe(true);
    expect(e.run("rich.line.1.5")).toBe(true);
    expect(e.apply(setLayout({ before: 6 }))).toBe(true);
    e.select(find(e.state.doc, "Una prosa"));
    expect(e.apply(setLayout({ first: null }))).toBe(true);
    // Il salto pagina sta in un paragrafo con lo stile Sottotitolo.
    e.select(find(e.state.doc, "dopo il salto"));
    const subtitle = e.styles().find((style) => style.id === "Subtitle")!;
    expect(e.apply(setStyle({ s: subtitle.id, f: subtitle.f }, e.documentLook()))).toBe(true);
    // Il link della prosa cambia indirizzo; «Prima» diventa un link.
    e.select(find(e.state.doc, "link") + 1);
    expect(e.apply(setLink("https://fub.app/nuovo"))).toBe(true);
    const before = find(e.state.doc, "Prima");
    e.select(before, before + "Prima".length);
    expect(e.apply(setLink("https://fub.app/prima"))).toBe(true);
    // Una tabella nuova 2 × 3 dopo il paragrafo del salto, con una parola
    // nella prima cella.
    e.select(find(e.state.doc, "dopo il salto"));
    expect(e.apply(insertTable(2, 3))).toBe(true);
    expect(e.apply((state, dispatch) => (dispatch?.(state.tr.insertText("nuova")), true))).toBe(true);
    // La cella della parola si unisce con quella accanto: chiusi paragrafo e
    // cella, aperti cella e paragrafo, quattro posizioni più avanti.
    e.select(e.state.selection.from, e.state.selection.from + 4);
    expect(e.run("rich.table.merge")).toBe(true);
    // Un'immagine nuova e due note nuove in fondo al paragrafo del salto.
    e.select(find(e.state.doc, "dopo il salto") + "dopo il salto".length);
    expect(e.apply(insertImage(PNG, 72, 36))).toBe(true);
    expect(e.apply(insertNote("Una nota della shell.", false))).toBe(true);
    expect(e.apply(insertNote("In chiusura.", true))).toBe(true);
    // Le revisioni: si accetta l'inserimento, poi l'eliminazione che segue.
    e.select(find(e.state.doc, "Revisione: ", "Revisione: n".length));
    expect(e.run("rich.rev.accept")).toBe(true);
    expect(e.state.doc.textBetween(e.state.selection.from, e.state.selection.to)).toBe("vecchia");
    expect(e.run("rich.rev.accept")).toBe(true);
    // I commenti: una risposta al commento su «questo passo», che poi si
    // risolve con la risposta di prima; un commento nuovo su «Fine».
    const at = "2026-10-18T13:00:00Z";
    expect(e.apply(replyComment(1, "Risposta\ndella shell.", "Bea", at))).toBe(true);
    expect(e.apply(resolveComment(1, true))).toBe(true);
    // L'ultimo paragrafo diventa un titolo.
    const last = find(e.state.doc, "Fine.");
    e.select(last);
    expect(e.run("markdown.heading.2")).toBe(true);
    e.select(last, last + "Fine".length);
    expect(e.apply(addComment("Un commento nuovo.", "Bea", at))).toBe(true);
    // La prima sezione si gira con due colonne; l'ultima stringe i margini.
    e.select(find(e.state.doc, "Fine della prima sezione"));
    expect(e.apply(setLandscape(true))).toBe(true);
    expect(e.apply(setColumns(2))).toBe(true);
    e.select(last);
    expect(e.apply(setMargins({ top: 36, bottom: 36, left: 36, right: 36 }))).toBe(true);
    // Registra le modifiche: ciò che Bea scrive in fondo alla sezione è un
    // suo inserimento, con l'ora fissa del test.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(at));
    setReviewAuthor("Bea");
    expect(e.apply(setTracking(true))).toBe(true);
    e.select(find(e.state.doc, "Fine della prima sezione") + "Fine della prima sezione".length);
    e.dispatch(e.state.tr.insertText(" rivista"));
    setReviewAuthor("");
    vi.useRealTimers();

    const edited = e.getDoc();
    expect(changes[changes.length - 1]?.text).toBe(edited);
    expect(changes.every((change) => change.origin === "input")).toBe(true);
    // La forma resta quella della proiezione.
    expect(writeProjection(parseProjection(edited))).toBe(edited);

    // Con la proiezione di partenza: rigenerata quella, questa è stantia, e
    // lo snapshot lo dice.
    await expect(`${JSON.stringify({ base: SOURCE, source: edited }, null, 2)}\n`).toMatchFileSnapshot(
      "../../__fixtures__/rich-edited.json",
    );
  });
});
