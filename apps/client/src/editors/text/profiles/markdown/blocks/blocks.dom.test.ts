// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { history } from "@codemirror/commands";
import { EditorSelection, EditorState, Prec } from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { type Extension } from "@codemirror/state";
import { vim } from "@replit/codemirror-vim";
import { markdownGrammar } from "../grammar";
import { livePreview } from "../livepreview";
import { liveReveal } from "../../../live-reveal";
import { blockIdMarks } from "../block-id";
import { blocksMode } from "./index";
import { blockSelection } from "./selection";
import { addBelow, colorRanges, gripLabel } from "./handles";
import { setContentColor } from "../color";
import { blockModel } from "./model";

// I Blocchi nell'editor vero: maniglie, menu, selezione di blocchi, tasti.

const views: EditorView[] = [];
afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  document.body.replaceChildren();
});

function mount(doc: string, anchor = 0, notify = vi.fn(), extra: Extension = []): EditorView {
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      selection: { anchor },
      extensions: [
        history(),
        markdown({ base: markdownGrammar }),
        livePreview({ openWikilink() {}, searchTag() {} }),
        Prec.highest(liveReveal.of("mai")),
        blockIdMarks,
        blocksMode({ page: () => "Nota", notify }),
        extra,
      ],
    }),
  });
  ensureSyntaxTree(view.state, view.state.doc.length, 1000);
  view.dispatch({});
  views.push(view);
  return view;
}

const press = (view: EditorView, key: string, extra: KeyboardEventInit = {}) =>
  runScopeHandlers(view, new KeyboardEvent("keydown", { key, ...extra }), "editor");

describe("la selezione di blocchi", () => {
  it("Esc seleziona il blocco, Shift-↓ allarga, e lo dice", () => {
    const view = mount("Uno\n\nDue\n\nTre", 1);
    expect(press(view, "Escape")).toBe(true);
    expect(view.state.field(blockSelection)).not.toBeNull();
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe("Uno");
    expect(view.dom.classList.contains("cm-fub-blocks-selecting")).toBe(true);
    press(view, "ArrowDown", { shiftKey: true });
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe("Uno\n\nDue");
    expect(view.dom.querySelectorAll(".cm-fub-block-selected")).toHaveLength(3);
    expect(view.dom.querySelector(".cm-announced")?.textContent).toBe("2 blocchi selezionati");
  });

  it("Canc elimina i blocchi e le loro righe vuote, in un passo", () => {
    const view = mount("Uno\n\nDue\n\nTre", 6);
    press(view, "Escape");
    press(view, "Delete");
    expect(view.state.doc.toString()).toBe("Uno\n\nTre");
    expect(view.state.field(blockSelection)).toBeNull();
  });

  it("Mod-d duplica e seleziona la copia; Esc torna al testo", () => {
    const view = mount("- a\n- b", 1);
    press(view, "Escape");
    press(view, "d", { ctrlKey: true });
    expect(view.state.doc.toString()).toBe("- a\n- a\n- b");
    expect(view.state.field(blockSelection)).not.toBeNull();
    press(view, "Escape");
    expect(view.state.field(blockSelection)).toBeNull();
    expect(view.state.selection.main.empty).toBe(true);
  });

  it("una battuta, o un clic altrove, la fanno tornare testo", () => {
    const view = mount("Uno\n\nDue", 1);
    press(view, "Escape");
    view.dispatch({ selection: EditorSelection.cursor(7) });
    expect(view.state.field(blockSelection)).toBeNull();
  });

  it("Mod-Shift-↑ sposta la selezione intera e la tiene", () => {
    const view = mount("Uno\n\nDue\n\nTre", 6);
    press(view, "Escape");
    press(view, "ArrowDown", { shiftKey: true });
    press(view, "ArrowUp", { ctrlKey: true, shiftKey: true });
    expect(view.state.doc.toString()).toBe("Due\n\nTre\n\nUno");
    expect(view.state.field(blockSelection)).not.toBeNull();
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe("Due\n\nTre");
  });

  it("con più cursori Esc non fa una selezione di blocchi da uno solo", () => {
    const view = mount("Uno\n\nDue", 1);
    view.dispatch({ selection: EditorSelection.create([EditorSelection.cursor(1), EditorSelection.cursor(6)]) });
    press(view, "Escape");
    // La selezione di blocchi è una: si prende il cursore principale.
    expect(view.state.selection.ranges).toHaveLength(1);
  });
});

describe("le maniglie", () => {
  it("il «+» e la maniglia stanno fuori dal contenuto, coi loro nomi", () => {
    const view = mount("## Cose da fare\n\nTesto", 3);
    const root = view.scrollDOM.querySelector(".cm-fub-block-handles")!;
    expect(root).not.toBeNull();
    expect(view.contentDOM.contains(root)).toBe(false);
    const buttons = root.querySelectorAll("button");
    expect([...buttons].map((button) => button.getAttribute("aria-label"))[0]).toBe("Aggiungi un blocco sotto");
    expect(gripLabel(view.state, view.state.field(blockModel).blocks, 0)).toBe("Blocco: Titolo 2, Cose da fare");
  });

  it("il «+» aggiunge una voce sorella sotto una voce, un paragrafo sotto il resto", () => {
    const state = mount("1. uno\n2. due\n\nTesto").state;
    const blocks = state.field(blockModel).blocks;
    expect(addBelow(state, blocks, 0).changes).toEqual({ from: 6, insert: "\n2. " });
    expect(addBelow(state, blocks, 2).changes).toEqual({ from: state.doc.length, insert: "\n\n" });
  });

  it("«Colore» colora il paragrafo intero e la prima riga di titoli e voci (K1)", () => {
    const view = mount("## Titolo\n\nuna\nriga\n\n- voce\n  segue\n\n```\ncodice\n```");
    const blocks = view.state.field(blockModel).blocks;
    const texts = (index: number) => colorRanges(view.state, blocks, index).map((range) => view.state.sliceDoc(range.from, range.to));
    expect(texts(0)).toEqual(["Titolo"]);
    expect(texts(1)).toEqual(["una\nriga"]);
    expect(texts(2)[0]).toBe("voce");
    expect(texts(blocks.findIndex((block) => block.kind === "code"))).toEqual([]);
    for (const range of colorRanges(view.state, blocks, 1)) {
      setContentColor("fill", "yellow", range)({ state: view.state, dispatch: (tr) => view.dispatch(tr) });
    }
    expect(view.state.doc.toString()).toContain('<mark class="fub-bg-yellow">una\nriga</mark>');
  });

  it("smontare l'editor toglie le maniglie", () => {
    const view = mount("Testo");
    view.destroy();
    views.splice(views.indexOf(view), 1);
    expect(document.querySelector(".cm-fub-block-handles")).toBeNull();
  });
});

describe("gli id di blocco", () => {
  it("con `mai` non si vedono, in coda e su una riga loro", () => {
    const view = mount("Testo ^abc\n\n```\nx\n```\n\n^cod\n\nDopo");
    expect(view.contentDOM.textContent).not.toContain("^abc");
    expect(view.contentDOM.textContent).not.toContain("^cod");
    expect(view.contentDOM.textContent).toContain("Dopo");
  });
});

describe("il codice", () => {
  const doc = "```js\nconst a = 1;\nconst b = 2;\n```";

  it("Tab rientra il codice", () => {
    const view = mount(doc, doc.indexOf("const b"));
    expect(press(view, "Tab")).toBe(true);
    expect(view.state.doc.line(3).text.startsWith("\t") || view.state.doc.line(3).text.startsWith("  ")).toBe(true);
  });

  it("Mod-a prende prima il codice, poi tutto", () => {
    const view = mount(`Prima\n\n${doc}`, 15);
    press(view, "a", { ctrlKey: true });
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe("const a = 1;\nconst b = 2;");
    expect(press(view, "a", { ctrlKey: true })).toBe(false);
  });

  it("fuori dal codice Tab resta quello di sempre", () => {
    const view = mount("Testo", 2);
    expect(press(view, "Tab")).toBe(false);
  });
});

describe("Vim e composizione (H15)", () => {
  it("con Vim nel modo normale i tasti dei Blocchi sono di Vim", () => {
    const view = mount("Uno\n\nDue", 6, vi.fn(), vim());
    expect(view.scrollDOM.classList.contains("cm-vimMode")).toBe(true);
    expect(press(view, "Escape")).toBe(false);
    expect(view.state.field(blockSelection)).toBeNull();
    press(view, "ArrowUp", { ctrlKey: true, shiftKey: true });
    expect(view.state.doc.toString()).toBe("Uno\n\nDue");
    // Le maniglie ci sono anche con Vim: si usano col mouse.
    expect(view.scrollDOM.querySelector(".cm-fub-block-handles")).not.toBeNull();
  });

  it("durante una composizione nessun tasto dei Blocchi agisce", () => {
    const view = mount("Uno\n\nDue", 6);
    Object.defineProperty(view, "composing", { configurable: true, get: () => true });
    press(view, "ArrowUp", { ctrlKey: true, shiftKey: true });
    expect(view.state.doc.toString()).toBe("Uno\n\nDue");
    expect(press(view, "Escape")).toBe(false);
  });
});
