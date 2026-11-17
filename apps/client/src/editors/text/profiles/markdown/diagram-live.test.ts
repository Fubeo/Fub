// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MermaidView } from "../../../../ui/mermaid";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { styleDirectiveEdit } from "../../../../theme/diagram-style";
import { DIAGRAM_QUIET_MS, DiagramLive, editFenceBody, fenceBody, fenceBodyStart } from "./diagram-live";
import { markdownGrammar } from "./grammar";
import { livePreview } from "./livepreview";
import { blocksMode } from "./blocks";
import { blockSelection, selectCursorBlock } from "./blocks/selection";

// La corsa del diagramma (C5): una resa vecchia non sostituisce la nuova, e
// un errore non toglie l'ultimo disegno buono.

function fakes() {
  const made: { source: string; view: MermaidView; destroyed: boolean }[] = [];
  const make = (source: string): MermaidView => {
    const element = document.createElement("figure");
    element.dataset.state = "loading";
    const status = document.createElement("p");
    status.setAttribute("role", "status");
    element.append(status);
    const entry = {
      source,
      destroyed: false,
      view: { element, menu: () => {}, enlarge: () => false, copy: async () => {}, destroy: () => { entry.destroyed = true; } } as MermaidView,
    };
    made.push(entry);
    return entry.view;
  };
  return { made, make };
}
const settle = () => new Promise((done) => setTimeout(done, 0));
const finish = (view: MermaidView, state: "ready" | "error", reason = "") => {
  view.element.querySelector('[role="status"]')!.textContent = reason;
  view.element.dataset.state = state;
};

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("il corpo del recinto", () => {
  it("toglie le righe dei recinti", () => {
    expect(fenceBody("```mermaid\ngraph TD\nA-->B\n```")).toBe("graph TD\nA-->B");
    expect(fenceBody("```mermaid\ngraph TD")).toBe("graph TD");
  });
});

describe("la corsa delle rese", () => {
  it("disegna dopo la quiete, una volta sola per una raffica", () => {
    vi.useFakeTimers();
    const { made, make } = fakes();
    const root = document.createElement("div");
    const live = new DiagramLive(root, "a", () => {}, make);
    live.schedule("ab");
    live.schedule("abc");
    vi.advanceTimersByTime(DIAGRAM_QUIET_MS - 1);
    expect(made.map((m) => m.source)).toEqual(["a"]);
    vi.advanceTimersByTime(1);
    expect(made.map((m) => m.source)).toEqual(["a", "abc"]);
    live.dispose();
    expect(made.every((m) => m.destroyed)).toBe(true);
  });

  it("una resa vecchia che finisce dopo la nuova non la sostituisce", async () => {
    vi.useFakeTimers();
    const { made, make } = fakes();
    const root = document.createElement("div");
    document.body.append(root);
    const live = new DiagramLive(root, "uno", () => {}, make);
    live.schedule("due");
    vi.advanceTimersByTime(DIAGRAM_QUIET_MS);
    vi.useRealTimers();
    const [first, second] = made;
    finish(second!.view, "ready");
    await settle();
    finish(first!.view, "ready");
    await settle();
    expect(root.contains(second!.view.element)).toBe(true);
    expect(root.contains(first!.view.element)).toBe(false);
    expect(second!.view.element.classList.contains("cm-fub-diagram-trying")).toBe(false);
    live.dispose();
  });

  it("con un errore resta l'ultimo disegno buono, e l'avviso lo dice", async () => {
    vi.useFakeTimers();
    const { made, make } = fakes();
    const root = document.createElement("div");
    document.body.append(root);
    const live = new DiagramLive(root, "buono", () => {}, make);
    vi.useRealTimers();
    finish(made[0]!.view, "ready");
    await settle();
    vi.useFakeTimers();
    live.schedule("sbagliato");
    vi.advanceTimersByTime(DIAGRAM_QUIET_MS);
    vi.useRealTimers();
    finish(made[1]!.view, "error", "Parse error");
    await settle();
    expect(root.contains(made[0]!.view.element)).toBe(true);
    expect(root.contains(made[1]!.view.element)).toBe(false);
    expect(live.notice.hidden).toBe(false);
    expect(live.notice.textContent).toContain("Parse error");
    live.dispose();
  });
});

describe("il recinto che il menu riscrive", () => {
  const editor = (doc: string, readOnly = false) => new EditorView({
    parent: document.body,
    state: EditorState.create({ doc, extensions: readOnly ? [EditorState.readOnly.of(true)] : [] }),
  });

  it("trova il corpo dal punto dove finisce il recinto", () => {
    const doc = "Prima\n\n```mermaid\ngraph TD\nA-->B\n```\n\nDopo";
    const view = editor(doc);
    const end = doc.indexOf("```\n\nDopo") + 3;
    expect(fenceBodyStart(view.state, end, "graph TD\nA-->B")).toBe(doc.indexOf("graph"));
    // Un corpo che non è più quello letto: niente.
    expect(fenceBodyStart(view.state, end, "graph LR\nA-->B")).toBeNull();
    // Un recinto non chiuso, fino in fondo alla nota.
    const open = "```mermaid\ngraph TD";
    expect(fenceBodyStart(editor(open).state, open.length, "graph TD")).toBe(11);
    // Un recinto che non è Mermaid.
    const js = "```js\ngraph TD\n```";
    expect(fenceBodyStart(editor(js).state, js.length, "graph TD")).toBeNull();
    view.destroy();
  });

  it("scrive lo stile dopo il frontmatter e lo toglie, senza toccare il resto; mai in sola lettura", () => {
    const doc = "```mermaid\n---\ntitle: Flusso\n---\ngraph TD\nA-->B\n```";
    const body = fenceBody(doc);
    const view = editor(doc);
    expect(editFenceBody(view, doc.length, body, styleDirectiveEdit(body, "aurora")!)).toBe(true);
    expect(view.state.doc.toString()).toBe("```mermaid\n---\ntitle: Flusso\n---\n%% stile: aurora\ngraph TD\nA-->B\n```");
    const written = fenceBody(view.state.doc.toString());
    expect(editFenceBody(view, view.state.doc.length, written, styleDirectiveEdit(written, null)!)).toBe(true);
    expect(view.state.doc.toString()).toBe(doc);
    const locked = editor(doc, true);
    expect(editFenceBody(locked, doc.length, body, styleDirectiveEdit(body, "aurora")!)).toBe(false);
    expect(locked.state.doc.toString()).toBe(doc);
    view.destroy();
    locked.destroy();
  });
});

describe("i tasti del diagramma scelto", () => {
  const mount = (doc: string, anchor: number) => {
    const view = new EditorView({
      parent: document.body,
      state: EditorState.create({
        doc,
        selection: { anchor },
        extensions: [markdown({ base: markdownGrammar }), livePreview({ openWikilink() {}, searchTag() {} }), blocksMode({ page: () => "Nota" })],
      }),
    });
    ensureSyntaxTree(view.state, view.state.doc.length, 1000);
    view.dispatch({});
    return view;
  };
  const press = (view: EditorView, key: string) =>
    runScopeHandlers(view, new KeyboardEvent("keydown", { key }), "editor");
  const doc = "Prima\n\n```mermaid\ngraph TD\nA-->B\n```\n\nDopo";

  it("Invio apre il sorgente all'inizio del corpo", () => {
    const view = mount(doc, doc.indexOf("A-->B"));
    expect(selectCursorBlock(view)).toBe(true);
    expect(view.state.field(blockSelection)).not.toBeNull();
    expect(press(view, "Enter")).toBe(true);
    expect(view.state.field(blockSelection)).toBeNull();
    expect(view.state.selection.main.head).toBe(doc.indexOf("graph"));
    view.destroy();
  });

  it("Spazio non scrive al posto del recinto", () => {
    const view = mount(doc, doc.indexOf("A-->B"));
    selectCursorBlock(view);
    expect(press(view, " ")).toBe(true);
    expect(view.state.doc.toString()).toBe(doc);
    view.destroy();
  });

  it("fuori da un diagramma Invio resta della selezione dei blocchi", () => {
    const view = mount(doc, 2);
    selectCursorBlock(view);
    expect(press(view, "Enter")).toBe(true);
    expect(view.state.selection.main.head).toBe(5);
    view.destroy();
  });
});
