// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { EditorSelection, EditorState, Prec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { markdownGrammar } from "./grammar";
import { livePreview } from "./livepreview";
import { liveReveal } from "../../live-reveal";
import { renderMarkdown } from "./render";

// Le colonne (K3): `[!columns]` con da due a quattro `[!column]`.

const NOTE = "> [!columns]\n> > [!column]\n> > Uno **forte**\n>\n> > [!column]\n> > Due\n\nDopo";

describe("le colonne in Lettura", () => {
  it("una griglia con una colonna per `[!column]`", () => {
    const html = renderMarkdown(NOTE).html;
    expect(html).toMatch(/^<div class="fub-columns" data-columns="2" data-md-from="0" data-md-to="\d+"><div class="fub-column"/);
    const root = document.createElement("div");
    root.innerHTML = html;
    const columns = [...root.querySelectorAll(".fub-columns > .fub-column")].map((column) => column.textContent?.trim());
    expect(columns).toEqual(["Uno forte", "Due"]);
    expect(root.querySelector(".fub-column strong")?.textContent).toBe("forte");
    expect(html).not.toContain("[!column]");
  });

  it("una sola colonna, più di quattro, o altro dentro, restano un callout", () => {
    const one = "> [!columns]\n> > [!column]\n> > Uno";
    const five = `> [!columns]\n${Array.from({ length: 5 }, (_, i) => `> > [!column]\n> > ${i}`).join("\n>\n")}`;
    const mixed = "> [!columns]\n> > [!column]\n> > Uno\n>\n> Testo\n>\n> > [!column]\n> > Due";
    for (const source of [one, five, mixed]) {
      const html = renderMarkdown(source).html;
      expect(html).not.toContain("fub-columns");
      expect(html).toContain('class="callout"');
    }
  });
});

describe("le colonne in Live", () => {
  const views: EditorView[] = [];
  afterEach(() => {
    for (const view of views.splice(0)) view.destroy();
    document.body.replaceChildren();
  });
  const mount = (anchor: number) => {
    const view = new EditorView({
      parent: document.body,
      state: EditorState.create({
        doc: NOTE,
        selection: { anchor },
        extensions: [markdown({ base: markdownGrammar }), livePreview({ openWikilink() {}, searchTag() {} }), Prec.highest(liveReveal.of("mai"))],
      }),
    });
    ensureSyntaxTree(view.state, view.state.doc.length, 1000);
    view.dispatch({});
    views.push(view);
    return view;
  };

  it("fuori dal cursore è la griglia della Lettura", () => {
    const view = mount(NOTE.length);
    expect(view.dom.querySelector(".cm-markdown-block .fub-columns")?.getAttribute("data-columns")).toBe("2");
  });

  it("col cursore dentro le colonne stanno una sotto l'altra, con l'etichetta", () => {
    const view = mount(NOTE.indexOf("Due"));
    const labels = [...view.contentDOM.querySelectorAll(".cm-fub-column-label")].map((label) => label.textContent);
    expect(labels).toEqual(["Colonne", "Colonna 1", "Colonna 2"]);
    expect(view.contentDOM.querySelector(".cm-fub-callout-type")).toBeNull();
    expect(view.contentDOM.textContent).not.toContain("[!column]");
    view.dispatch({ selection: EditorSelection.cursor(NOTE.length) });
    expect(view.contentDOM.querySelector(".cm-fub-column-label")).toBeNull();
  });
});
