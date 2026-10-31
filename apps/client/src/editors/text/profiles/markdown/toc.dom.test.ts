// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { EditorState, Prec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { markdownGrammar } from "./grammar";
import { livePreview } from "./livepreview";
import { liveReveal } from "../../live-reveal";
import { renderMarkdown } from "./render";
import { tocLevels } from "./toc";

// L'indice (K4): i titoli della nota al posto del recinto ```toc```.

const tocOf = (source: string) => {
  const root = document.createElement("div");
  root.innerHTML = renderMarkdown(source).html;
  const toc = root.querySelector(".fub-toc");
  return {
    toc,
    items: [...root.querySelectorAll(".fub-toc-item")].map((item) => `${item.getAttribute("data-depth")}:${item.textContent}>${item.querySelector("a")?.getAttribute("href")}`),
    ids: [...root.querySelectorAll("h1, h2, h3, h4")].map((heading) => heading.id),
  };
};

describe("l'indice", () => {
  it("elenca i titoli col loro id, rientrati per livello", () => {
    const { items, ids } = tocOf("# Viaggio\n\n```toc\n```\n\n## Il *mare*\n\n### Spiagge\n\n## Il mare\n\n## Monti ^alti");
    expect(items).toEqual(["0:Viaggio>#viaggio", "1:Il mare>#il-mare", "2:Spiagge>#spiagge", "1:Il mare>#il-mare-1", "1:Monti>#alti"]);
    expect(ids).toEqual(["viaggio", "il-mare", "spiagge", "il-mare-1", "alti"]);
  });

  it("`livelli: 2-3` tiene quei livelli, e il più alto non rientra", () => {
    const { items } = tocOf("# A\n\n```toc\nlivelli: 2-3\n```\n\n## B\n\n### C\n\n#### D");
    expect(items).toEqual(["0:B>#b", "1:C>#c"]);
    expect(tocOf("# A\n\n```toc\nlevels: 1\n```\n\n## B").items).toEqual(["0:A>#a"]);
  });

  it("senza titoli lo dice, e il recinto non resta codice", () => {
    const { toc } = tocOf("```toc\n```\n\nTesto");
    expect(toc?.getAttribute("data-empty")).toBe("true");
    expect(toc?.textContent).toContain("titoli");
    expect(renderMarkdown("```toc\n```").html).not.toContain("<pre");
  });

  it("i livelli si leggono anche al contrario; una riga che non si legge li lascia tutti", () => {
    expect(tocLevels("livelli: 3-2")).toEqual([2, 3]);
    expect(tocLevels("livelli: sette")).toEqual([1, 6]);
    expect(tocLevels("")).toEqual([1, 6]);
  });

  it("un titolo che cambia livello rifà l'indice anche quando la resa riusa i blocchi", () => {
    const first = renderMarkdown("```toc\n```\n\n## A\n\n## B");
    const second = renderMarkdown("```toc\n```\n\n## A\n\n### B");
    expect(first.html).toContain('data-depth="0"><a href="#b"');
    expect(second.html).toContain('data-depth="1"><a href="#b"');
  });
});

describe("l'indice in Live", () => {
  const views: EditorView[] = [];
  afterEach(() => {
    for (const view of views.splice(0)) view.destroy();
    document.body.replaceChildren();
  });

  it("è reso fuori dal cursore e segue i titoli mentre si scrive", () => {
    const doc = "```toc\n```\n\n## Uno\n\n## Due";
    const view = new EditorView({
      parent: document.body,
      state: EditorState.create({
        doc,
        selection: { anchor: doc.length },
        extensions: [markdown({ base: markdownGrammar }), livePreview({ openWikilink() {}, searchTag() {} }), Prec.highest(liveReveal.of("mai"))],
      }),
    });
    views.push(view);
    const settle = () => { ensureSyntaxTree(view.state, view.state.doc.length, 1000); view.dispatch({}); };
    settle();
    const items = () => [...view.dom.querySelectorAll(".fub-toc-item")].map((item) => `${item.getAttribute("data-depth")}:${item.textContent}`);
    expect(items()).toEqual(["0:Uno", "0:Due"]);
    view.dispatch({ changes: { from: doc.indexOf("## Due"), insert: "#" } });
    settle();
    expect(items()).toEqual(["0:Uno", "1:Due"]);
    view.dispatch({ changes: { from: view.state.doc.length, insert: " e tre" } });
    settle();
    expect(items()).toEqual(["0:Uno", "1:Due e tre"]);
    // Il clic su una voce porta il cursore al titolo, e l'indice resta reso.
    const link = [...view.dom.querySelectorAll<HTMLElement>(".fub-toc a")].find((a) => a.textContent === "Uno")!;
    link.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
    expect(view.state.selection.main.head).toBe(view.state.doc.toString().indexOf("Uno"));
    settle();
    expect(view.dom.querySelector(".fub-toc")).not.toBeNull();
  });
});
