// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState, Prec } from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { markdownGrammar } from "./grammar";
import { livePreview } from "./livepreview";
import { liveReveal, type RevealPolicy } from "../../live-reveal";
import { codeBodyText, codeFenceAt, languageName, removeEmptyBlock, setLanguage } from "./code-block";

const clipboard = vi.hoisted(() => ({ text: [] as string[] }));
vi.mock("mermaid", () => ({
  default: {
    initialize() {},
    render: async () => ({ svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>' }),
  },
}));
vi.mock("../../../../platform/clipboard", async (original) => ({
  ...(await original<typeof import("../../../../platform/clipboard")>()),
  writeClipboardText: async (text: string) => { clipboard.text.push(text); },
}));

// Il blocco di codice in Live (C1–C3): la testata al posto del recinto, la
// chiusura che non si vede, la lingua dal menu, «A capo» della superficie.

const views: EditorView[] = [];
afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  document.body.replaceChildren();
  clipboard.text.length = 0;
});

function mount(doc: string, anchor: number, policy: RevealPolicy = "mai"): EditorView {
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      selection: { anchor },
      extensions: [markdown({ base: markdownGrammar }), livePreview({ openWikilink() {}, searchTag() {} }), Prec.highest(liveReveal.of(policy))],
    }),
  });
  ensureSyntaxTree(view.state, view.state.doc.length, 1000);
  view.dispatch({});
  views.push(view);
  return view;
}
const press = (view: EditorView, key: string) => runScopeHandlers(view, new KeyboardEvent("keydown", { key }), "editor");
const text = () => document.querySelector(".cm-content")!.textContent;

const SOURCE = "Prima\n\n```rust\nfn main() {}\nlet x = 1;\n```\n\nDopo";

describe("le regole del blocco", () => {
  it("la lingua si legge col suo nome, e senza lingua è testo", () => {
    expect(languageName("rust")).toBe("Rust");
    expect(languageName("ts {title=a}")).toBe("TypeScript");
    expect(languageName("")).toBe("Testo");
    expect(languageName("zig")).toBe("zig");
  });

  it("cambiare lingua riscrive soltanto l'info string", () => {
    const state = EditorState.create({ doc: SOURCE, extensions: markdown({ base: markdownGrammar }) });
    ensureSyntaxTree(state, state.doc.length, 1000);
    const fence = codeFenceAt(state, SOURCE.indexOf("fn"))!;
    expect(codeBodyText(state, fence)).toBe("fn main() {}\nlet x = 1;");
    expect(state.update(setLanguage(fence, "python")).state.doc.toString()).toBe(SOURCE.replace("rust", "python"));
    const bare = EditorState.create({ doc: "```\nx\n```", extensions: markdown({ base: markdownGrammar }) });
    ensureSyntaxTree(bare, bare.doc.length, 1000);
    expect(bare.update(setLanguage(codeFenceAt(bare, 4)!, "sql")).state.doc.toString()).toBe("```sql\nx\n```");
  });
});

describe("in Live con `mai`", () => {
  it("la testata sta al posto del recinto, e la chiusura non si vede", () => {
    mount(SOURCE, SOURCE.indexOf("fn"));
    expect(document.querySelector(".cm-fub-code-lang")?.textContent).toBe("Rust ▾");
    expect(text()).not.toContain("```");
    expect(document.querySelector(".cm-fub-fence-close-line")).not.toBeNull();
  });

  it("il cursore non si posa sui recinti: dalla testata va nel corpo", () => {
    const view = mount(SOURCE, 0);
    view.dispatch({ selection: { anchor: SOURCE.indexOf("```rust") + 2 } });
    expect(view.state.selection.main.head).toBe(SOURCE.indexOf("fn"));
    view.dispatch({ selection: { anchor: SOURCE.lastIndexOf("```") + 1 } });
    expect(view.state.selection.main.head).toBe(SOURCE.indexOf("1;") + 2);
  });

  it("chi scrive ```js resta sulla riga d'apertura", () => {
    const view = mount("Prima\n\n\nDopo.", 7);
    view.dispatch({ changes: { from: 7, insert: "```" }, selection: { anchor: 10 }, userEvent: "input.type" });
    view.dispatch({ changes: { from: 10, insert: "js" }, selection: { anchor: 12 }, userEvent: "input.type" });
    expect(view.state.doc.toString()).toBe("Prima\n\n```js\nDopo.");
    expect(view.state.selection.main.head).toBe(12);
  });

  it("↑ dalla prima riga e ↓ dall'ultima escono dal blocco", () => {
    const view = mount(SOURCE, SOURCE.indexOf("fn") + 1);
    expect(press(view, "ArrowUp")).toBe(true);
    expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBe(2);
    view.dispatch({ selection: { anchor: SOURCE.indexOf("let") } });
    expect(press(view, "ArrowDown")).toBe(true);
    expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBe(7);
  });

  it("Backspace in un blocco vuoto lo toglie", () => {
    const doc = "a\n\n```js\n\n```\n";
    const view = mount(doc, doc.indexOf("```js") + 6);
    expect(removeEmptyBlock(view.state)).not.toBeNull();
    expect(press(view, "Backspace")).toBe(true);
    expect(view.state.doc.toString()).toBe("a\n\n\n");
  });

  it("«Copia» porta il corpo senza recinti", async () => {
    mount(SOURCE, SOURCE.indexOf("fn"));
    document.querySelector<HTMLButtonElement>(".cm-fub-code-copy")!.click();
    await Promise.resolve();
    expect(clipboard.text).toEqual(["fn main() {}\nlet x = 1;"]);
  });

  it("la lingua si sceglie dal menu, col filtro", () => {
    const view = mount(SOURCE, SOURCE.indexOf("fn"));
    document.querySelector<HTMLButtonElement>(".cm-fub-code-lang")!.click();
    const field = document.querySelector<HTMLInputElement>(".cm-fub-code-languages input")!;
    expect(document.querySelector('.cm-fub-code-languages [data-selected]')?.textContent).toBe("Rust");
    field.value = "pyt";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    const rows = [...document.querySelectorAll('.cm-fub-code-languages [role="option"]')].map((row) => row.textContent);
    expect(rows).toEqual(["Python"]);
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(view.state.doc.toString()).toBe(SOURCE.replace("rust", "python"));
  });

  it("«A capo» spento non scrive nel file", () => {
    const view = mount(SOURCE, SOURCE.indexOf("fn"));
    const wrap = () => document.querySelector<HTMLButtonElement>(".cm-fub-code-wrap")!;
    expect(wrap().getAttribute("aria-pressed")).toBe("true");
    wrap().click();
    expect(wrap().getAttribute("aria-pressed")).toBe("false");
    expect(document.querySelectorAll(".cm-fub-code-nowrap")).toHaveLength(2);
    expect(view.state.doc.toString()).toBe(SOURCE);
    wrap().click();
    expect(document.querySelectorAll(".cm-fub-code-nowrap")).toHaveLength(0);
  });
});

describe("il diagramma che si scrive (C5)", () => {
  it("col cursore dentro il sorgente sta sotto la testata, e il disegno sotto", () => {
    const doc = "Prima\n\n```mermaid\ngraph TD\nA-->B\n```\n\nDopo";
    const view = mount(doc, 0);
    expect(document.querySelector(".cm-fub-diagram-live")).toBeNull();
    view.dispatch({ selection: { anchor: doc.indexOf("A-->") } });
    expect(document.querySelector(".cm-fub-code-lang")?.textContent).toBe("Mermaid ▾");
    expect(document.querySelector(".cm-fub-diagram-live")).not.toBeNull();
    expect(text()).toContain("A-->B");
    view.dispatch({ selection: { anchor: doc.length } });
    expect(document.querySelector(".cm-fub-diagram-live")).toBeNull();
  });
});

describe("con le altre politiche", () => {
  it("`elemento` mostra i recinti col cursore nel blocco, e la testata fuori", () => {
    const view = mount(SOURCE, SOURCE.indexOf("fn"), "elemento");
    expect(text()).toContain("```rust");
    view.dispatch({ selection: { anchor: 0 } });
    expect(text()).not.toContain("```");
    expect(document.querySelector(".cm-fub-code-header")).not.toBeNull();
  });

  it("`riga` li mostra sempre, come prima", () => {
    mount(SOURCE, 0, "riga");
    expect(text()).toContain("```rust");
    expect(document.querySelector(".cm-fub-code-header")).toBeNull();
  });
});
