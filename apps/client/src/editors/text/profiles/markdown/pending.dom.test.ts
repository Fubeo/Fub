// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { history, undo } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { markdownGrammar } from "./grammar";
import { pendingGuide, spaceClosing } from "./pending";
import { markdownEditingExtensions } from "./commands";
import { liveHints } from "./hints";

// I gesti della guida nella vista (B2, B3): → e Tab accettano, Esc spegne,
// Backspace toglie la chiusura appena scritta. `|` è il cursore.

const views: EditorView[] = [];
afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  document.body.replaceChildren();
});

function mount(spec: string): EditorView {
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc: spec.replace("|", ""),
      selection: { anchor: spec.indexOf("|") },
      extensions: [markdown({ base: markdownGrammar }), history(), pendingGuide()],
    }),
  });
  ensureSyntaxTree(view.state, view.state.doc.length, 1000);
  view.dispatch({});
  views.push(view);
  return view;
}
const press = (view: EditorView, key: string) => runScopeHandlers(view, new KeyboardEvent("keydown", { key }), "editor");
const ghost = () => document.querySelector(".cm-fub-ghost")?.textContent ?? null;

describe("la chiusura in grigio", () => {
  it("si vede, non è nel file, e il testo in sospeso ha già lo stile", () => {
    const view = mount("una **importante|");
    expect(ghost()).toBe("**");
    expect(view.state.doc.toString()).toBe("una **importante");
    expect(document.querySelector(".cm-fub-strong.cm-fub-pending")?.textContent).toBe("importante");
    expect(document.querySelector(".cm-fub-pending-mark")?.textContent).toBe("**");
  });

  it("→ la scrive, e un solo annulla la toglie", () => {
    const view = mount("una **importante|");
    expect(press(view, "ArrowRight")).toBe(true);
    expect(view.state.doc.toString()).toBe("una **importante**");
    expect(view.state.selection.main.head).toBe(18);
    expect(ghost()).toBeNull();
    undo(view);
    expect(view.state.doc.toString()).toBe("una **importante");
  });

  it("anche Tab la scrive; senza chiusura Tab passa la mano", () => {
    const view = mount("E = mc^2|");
    expect(press(view, "Tab")).toBe(true);
    expect(view.state.doc.toString()).toBe("E = mc^2^");
    expect(press(view, "Tab")).toBe(false);
  });

  it("Esc la spegne per quel segno", () => {
    const view = mount("costo 5*3|");
    expect(ghost()).toBe("*");
    expect(press(view, "Escape")).toBe(true);
    expect(ghost()).toBeNull();
    expect(press(view, "ArrowRight")).toBe(false);
    expect(view.state.doc.toString()).toBe("costo 5*3");
  });

  it("scrivere il segno a mano la sostituisce", () => {
    const view = mount("**a|");
    view.dispatch({ changes: { from: 3, insert: "**" }, selection: { anchor: 5 }, userEvent: "input.type" });
    expect(ghost()).toBeNull();
    expect(view.state.doc.toString()).toBe("**a**");
  });
});

describe("Backspace dopo la chiusura della guida", () => {
  it("dopo lo spazio di un apice toglie la sola chiusura", () => {
    const view = mount("E = mc^2|");
    view.dispatch(spaceClosing(view.state)!);
    expect(view.state.doc.toString()).toBe("E = mc^2^ ");
    expect(press(view, "Backspace")).toBe(true);
    expect(view.state.doc.toString()).toBe("E = mc^2 ");
    expect(view.state.selection.main.head).toBe(9);
  });

  it("dopo un'altra battuta è un Backspace come gli altri", () => {
    const view = mount("**a|");
    press(view, "ArrowRight");
    view.dispatch({ changes: { from: 5, insert: "x" }, selection: { anchor: 6 } });
    expect(press(view, "Backspace")).toBe(false);
  });
});

describe("[] e spazio a inizio riga (B8)", () => {
  it("diventa una voce da fare, e un annulla torna a [] ", () => {
    const view = new EditorView({
      parent: document.body,
      state: EditorState.create({ doc: "[]", selection: { anchor: 2 }, extensions: [markdown({ base: markdownGrammar }), history(), markdownEditingExtensions()] }),
    });
    views.push(view);
    const handled = view.state.facet(EditorView.inputHandler).some((handler) => handler(view, 2, 2, " ", () => view.state.update({})));
    expect(handled).toBe(true);
    expect(view.state.doc.toString()).toBe("- [ ] ");
    undo(view);
    expect(view.state.doc.toString()).toBe("[] ");
  });
});

describe("i cenni (B5, B6)", () => {
  function live(spec: string): EditorView {
    const view = new EditorView({
      parent: document.body,
      state: EditorState.create({
        doc: spec.replace("|", ""),
        selection: { anchor: spec.indexOf("|") },
        extensions: [markdown({ base: markdownGrammar }), liveHints(() => true)],
      }),
    });
    ensureSyntaxTree(view.state, view.state.doc.length, 1000);
    views.push(view);
    view.focus();
    view.dispatch({});
    return view;
  }

  it("la pastiglia del titolo dice il livello e apre i livelli", () => {
    const view = live("## Cose| da fare\n\naltro");
    const pill = document.querySelector<HTMLButtonElement>(".cm-fub-heading-pill-button")!;
    expect(pill.textContent).toBe("H2");
    expect(pill.getAttribute("aria-label")).toBe("Titolo di livello 2, cambia livello");
    pill.click();
    const items = [...document.querySelectorAll<HTMLElement>('.cm-fub-heading-menu [role="menuitemradio"]')];
    expect(items.map((item) => item.textContent)).toEqual(["Testo normale", "Titolo 1", "Titolo 2", "Titolo 3", "Titolo 4", "Titolo 5", "Titolo 6"]);
    expect(items[2]!.getAttribute("aria-checked")).toBe("true");
    items[3]!.click();
    expect(view.state.doc.toString()).toBe("### Cose da fare\n\naltro");
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    expect(document.querySelector(".cm-fub-heading-pill-button")).toBeNull();
  });

  it("il segnaposto sta sulla riga vuota del cursore e non è nel testo", () => {
    const view = live("prima\n|\ndopo");
    expect(document.querySelector(".cm-fub-placeholder")?.textContent).toBe("Scrivi, oppure premi / per i comandi");
    expect(document.querySelector(".cm-fub-placeholder")?.getAttribute("aria-hidden")).toBe("true");
    expect(view.state.doc.toString()).toBe("prima\n\ndopo");
    view.dispatch({ changes: { from: 6, insert: "- [ ] " }, selection: { anchor: 12 } });
    expect(document.querySelector(".cm-fub-placeholder")?.textContent).toBe("Da fare");
    view.dispatch({ changes: { from: 6, to: 12, insert: "### " }, selection: { anchor: 10 } });
    expect(document.querySelector(".cm-fub-placeholder")?.textContent).toBe("Titolo 3");
  });
});
