// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { titleEdit, type DiagramProblem, type MermaidView } from "../../../../ui/mermaid";
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
  const made: { source: string; view: MermaidView; destroyed: boolean; problem: DiagramProblem | null }[] = [];
  const make = (source: string): MermaidView => {
    const element = document.createElement("figure");
    element.dataset.state = "loading";
    const status = document.createElement("p");
    status.setAttribute("role", "status");
    element.append(status);
    const caption = document.createElement("figcaption");
    const entry = {
      source,
      destroyed: false,
      problem: null as DiagramProblem | null,
      view: {
        element,
        caption,
        get problem() { return entry.problem; },
        menu: () => {},
        enlarge: () => false,
        copy: async () => {},
        destroy: () => { entry.destroyed = true; },
      } as MermaidView,
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
    made[1]!.problem = { line: 12, text: "questa riga non è un nodo né un collegamento" };
    finish(made[1]!.view, "error", "Parse error on line 9: Expecting 'SEMI', got 'LINK'");
    await settle();
    expect(root.contains(made[0]!.view.element)).toBe(true);
    expect(root.contains(made[1]!.view.element)).toBe(false);
    // Il disegno di prima resta, attenuato; la riga dice dove, in chiaro.
    expect(made[0]!.view.element.classList.contains("is-stale")).toBe(true);
    expect(live.notice.hidden).toBe(false);
    expect(live.notice.querySelector("b")!.textContent).toBe("Riga 12");
    expect(live.notice.textContent).toBe("Riga 12: questa riga non è un nodo né un collegamento. Resta il disegno di prima.");
    expect(live.notice.textContent).not.toContain("Expecting");
    // Il disegno giusto toglie la riga e l'attenuazione.
    vi.useFakeTimers();
    live.schedule("di nuovo buono");
    vi.advanceTimersByTime(DIAGRAM_QUIET_MS);
    vi.useRealTimers();
    finish(made[2]!.view, "ready");
    await settle();
    expect(live.notice.hidden).toBe(true);
    expect(root.contains(made[2]!.view.caption)).toBe(true);
    expect(made[2]!.view.element.classList.contains("is-stale")).toBe(false);
    live.dispose();
  });

  it("un errore prima di ogni disegno: la riga lo dice, senza promettere un disegno; senza riga, una frase", async () => {
    const { made, make } = fakes();
    const root = document.createElement("div");
    document.body.append(root);
    const live = new DiagramLive(root, "flowchart TD\n  A --> --> B", () => {}, make);
    made[0]!.problem = { line: 2, text: "questa riga non è un nodo né un collegamento" };
    finish(made[0]!.view, "error");
    await settle();
    expect(live.view).toBe(made[0]!.view);
    expect(live.notice.textContent).toBe("Riga 2: questa riga non è un nodo né un collegamento.");
    live.dispose();

    const { made: other, make: makeOther } = fakes();
    const second = new DiagramLive(document.createElement("div"), "x", () => {}, makeOther);
    other[0]!.problem = { line: null, text: "il diagramma non si disegna: controlla il sorgente" };
    finish(other[0]!.view, "error");
    await settle();
    expect(second.notice.textContent).toBe("Il diagramma non si disegna: controlla il sorgente.");
    expect(second.notice.querySelector("b")).toBeNull();
    second.dispose();
  });
});

describe("il disegno accanto al sorgente", () => {
  it("accanto sale fino alla testata, e nel flusso resta soltanto ciò che supera il sorgente", () => {
    const { make } = fakes();
    const root = document.createElement("div");
    const live = new DiagramLive(root, "a", () => {}, make);
    const layout = { lift: 120, beside: true, figure: 300, notice: 30, height: 40 };
    expect(live.write(layout)).toBe(true);
    expect(root.style.getPropertyValue("--diagram-lift")).toBe("120px");
    expect(root.style.getPropertyValue("--diagram-rest")).toBe("150px");
    // Lo stesso spazio: niente da rimisurare.
    expect(live.write(layout)).toBe(false);
    // Un sorgente più alto del disegno: nessuno spazio in più.
    expect(live.write({ ...layout, lift: 400 })).toBe(true);
    expect(root.style.getPropertyValue("--diagram-rest")).toBe("0px");
    // Uno sopra l'altro (foglio stretto): il disegno è nel flusso.
    live.write({ ...layout, beside: false });
    expect(root.style.getPropertyValue("--diagram-rest")).toBe("0px");
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

describe("il sorgente aperto", () => {
  const mount = (doc: string, anchor: number, blocks = true) => {
    const view = new EditorView({
      parent: document.body,
      state: EditorState.create({
        doc,
        selection: { anchor },
        extensions: [markdown({ base: markdownGrammar }), livePreview({ openWikilink() {}, searchTag() {} }), ...(blocks ? [blocksMode({ page: () => "Nota" })] : [])],
      }),
    });
    ensureSyntaxTree(view.state, view.state.doc.length, 1000);
    view.dispatch({});
    // happy-dom manda `selectionchange` dentro l'aggiornamento di un editor
    // col fuoco: qui il fuoco non serve.
    view.focus = () => {};
    return view;
  };
  const press = (view: EditorView, key: string) =>
    runScopeHandlers(view, new KeyboardEvent("keydown", { key }), "editor");
  const doc = "Prima\n\n```mermaid\ngraph TD\nA-->B\n```\n\nDopo";
  const sourceLines = (view: EditorView) => [...view.contentDOM.querySelectorAll(".cm-line.cm-fub-diagram-src")].length;
  const opened = (view: EditorView) => view.contentDOM.querySelector(".cm-fub-diagram-live") !== null;

  it("col cursore nel recinto le sue righe stanno a metà e il disegno accanto", () => {
    const view = mount(doc, doc.indexOf("A-->B"));
    expect(opened(view)).toBe(true);
    // La testata, due righe di corpo, la chiusura.
    expect(sourceLines(view)).toBe(4);
    view.dispatch({ selection: { anchor: 2 } });
    expect(opened(view)).toBe(false);
    expect(sourceLines(view)).toBe(0);
    view.destroy();
  });

  it("Esc lo chiude e sceglie il blocco: si vede il solo disegno; Invio lo riapre", () => {
    const view = mount(doc, doc.indexOf("A-->B"));
    expect(press(view, "Escape")).toBe(true);
    expect(view.state.field(blockSelection)).not.toBeNull();
    expect(opened(view)).toBe(false);
    expect(sourceLines(view)).toBe(0);
    expect(press(view, "Enter")).toBe(true);
    expect(opened(view)).toBe(true);
    view.destroy();
  });

  it("senza i Blocchi Esc porta il cursore sotto il recinto", () => {
    const view = mount(doc, doc.indexOf("A-->B"), false);
    expect(press(view, "Escape")).toBe(true);
    expect(view.state.selection.main.head).toBe(doc.indexOf("```\n\nDopo") + 4);
    expect(opened(view)).toBe(false);
    view.destroy();
  });

  it("«Fatto» nella testata fa come Esc", () => {
    const view = mount(doc, doc.indexOf("A-->B"));
    const done = view.contentDOM.querySelector<HTMLButtonElement>(".cm-fub-code-header .cm-fub-code-done");
    expect(done?.textContent).toBe("Fatto");
    done!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(view.state.field(blockSelection)).not.toBeNull();
    expect(opened(view)).toBe(false);
    view.destroy();
  });

  it("un recinto di altro codice non ha «Fatto», ed Esc resta della selezione dei blocchi", () => {
    const js = "Prima\n\n```js\nlet a = 1;\n```\n\nDopo";
    const view = mount(js, js.indexOf("let"));
    expect(view.contentDOM.querySelector(".cm-fub-code-done")).toBeNull();
    expect(sourceLines(view)).toBe(0);
    view.destroy();
  });
});

describe("la didascalia scritta nel sorgente", () => {
  const editor = (doc: string) => new EditorView({ parent: document.body, state: EditorState.create({ doc }) });

  it("aggiunge, riscrive e toglie il titolo nel frontmatter del recinto", () => {
    const doc = "Prima\n\n```mermaid\ngraph TD\nA-->B\n```\n";
    const view = editor(doc);
    const end = () => view.state.doc.toString().lastIndexOf("```") + 3;
    const write = (title: string) => {
      const body = fenceBody(view.state.doc.toString().slice(view.state.doc.toString().indexOf("```mermaid"), end()));
      const edit = titleEdit(body, title);
      expect(edit).not.toBeNull();
      expect(editFenceBody(view, end(), body, edit!)).toBe(true);
    };
    write("Il percorso");
    expect(view.state.doc.toString()).toBe("Prima\n\n```mermaid\n---\ntitle: Il percorso\n---\ngraph TD\nA-->B\n```\n");
    // Caratteri che YAML leggerebbe in un altro modo: fra virgolette.
    write("Fase 1: \"prova\" # bozza");
    expect(view.state.doc.toString()).toBe("Prima\n\n```mermaid\n---\ntitle: \"Fase 1: \\\"prova\\\" # bozza\"\n---\ngraph TD\nA-->B\n```\n");
    write("");
    expect(view.state.doc.toString()).toBe(doc);
    view.destroy();
  });
});
