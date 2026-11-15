// @vitest-environment happy-dom
//
// La riga dei suggerimenti, dal lato dell'editor (T14): per ogni cosa che si
// sta facendo, il contesto che la Live pubblica. Un test per contesto, la
// lingua inglese, e il plugin che apre la fonte col fuoco e la chiude con sé.
import { afterEach, describe, expect, it, vi } from "vitest";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { currentHints, resetHintSources, type HintContext, type HintItem } from "../../../../shells/scrittoio/frame/hints-row";
import { blocksMode } from "./blocks";
import { selectCursorBlock } from "./blocks/selection";
import { markdownGrammar } from "./grammar";
import { liveHints, markdownHints } from "./hints";
import { openSlashAt, openSlashMenu, slashMenuExtension, type SlashMenuSource } from "./slash";

const views: EditorView[] = [];
afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  document.body.replaceChildren();
  resetHintSources();
  vi.unstubAllGlobals();
});

const slashMenu: SlashMenuSource = {
  enabled: () => true,
  panel: () => ({ dom: document.createElement("div"), listId: "lista", update() {}, key: () => false, placed() {}, close() {} }),
  choose() {},
};

/// Un editor vero: `|` è il cursore, `‹` e `›` una selezione.
function mount(spec: string, extra: Extension = []): EditorView {
  const anchor = spec.includes("‹") ? spec.indexOf("‹") : spec.indexOf("|");
  const head = spec.includes("›") ? spec.indexOf("›") - 1 : anchor;
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc: spec.replace(/[|‹›]/g, ""),
      selection: EditorSelection.single(anchor, head),
      extensions: [markdown({ base: markdownGrammar }), slashMenuExtension(slashMenu), extra],
    }),
  });
  ensureSyntaxTree(view.state, view.state.doc.length, 1000);
  view.dispatch({});
  views.push(view);
  return view;
}

const FOCUSED = { editor: true, title: false };
const hints = (view: EditorView, focus = FOCUSED, slash = true): HintContext | null => markdownHints(view.state, focus, slash);
/// Ciò che ogni voce nomina: il comando, o i tasti.
const named = (context: HintContext | null): string[] =>
  (context?.items ?? []).map((item: HintItem) => ("command" in item ? item.command : item.keys.join("+")));

describe("i contesti della Live", () => {
  it("su una riga qualunque: il «/», la @, lo spazio comandi e Esc che sceglie il blocco", () => {
    const view = mount("prima\n|\ndopo", blocksMode({ page: () => "Nota" }));
    const context = hints(view);
    expect(context?.id).toBe("text");
    expect(named(context)).toEqual(["/", "@", "shell.switcher", "Escape"]);
    expect(context?.items.map((item) => item.say)).toEqual(["inserisce un blocco", "persone e date", "cerca o esegue", "seleziona il blocco"]);
  });

  it("senza il «/» nelle Preferenze e senza i Blocchi le due voci non ci sono", () => {
    const view = mount("prima\n|");
    expect(named(hints(view, FOCUSED, false))).toEqual(["@", "shell.switcher"]);
  });

  it("col testo scelto: grassetto, corsivo e collega, con gli accordi dell'editor", () => {
    const view = mount("una ‹parola› qui");
    const context = hints(view);
    expect(context?.id).toBe("selection");
    expect(context?.items).toEqual([
      { command: "markdown.bold", chord: "Mod-b", say: "grassetto" },
      { command: "markdown.italic", chord: "Mod-i", say: "corsivo" },
      { command: "markdown.wikilink", chord: "Mod-k", say: "collega" },
    ]);
  });

  it("su un compito: spunta, la data che diventa scadenza, il rientro", () => {
    const view = mount("- [ ] comprare| il pane");
    const context = hints(view);
    expect(context?.id).toBe("task");
    expect(named(context)).toEqual(["Mod-Enter", "@", "markdown.list.indent"]);
  });

  it("su un link: l'anteprima col modificatore, Alt Invio lo apre", () => {
    expect(hints(mount("vedi [[No|ta]] qui"))?.id).toBe("link");
    const web = hints(mount("vedi [il si|to](https://example.org)"));
    expect(web?.id).toBe("link");
    expect(named(web)).toEqual(["Mod", "Alt-Enter"]);
  });

  it("con i blocchi scelti: scegli, allarga, sposta, duplica, elimina, scrivi", () => {
    const view = mount("Uno|\n\nDue", blocksMode({ page: () => "Nota" }));
    selectCursorBlock(view);
    const context = hints(view);
    expect(context?.id).toBe("blocks");
    expect(named(context)).toEqual([
      "ArrowUp+ArrowDown", "Shift-ArrowUp+Shift-ArrowDown", "Mod-Shift-ArrowUp+Mod-Shift-ArrowDown", "Mod-d", "Delete", "Enter",
    ]);
  });

  it("sul titolo della pagina: Invio rinomina, ↓ scende, Esc lascia il nome", () => {
    const view = mount("Testo|");
    const context = hints(view, { editor: false, title: true });
    expect(context?.id).toBe("title");
    expect(named(context)).toEqual(["Enter", "ArrowDown", "Escape"]);
  });

  it("col «/» aperto: i tasti del menu", () => {
    const view = mount("Testo\n/|");
    openSlashAt(view, view.state.selection.main.head - 1);
    expect(openSlashMenu(view.state)).not.toBeNull();
    const context = hints(view);
    expect(context?.id).toBe("slash");
    expect(named(context)).toEqual(["ArrowUp+ArrowDown", "Enter", "Tab", "Escape", "Mod-/"]);
  });

  it("senza fuoco, o in sola lettura, l'editor non dice niente", () => {
    expect(hints(mount("Testo|"), { editor: false, title: false })).toBeNull();
    expect(hints(mount("Testo|", EditorState.readOnly.of(true)))).toBeNull();
  });

  it("in inglese le frasi sono inglesi", () => {
    vi.stubGlobal("navigator", { ...navigator, language: "en-US", platform: "Linux" });
    const view = mount("una ‹parola› qui");
    expect(hints(view)?.items.map((item) => item.say)).toEqual(["bold", "italic", "links"]);
  });
});

describe("il plugin della Live", () => {
  it("apre la fonte, la porta in cima col fuoco e la chiude quando l'editor se ne va", () => {
    const first = mount("prima\n|", liveHints(() => true));
    const second = mount("una ‹parola› qui", liveHints(() => true));
    expect(currentHints()).toBeNull();
    first.focus();
    expect(first.hasFocus).toBe(true);
    expect(currentHints()?.id).toBe("text");
    second.focus();
    expect(currentHints()?.id).toBe("selection");
    second.destroy();
    views.splice(views.indexOf(second), 1);
    first.focus();
    expect(currentHints()?.id).toBe("text");
    first.destroy();
    views.splice(views.indexOf(first), 1);
    expect(currentHints()).toBeNull();
  });
});
