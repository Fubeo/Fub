// @vitest-environment happy-dom
import { markdown } from "@codemirror/lang-markdown";
import { EditorState, Prec } from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeTooltip } from "../../../../ui/tooltip";
import { liveReveal, mathClassic } from "../../live-reveal";
import { markdownGrammar } from "./grammar";
import { livePreview } from "./livepreview";
import { parsedView } from "./test-support";

// La formula rotta nel riquadro classico di Vim (`mathClassic`): la sua
// anteprima dice l'errore con la frase di `explain`, come in lettura, e non il
// messaggio di KaTeX. Qui KaTeX è vero: il suo errore è quello che la frase deve
// tradurre. Il resto del riquadro di Vim sta in `math-live.dom.test.ts`.

beforeEach(() => {
  // KaTeX non disegna in quirks mode, e happy-dom non dice il suo modo.
  Object.defineProperty(document, "compatMode", { configurable: true, value: "CSS1Compat" });
});

const views: EditorView[] = [];
afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  document.body.replaceChildren();
  closeTooltip();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, "compatMode");
});

function mount(doc: string, anchor: number): EditorView {
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      selection: { anchor },
      extensions: [markdown({ base: markdownGrammar }), livePreview({ openWikilink() {}, searchTag() {} }), Prec.highest(liveReveal.of("mai")), mathClassic.of(true)],
    }),
  });
  parsedView(view);
  views.push(view);
  return view;
}

const press = (view: EditorView, key: string) => runScopeHandlers(view, new KeyboardEvent("keydown", { key }), "editor");

/// L'anteprima del riquadro di Vim quando KaTeX dice che la formula non si legge.
async function brokenPreview(): Promise<HTMLElement> {
  const formula = () => document.querySelector<HTMLElement>(".cm-fub-math-popover-preview .math-inline");
  await vi.waitFor(() => expect(formula()?.dataset.state).toBe("error"));
  return formula()!;
}

/// Il suggerimento come lo vede chi passa sull'anteprima: dopo il ritardo.
async function tooltipOf(formula: HTMLElement): Promise<string | null> {
  formula.dispatchEvent(new MouseEvent("mouseenter", { clientX: 4, clientY: 4 }));
  const tip = () => document.querySelector<HTMLElement>('[role="tooltip"]');
  await vi.waitFor(() => expect(tip()?.hidden).toBe(false));
  return tip()?.textContent ?? null;
}

describe("il riquadro classico di Vim con una formula rotta", () => {
  it("l'anteprima dice la frase di `explain`, non il messaggio di KaTeX", async () => {
    const view = mount("x $\\frac{a}$ y", 2);
    view.focus();
    expect(press(view, "ArrowRight")).toBe(true);
    const formula = await brokenPreview();
    expect(formula.getAttribute("aria-label")).toBe("Formula non disponibile: A \\frac manca un pezzo.");
    expect(await tooltipOf(formula)).toBe("Formula non disponibile: A \\frac manca un pezzo.");
  });

  it("in inglese la stessa frase, nella lingua di chi guarda", async () => {
    vi.stubGlobal("navigator", { language: "en-US" });
    const view = mount("x $\\frac{a}$ y", 2);
    view.focus();
    expect(press(view, "ArrowRight")).toBe(true);
    const formula = await brokenPreview();
    expect(formula.getAttribute("aria-label")).toBe("Formula unavailable: \\frac is missing a piece.");
    expect(await tooltipOf(formula)).toBe("Formula unavailable: \\frac is missing a piece.");
  });
});
