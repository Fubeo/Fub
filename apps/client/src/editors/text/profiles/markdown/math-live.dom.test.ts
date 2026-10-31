// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState, Prec } from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { markdownGrammar } from "./grammar";
import { livePreview } from "./livepreview";
import { liveReveal, type RevealPolicy } from "../../live-reveal";
import { blockTex, setTex } from "./math-live";

vi.mock("katex", () => ({ default: { render(tex: string, el: HTMLElement) { el.textContent = `«${tex}»`; } } }));
vi.mock("katex/dist/katex.min.css", () => ({}));

// Le formule con l'anteprima (C6).

const views: EditorView[] = [];
afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  document.body.replaceChildren();
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
const settle = () => new Promise((done) => setTimeout(done, 0));
const field = () => document.querySelector<HTMLInputElement>(".cm-fub-math-popover input");

describe("le regole", () => {
  it("il TeX nuovo riscrive soltanto i byte fra i dollari", () => {
    const state = EditorState.create({ doc: "x $a+b$ e $$c$$ y" });
    expect(state.update(setTex(state, { from: 2, to: 7, tex: "a+b" }, "a^2")).state.doc.toString()).toBe("x $a^2$ e $$c$$ y");
    expect(state.update(setTex(state, { from: 10, to: 15, tex: "c" }, "d")).state.doc.toString()).toBe("x $a+b$ e $$d$$ y");
  });

  it("il TeX di un blocco è senza dollari e senza id", () => {
    expect(blockTex("$$\nE = mc^2\n$$")).toBe("E = mc^2");
    expect(blockTex("$$ x $$ ^eq")).toBe("x");
  });
});

describe("con `mai`", () => {
  it("→ davanti alla formula apre il riquadro; scrivere cambia il TeX, Invio esce dopo", () => {
    const doc = "x $a+b$ y";
    const view = mount(doc, 2);
    view.focus();
    expect(document.querySelector(".cm-fub-math")).not.toBeNull();
    expect(press(view, "ArrowRight")).toBe(true);
    const input = field()!;
    expect(input.value).toBe("a+b");
    input.value = "a+b+c";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(view.state.doc.toString()).toBe("x $a+b+c$ y");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(field()).toBeNull();
    expect(view.state.selection.main.head).toBe(9);
  });

  it("← dopo la formula la apre anch'esso; Esc chiude e lascia il testo", () => {
    const view = mount("x $a$ y", 5);
    view.focus();
    expect(press(view, "ArrowLeft")).toBe(true);
    expect(field()?.value).toBe("a");
    field()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(field()).toBeNull();
    expect(view.state.doc.toString()).toBe("x $a$ y");
  });

  it("un blocco $$ col cursore dentro ha la resa sotto", async () => {
    const doc = "a\n\n$$\nE = mc^2\n$$\n\nb";
    const view = mount(doc, 0);
    expect(document.querySelector(".cm-fub-math-live")).toBeNull();
    view.dispatch({ selection: { anchor: doc.indexOf("mc") } });
    expect(document.querySelector(".cm-fub-math-live .math-block")?.getAttribute("data-tex")).toBe("E = mc^2");
    await settle();
  });
});

describe("con `elemento`", () => {
  it("la sorgente rivelata ha l'anteprima sopra, senza prendere il fuoco", async () => {
    const doc = "x $a+b$ y";
    const view = mount(doc, 0, "elemento");
    view.focus();
    view.dispatch({ selection: { anchor: 4 } });
    await settle();
    expect(document.querySelector(".cm-fub-math-popover-preview .math-inline")?.getAttribute("data-tex")).toBe("a+b");
    expect(view.hasFocus).toBe(true);
    view.dispatch({ selection: { anchor: 9 } });
    await settle();
    expect(document.querySelector(".cm-fub-math-popover-preview")).toBeNull();
  });
});
