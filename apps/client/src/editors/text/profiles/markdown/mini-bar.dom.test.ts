// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import type { CommandSpec } from "../../../../host/contract";
import { mountMarkdownSurface, type MarkdownSurface } from "./surface";
import { registerFormatIcons } from "../../../../panels/format-bar";
import { COMMENT_ACTION, createMiniBar, LINK_ACTION } from "../../../../panels/mini-bar";
import { closeContextMenu } from "../../../../ui/menu";

// La mini-barra (`panels/mini-bar.ts`) su una nota vera: qui perché la prova
// preme i tasti sulla vista di CodeMirror, che fuori dal pacchetto testuale
// non si importa.

// Il primo commento chiede chi firma (T22): le impostazioni sono finte.
vi.mock("../../../../host/query", async (original) => ({
  ...(await original<typeof import("../../../../host/query")>()),
  settings: async () => [
    { spec: { key: "profile.name" }, value: "Anna Bianchi" },
    { spec: { key: "comments.author" }, value: "nome" },
  ],
}));
vi.mock("mermaid", () => ({
  default: { initialize() {}, render: async () => ({ svg: "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>" }) },
}));

function spec(id: string, title: string): CommandSpec {
  return {
    id, title, description: "", keybinding: null, params: [],
    scope: { writes: false, reach: "session", reversible: true }, surfaces: ["toolbar"],
  };
}

/// I comandi che «Trasforma» offre: quelli che il plugin dichiara.
const SPECS = [
  spec("text.undo", "Annulla"),
  spec("markdown.paragraph", "Paragrafo"),
  spec("markdown.heading.2", "Titolo 2"),
  spec("markdown.heading.3", "Titolo 3"),
  spec("markdown.quote", "Citazione"),
  spec("markdown.list.bullet", "Elenco puntato"),
  spec("markdown.bold", "Grassetto"),
  spec("markdown.link", "Link"),
];

// # Pulsante e scorciatoia
//
// Su una nota vera (la superficie Markdown), ogni pulsante deve dare ciò che
// dà la sua scorciatoia: lo stesso testo, e un solo passo d'annullamento che
// lo riporta com'era. Dove la scorciatoia non c'è (Trasforma, Colore) il
// confronto è col comando che la palette e il «/» eseguono.

/// L'evento di un accordo come lo scrive la superficie (`Mod-Shift-x`).
function chordEvent(chord: string): KeyboardEvent {
  const parts = chord.split("-");
  const key = parts.pop()!;
  const shift = parts.includes("Shift");
  // CodeMirror cerca `Shift-x` col tasto di base (`keyCode`), come fa il
  // browser vero: senza, un accordo con Maiusc non lo trova.
  const event = new KeyboardEvent("keydown", {
    key: shift && key.length === 1 ? key.toUpperCase() : key,
    ctrlKey: parts.includes("Mod") || parts.includes("Ctrl"),
    altKey: parts.includes("Alt"),
    shiftKey: shift,
    bubbles: true,
    cancelable: true,
  });
  const code = key === "`" ? 192 : key.toUpperCase().charCodeAt(0);
  Object.defineProperty(event, "keyCode", { value: code });
  return event;
}

interface Outcome {
  doc: string;
  /// Ciò che il gesto ha aperto (il riquadro «Collegamento», il primo
  /// commento): il suo testo, o `null`.
  opened: string | null;
  /// Il testo dopo un solo «Annulla».
  undone: string;
}

const SAMPLE = "Il concerto si tiene nella sala grande del teatro.\n";
const PICK = "sala grande";

let mounted: { surface: MarkdownSurface; parent: HTMLElement }[] = [];

function mountNote(mode: "live_preview" | "source"): { surface: MarkdownSurface; view: EditorView } {
  const parent = document.createElement("div");
  document.body.append(parent);
  const surface = mountMarkdownSurface({ paneId: "mini", documentId: "note/mini.md", parent }, {
    onChange: () => {},
    onSelectionChange: () => {},
    onOpenWikilink: () => {},
    onOpenWikilinkBeside: () => {},
    onOpenPath: () => {},
    onShowFile: () => {},
    onSearchTag: () => {},
    completions: { searchNotes: async () => [], listTags: async () => [] },
  });
  mounted.push({ surface, parent });
  surface.buffer.setDoc(SAMPLE);
  surface.setMode(mode);
  const from = SAMPLE.indexOf(PICK);
  const view = EditorView.findFromDOM(parent.querySelector<HTMLElement>(".cm-editor")!)!;
  // happy-dom manda `selectionchange` dentro l'aggiornamento di una vista a
  // fuoco, e CodeMirror rifiuta di rientrare (un browser non lo fa): la vista
  // resta senza fuoco, per i tasti come per la barra.
  (document.activeElement as HTMLElement | null)?.blur();
  surface.focus = () => {};
  view.dispatch({ selection: { anchor: from, head: from + PICK.length } });
  return { surface, view };
}

/// Ciò che si è aperto sopra la nota: un dialogo o un popover.
const openedText = (): string | null => {
  const opened = document.querySelector(".kit-popover, [role='dialog']");
  if (!opened) return null;
  const fields = [...opened.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")].map((field) => field.value);
  return [(opened.textContent ?? "").replace(/\s+/g, " ").trim(), ...fields].join(" | ");
};

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

async function outcome(mode: "live_preview" | "source", gesture: (surface: MarkdownSurface, view: EditorView) => void): Promise<Outcome> {
  const { surface, view } = mountNote(mode);
  gesture(surface, view);
  await settle();
  const doc = surface.buffer.getDoc();
  const opened = openedText();
  surface.editorActions.run("text.undo");
  const undone = surface.buffer.getDoc();
  for (const each of mounted) {
    each.surface.destroy();
    each.parent.remove();
  }
  mounted = [];
  closeContextMenu();
  document.body.innerHTML = '<div id="app"></div>';
  return { doc, opened, undone };
}

function clickOn(surface: MarkdownSurface, selector: string, then?: (selector: string) => void): void {
  const bar = createMiniBar({ surface: () => surface, writing: () => true, focusPane: () => {}, runCommand: () => {} });
  bar.update(SPECS);
  document.body.append(bar.element);
  bar.element.querySelector<HTMLButtonElement>(selector)!.click();
  then?.(selector);
}

describe("ogni pulsante fa ciò che fa la sua scorciatoia, su una nota vera", () => {
  let stop: () => void;
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    stop = registerFormatIcons();
  });
  afterEach(() => {
    stop();
    document.body.innerHTML = "";
  });

  const keyed = ["markdown.bold", "markdown.italic", "markdown.underline", "markdown.strikethrough", "markdown.code"];
  for (const action of keyed) {
    it(`${action}: lo stesso testo e lo stesso passo d'annullamento`, async () => {
      const byKeys = await outcome("live_preview", (surface, view) => {
        const chord = surface.editorActions.chord(action)!;
        expect(runScopeHandlers(view, chordEvent(chord), "editor")).toBe(true);
      });
      const byButton = await outcome("live_preview", (surface) => clickOn(surface, `[data-command='${action}']`));
      expect(byButton).toEqual(byKeys);
      expect(byButton.doc).not.toBe(SAMPLE);
      expect(byButton.undone).toBe(SAMPLE);
    });
  }

  it("Collega in Live: Mod-k e il pulsante aprono lo stesso riquadro «Collegamento»", async () => {
    const byKeys = await outcome("live_preview", (_surface, view) => {
      expect(runScopeHandlers(view, chordEvent("Mod-k"), "editor")).toBe(true);
    });
    const byButton = await outcome("live_preview", (surface) => clickOn(surface, `[data-command='${LINK_ACTION}']`));
    expect(byKeys.opened).toContain(PICK);
    expect(byButton).toEqual(byKeys);
  });

  it("Collega in Sorgente: Mod-k e il pulsante fanno lo stesso wikilink", async () => {
    const byKeys = await outcome("source", (_surface, view) => {
      expect(runScopeHandlers(view, chordEvent("Mod-k"), "editor")).toBe(true);
    });
    const byButton = await outcome("source", (surface) => clickOn(surface, `[data-command='${LINK_ACTION}']`));
    expect(byKeys.doc).toContain(`[[${PICK}]]`);
    expect(byButton).toEqual(byKeys);
  });

  it("Commenta: Ctrl Alt M e il pulsante aprono lo stesso primo messaggio sulla selezione", async () => {
    const byKeys = await outcome("live_preview", (surface, view) => {
      expect(runScopeHandlers(view, chordEvent(surface.editorActions.chord(COMMENT_ACTION)!), "editor")).toBe(true);
    });
    const byButton = await outcome("live_preview", (surface) => clickOn(surface, `[data-command='${COMMENT_ACTION}']`));
    expect(byKeys.opened).toContain(PICK);
    expect(byButton).toEqual(byKeys);
  });

  it("Trasforma: «Titolo 2» fa ciò che fa il comando", async () => {
    const byCommand = await outcome("live_preview", (surface) => surface.editorActions.run("markdown.heading.2"));
    const byButton = await outcome("live_preview", (surface) => clickOn(surface, "[data-command='mini-bar.transform']", () => {
      const item = [...document.querySelectorAll<HTMLElement>("#context-menu [role='menuitemradio']")]
        .find((each) => each.querySelector(".menu-label")?.textContent === "Titolo 2")!;
      item.click();
    }));
    expect(byCommand.doc.startsWith("## ")).toBe(true);
    expect(byButton).toEqual(byCommand);
  });

  it("Colore: un campione fa ciò che fa il comando del colore", async () => {
    const byCommand = await outcome("live_preview", (surface) => surface.editorActions.run("markdown.color.red"));
    const byButton = await outcome("live_preview", (surface) => clickOn(surface, "[data-command='mini-bar.color']", () => {
      document.querySelector<HTMLButtonElement>(".mini-bar-colors [data-command='markdown.color.red']")!.click();
    }));
    expect(byCommand.doc).not.toBe(SAMPLE);
    expect(byButton).toEqual(byCommand);
  });
});
