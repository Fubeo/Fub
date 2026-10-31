// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { EditorSelection, EditorState, Prec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { markdownGrammar } from "./grammar";
import { livePreview } from "./livepreview";
import { liveReveal, type RevealPolicy } from "../../live-reveal";
import { setDetailsDefault, setDetailsOpen } from "./details-live";

// Il ripiegabile in Live (K2): la freccia e il sommario, i tag nascosti, il
// contenuto rientrato; aperto o chiuso è della vista.

const NOTE = "Sopra.\n\n<details>\n<summary>Ingredienti</summary>\n\n- farina\n- acqua\n\n</details>\n\nSotto.";

const views: EditorView[] = [];
afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  document.body.replaceChildren();
});

function mount(doc: string, anchor = 0, policy: RevealPolicy = "mai"): EditorView {
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

const text = (view: EditorView) => view.contentDOM.textContent ?? "";
const arrow = (view: EditorView) => view.contentDOM.querySelector<HTMLButtonElement>(".cm-fub-details-arrow");

describe("il ripiegabile in Live", () => {
  it("chiuso mostra soltanto il sommario con la freccia", () => {
    const view = mount(NOTE);
    expect(text(view)).toContain("Ingredienti");
    expect(text(view)).not.toContain("details");
    expect(text(view)).not.toContain("summary");
    expect(text(view)).not.toContain("farina");
    expect(text(view)).toContain("Sotto.");
    expect(arrow(view)?.getAttribute("aria-expanded")).toBe("false");
    // Il documento resta quello scritto.
    expect(view.state.doc.toString()).toBe(NOTE);
  });

  it("la freccia apre e chiude nella vista, senza scrivere", () => {
    const view = mount(NOTE);
    arrow(view)!.click();
    expect(text(view)).toContain("farina");
    expect(text(view)).not.toContain("</details>");
    expect(arrow(view)?.getAttribute("aria-expanded")).toBe("true");
    const body = [...view.contentDOM.querySelectorAll<HTMLElement>(".cm-fub-details-body")].map((line) => line.textContent);
    // Le righe vuote intorno al contenuto non si vedono.
    expect(body).toEqual(["- farina", "- acqua"]);
    arrow(view)!.click();
    expect(text(view)).not.toContain("farina");
    expect(view.state.doc.toString()).toBe(NOTE);
  });

  it("`open` lo apre, e un cursore che entra lo apre", () => {
    expect(text(mount(NOTE.replace("<details>", "<details open>")))).toContain("farina");
    const view = mount(NOTE);
    view.dispatch({ selection: EditorSelection.cursor(NOTE.indexOf("acqua")) });
    expect(text(view)).toContain("acqua");
    // Chiuderlo col cursore dentro lo riporta al sommario.
    arrow(view)!.click();
    expect(view.state.selection.main.head).toBe(NOTE.indexOf("</summary>"));
    expect(text(view)).not.toContain("acqua");
  });

  it("gli annidati rientrano di più", () => {
    const doc = "<details open>\n<summary>Fuori</summary>\n\nUno\n\n<details open>\n<summary>Dentro</summary>\n\nDue\n\n</details>\n\n</details>";
    const view = mount(doc);
    const depth = (word: string) => [...view.contentDOM.querySelectorAll<HTMLElement>(".cm-line")].find((line) => line.textContent === word)?.dataset.detailsDepth;
    expect(depth("Uno")).toBe("1");
    expect(depth("Due")).toBe("2");
    expect(text(view)).not.toContain("details");
    view.dispatch({ effects: setDetailsOpen.of({ at: doc.indexOf("<details open>\n<summary>Dentro"), open: false }) });
    expect(text(view)).not.toContain("Due");
    expect(text(view)).toContain("Dentro");
  });

  it("«Aperto di norma» scrive soltanto `open` sul tag, e la vista lo segue", () => {
    const view = mount(NOTE);
    const at = NOTE.indexOf("<details>");
    view.dispatch(setDetailsDefault(view.state, at, true)!);
    expect(view.state.doc.toString()).toBe(NOTE.replace("<details>", "<details open>"));
    expect(text(view)).toContain("farina");
    expect(setDetailsDefault(view.state, at, true)).toBeNull();
    view.dispatch(setDetailsDefault(view.state, at, false)!);
    expect(view.state.doc.toString()).toBe(NOTE);
    expect(text(view)).not.toContain("farina");
  });

  it("senza chiusura resta sorgente, con l'ondulato", () => {
    const view = mount("<details>\n<summary>Solo</summary>\n\nTesto");
    expect(arrow(view)).toBeNull();
    expect(text(view)).toContain("<details>");
    expect(view.contentDOM.querySelector(".cm-fub-wavy")?.textContent).toBe("<details>");
  });

  it("con `elemento` l'apertura torna sorgente col cursore sopra", () => {
    const view = mount(NOTE, NOTE.indexOf("Ingredienti"), "elemento");
    expect(text(view)).toContain("<summary>Ingredienti</summary>");
    view.dispatch({ selection: EditorSelection.cursor(0) });
    expect(text(view)).not.toContain("<summary>");
  });
});
