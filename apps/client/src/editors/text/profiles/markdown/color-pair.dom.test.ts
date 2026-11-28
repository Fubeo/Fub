// @vitest-environment happy-dom
//
// «/Colore» su una riga vuota, nella Live: il colore aspetta la prima
// lettera in una coppia vuota che non si vede, come Mod-b. Se si scrive, il
// testo nasce colorato; se il cursore esce o Esc rinuncia, nel file non resta
// un `<span class="fub-color-…"></span>` vuoto.
import { afterEach, describe, expect, it } from "vitest";
import { markdown } from "@codemirror/lang-markdown";
import { EditorSelection, Prec } from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { createTextEngine } from "../../engine";
import { liveReveal } from "../../live-reveal";
import { emptyPairsOf } from "./empty-pair";
import { markdownGrammar } from "./grammar";
import { livePreview } from "./livepreview";
import { runSlashAction } from "./slash";

const GRAY = '<span class="fub-color-gray">';
let cleanup: (() => void) | null = null;

afterEach(() => {
  cleanup?.();
  cleanup = null;
});

/// La Live con «/Colore» già scritto in fondo alla nota, e il secondo Invio
/// del passo che sceglie il grigio: è `runSlashAction`, come in `surface.ts`.
function colored(): EditorView {
  const parent = document.createElement("div");
  document.body.append(parent);
  const engine = createTextEngine(parent, {
    onChange() {},
    onSelectionChange() {},
    extensions: () => [
      markdown({ base: markdownGrammar }),
      Prec.highest(liveReveal.of("mai")),
      livePreview({ openWikilink() {}, searchTag() {} }),
    ],
  });
  cleanup = () => { engine.destroy(); parent.remove(); };
  engine.setDoc("uno\n/Colore");
  const view = EditorView.findFromDOM(parent.querySelector<HTMLElement>(".cm-editor")!)!;
  view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length) });
  expect(runSlashAction(view, "markdown.color.gray", 4, view.state.doc.length)).toBe(true);
  return view;
}

function type(view: EditorView, text: string): void {
  const { from, to } = view.state.selection.main;
  const insert = () => view.state.update(view.state.replaceSelection(text), { userEvent: "input.type" });
  for (const handler of view.state.facet(EditorView.inputHandler)) {
    if (handler(view, from, to, text, insert)) return;
  }
  view.dispatch(insert());
}

describe("«/Colore» senza testo da colorare", () => {
  it("apre una coppia vuota che aspetta la prima lettera, col cursore dentro", () => {
    const view = colored();
    expect(view.state.doc.toString()).toBe(`uno\n${GRAY}</span>`);
    expect(view.state.selection.main.head).toBe(4 + GRAY.length);
    expect(emptyPairsOf(view.state)).toHaveLength(1);
  });

  it("la prima lettera nasce colorata", () => {
    const view = colored();
    type(view, "d");
    type(view, "ue");
    expect(view.state.doc.toString()).toBe(`uno\n${GRAY}due</span>`);
  });

  it("Esc senza scrivere non lascia niente nel file", () => {
    const view = colored();
    runScopeHandlers(view, new KeyboardEvent("keydown", { key: "Escape" }), "editor");
    expect(view.state.doc.toString()).toBe("uno\n");
    expect(emptyPairsOf(view.state)).toHaveLength(0);
  });

  it("il cursore che esce senza scrivere non lascia niente nel file", () => {
    const view = colored();
    view.dispatch({ selection: EditorSelection.cursor(1) });
    expect(view.state.doc.toString()).toBe("uno\n");
  });
});
