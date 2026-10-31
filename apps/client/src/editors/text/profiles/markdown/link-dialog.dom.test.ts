// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { markdownGrammar } from "./grammar";
import { isAddress, linkAt, linkDialog, linkSyntax } from "./link-dialog";
import { markdownEditingExtensions } from "./commands";

function stateOf(doc: string) {
  const state = EditorState.create({ doc, extensions: markdown({ base: markdownGrammar }) });
  ensureSyntaxTree(state, state.doc.length, 1000);
  return state;
}

describe("che cosa scrive il riquadro", () => {
  it("una nota diventa wikilink, un indirizzo un link Markdown", () => {
    expect(linkSyntax("", "Viaggio")).toBe("[[Viaggio]]");
    expect(linkSyntax("Viaggio", "Viaggio")).toBe("[[Viaggio]]");
    expect(linkSyntax("il viaggio", "Viaggio")).toBe("[[Viaggio|il viaggio]]");
    expect(linkSyntax("sito", "https://esempio.it")).toBe("[sito](https://esempio.it)");
    expect(linkSyntax("", "www.esempio.it")).toBe("[www.esempio.it](https://www.esempio.it)");
    expect(linkSyntax("a [b]", "https://x.it/a b")).toBe("[a \\[b\\]](<https://x.it/a b>)");
    expect(isAddress("mailto:a@b.it")).toBe(true);
    expect(isAddress("Diario/Oggi")).toBe(false);
  });

  it("trova il collegamento sotto il cursore, link o wikilink", () => {
    const doc = "a [testo](https://x.it) b [[Nota|alias]] c ![[foto.png]]";
    expect(linkAt(stateOf(doc), { from: 4, to: 4 })).toEqual({ from: 2, to: 23, kind: "markdown", text: "testo", target: "https://x.it" });
    expect(linkAt(stateOf(doc), { from: 30, to: 30 })).toEqual({ from: 26, to: 40, kind: "wikilink", text: "alias", target: "Nota" });
    expect(linkAt(stateOf(doc), { from: 50, to: 50 })).toBeNull();
    expect(linkAt(stateOf(doc), { from: 0, to: 0 })).toBeNull();
  });
});

describe("il riquadro «Collegamento»", () => {
  const views: EditorView[] = [];
  afterEach(() => {
    for (const view of views.splice(0)) view.destroy();
    document.body.replaceChildren();
  });

  function mount(doc: string, anchor: number, head = anchor) {
    const view = new EditorView({
      parent: document.body,
      state: EditorState.create({
        doc,
        selection: { anchor, head },
        extensions: [markdown({ base: markdownGrammar }), linkDialog(async (prefix) => ["Viaggio", "Viaggio a Lisbona"].filter((n) => n.startsWith(prefix))), markdownEditingExtensions()],
      }),
    });
    views.push(view);
    const pressK = () => runScopeHandlers(view, new KeyboardEvent("keydown", { key: "k", ctrlKey: true }), "editor");
    return { view, pressK };
  }
  const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!;
  const field = (index: number) => dialog().querySelectorAll<HTMLInputElement>("input")[index]!;
  const action = (id: string) => dialog().querySelector<HTMLButtonElement>(`[data-action="${id}"]`)!;
  const settle = () => new Promise((done) => setTimeout(done, 0));

  it("sulla selezione: il testo c'è, si scrive la nota, si applica un wikilink", async () => {
    const { view, pressK } = mount("vai al viaggio oggi", 7, 14);
    expect(pressK()).toBe(true);
    expect(field(0).value).toBe("viaggio");
    field(1).value = "Viaggio";
    field(1).dispatchEvent(new Event("input"));
    expect(dialog().querySelector("code")?.textContent).toBe("[[Viaggio|viaggio]]");
    action("apply").click();
    await settle();
    expect(view.state.doc.toString()).toBe("vai al [[Viaggio|viaggio]] oggi");
  });

  it("un indirizzo diventa un link Markdown", async () => {
    const { view, pressK } = mount("vedi sito qui", 5, 9);
    pressK();
    field(1).value = "https://esempio.it";
    field(1).dispatchEvent(new Event("input"));
    action("apply").click();
    await settle();
    expect(view.state.doc.toString()).toBe("vedi [sito](https://esempio.it) qui");
  });

  it("su un collegamento lo modifica, o lo toglie lasciando il testo", async () => {
    const first = mount("a [testo](https://x.it) b", 4);
    first.pressK();
    expect(field(1).value).toBe("https://x.it");
    field(1).value = "https://y.it";
    field(1).dispatchEvent(new Event("input"));
    action("apply").click();
    await settle();
    expect(first.view.state.doc.toString()).toBe("a [testo](https://y.it) b");

    const second = mount("a [[Nota|alias]] b", 6);
    second.pressK();
    action("remove").click();
    await settle();
    expect(second.view.state.doc.toString()).toBe("a alias b");
  });

  it("le note che corrispondono si propongono, e una scelta riempie il campo", async () => {
    const { pressK } = mount("x", 1);
    pressK();
    field(1).value = "Viag";
    field(1).dispatchEvent(new Event("input"));
    await settle();
    const notes = Array.from(dialog().querySelectorAll<HTMLButtonElement>(".md-link-dialog-note"), (b) => b.textContent);
    expect(notes).toEqual(["Viaggio", "Viaggio a Lisbona"]);
    dialog().querySelector<HTMLButtonElement>(".md-link-dialog-note")!.click();
    expect(field(1).value).toBe("Viaggio");
  });

  it("Annulla non tocca il testo, e il riquadro si chiude con la vista", async () => {
    const { view, pressK } = mount("abc", 1);
    pressK();
    action("cancel").click();
    await settle();
    expect(view.state.doc.toString()).toBe("abc");
    pressK();
    expect(dialog()).not.toBeNull();
    view.destroy();
    views.length = 0;
    await settle();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
