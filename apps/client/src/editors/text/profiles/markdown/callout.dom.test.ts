// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState, Prec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdownGrammar } from "./grammar";
import { livePreview } from "./livepreview";
import { liveReveal, type RevealPolicy } from "../../live-reveal";
import { calloutHead, CALLOUT_HEAD } from "./callout-head";
import { setCalloutType, toggleCalloutFold } from "./callout";

// Il callout resta un riquadro col cursore dentro (D1).

const views: EditorView[] = [];
afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  document.body.replaceChildren();
});

function mount(doc: string, anchor: number, policy: RevealPolicy = "mai"): EditorView {
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc, selection: { anchor },
      extensions: [markdown({ base: markdownGrammar }), livePreview({ openWikilink() {}, searchTag() {} }), Prec.highest(liveReveal.of(policy))],
    }),
  });
  ensureSyntaxTree(view.state, view.state.doc.length, 1000);
  view.dispatch({});
  views.push(view);
  return view;
}
const SOURCE = "Prima\n\n> [!tip]- Consiglio\n> Il tram 28.\n\nDopo";

describe("la testata", () => {
  it("una sola espressione per Lettura e Live", () => {
    expect(CALLOUT_HEAD.exec("[!tip]- Consiglio")?.slice(1)).toEqual(["tip", "-", "Consiglio"]);
    const head = calloutHead("> [!Warning]+ Attento")!;
    expect(head.type).toBe("warning");
    expect(head.fold).toBe("+");
    expect("> [!Warning]+ Attento".slice(head.title.from, head.title.to)).toBe("Attento");
  });

  it("il tipo e la ripiegatura cambiano soltanto i loro byte", () => {
    const state = EditorState.create({ doc: SOURCE });
    const at = SOURCE.indexOf("[!");
    expect(state.update(setCalloutType(state, at, "warning")!).state.doc.toString()).toBe(SOURCE.replace("[!tip]", "[!warning]"));
    expect(state.update(toggleCalloutFold(state, at)!).state.doc.toString()).toBe(SOURCE.replace("]-", "]+"));
  });
});

describe("in Live", () => {
  it("con `mai` le righe hanno il riquadro del tipo e la testata è la pastiglia", () => {
    mount(SOURCE, SOURCE.indexOf("tram"));
    const lines = [...document.querySelectorAll(".cm-fub-callout-line")];
    expect(lines).toHaveLength(2);
    expect(lines.every((line) => line.getAttribute("data-callout") === "tip")).toBe(true);
    expect(document.querySelector(".cm-fub-callout-type")?.textContent).toBe("Tip");
    expect(document.querySelector(".cm-fub-callout-fold")?.getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector(".cm-fub-callout-title")?.textContent).toBe("Consiglio");
    expect(document.querySelector(".cm-content")!.textContent).not.toContain("[!tip]");
  });

  it("il menu dei tipi riscrive il tipo, e la freccia la ripiegatura", () => {
    const view = mount(SOURCE, SOURCE.indexOf("tram"));
    document.querySelector<HTMLButtonElement>(".cm-fub-callout-type")!.click();
    const items = [...document.querySelectorAll<HTMLElement>('.cm-fub-callout-menu [role="menuitemradio"]')];
    expect(items).toHaveLength(13);
    items.find((item) => item.textContent === "Warning")!.click();
    expect(view.state.doc.toString()).toBe(SOURCE.replace("[!tip]", "[!warning]"));
    document.querySelector<HTMLButtonElement>(".cm-fub-callout-fold")!.click();
    expect(view.state.doc.toString()).toContain("[!warning]+ Consiglio");
  });

  it("con `elemento` la sorgente torna col cursore nel prefisso", () => {
    const view = mount(SOURCE, SOURCE.indexOf("tram"), "elemento");
    expect(document.querySelector(".cm-fub-callout-type")).not.toBeNull();
    view.dispatch({ selection: { anchor: SOURCE.indexOf("[!") + 2 } });
    expect(document.querySelector(".cm-fub-callout-type")).toBeNull();
    expect(document.querySelector(".cm-content")!.textContent).toContain("[!tip]-");
  });
});
