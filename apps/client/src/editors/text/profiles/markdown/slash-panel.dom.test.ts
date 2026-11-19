// @vitest-environment happy-dom
//
// Il menu «/» vero dentro l'editor vero, con le battute di una persona: ogni
// voce si scrive per intero lettera per lettera dopo una riga di testo, poi
// Invio subito o dopo una pausa. La voce si applica, oppure apre il suo
// passo (il riquadro, il linguaggio, la nota, la data…), che un secondo
// Invio applica; in nessun caso il «/Nome» resta nel testo e la riga resta
// vuota senza che sia successo niente (IMP-6103, IMP-6104).
import { afterEach, describe, expect, it } from "vitest";
import { markdown } from "@codemirror/lang-markdown";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { SlashPanelEvents } from "../../../core/editor-menu";
import { createTextEngine } from "../../engine";
import { dailyLink, markdownCompletions, type DateSource } from "./completions";
import { markdownGrammar } from "./grammar";
import { runSlashAction, type SlashMenuSource } from "./slash";
import { slashCatalog, slashMenuEntries } from "../../../../panels/slash/entries";
import { ALL, FORMATTING, SPECS } from "../../../../panels/slash/fixture.test-data";
import { createSlashPanel, type SlashPanelDeps } from "../../../../panels/slash/panel";
import type { NoteChoice } from "../../../../panels/slash/pickers";

const today = new Date(2026, 10, 19);
const use = { recent: [], favorites: [], chord: () => null, today };
const NOTE: NoteChoice = { label: "Ricette", detail: "", target: "Ricette" };
const DATES: DateSource = { dailyPath: (iso) => `Giornaliere/${iso}`, firstDay: () => 1, today: () => today };

function editor() {
  const parent = document.createElement("div");
  document.body.append(parent);
  let open: HTMLElement | null = null;
  const deps: SlashPanelDeps = {
    entries: (query, place) => slashMenuEntries(SPECS, query, ALL, place, { ...use, hidden: [] }),
    favorite: () => false,
    toggleFavorite: () => false,
    today: () => today,
    colors: () => {
      const { colors } = slashCatalog(SPECS, ALL, use);
      return { text: colors.filter((each) => each.id.startsWith("markdown.color.")), fill: colors.filter((each) => each.id.startsWith("markdown.background.")) };
    },
    notes: async () => [NOTE],
    headings: async () => [],
  };
  const menu: SlashMenuSource = {
    enabled: () => true,
    panel(events) {
      const full: SlashPanelEvents = { ...events, outline: () => [], palette: () => {} };
      const made = createSlashPanel(full, deps);
      open = made.dom;
      return made;
    },
    // Come la superficie (`surface.ts`): un'azione dell'editor si esegue
    // al posto del «/query», il resto toglie soltanto la query; il giorno
    // scelto nel passo «Data» diventa il link alla giornaliera.
    choose(view, choice, from, to) {
      const iso = choice.params["date"];
      const params = choice.entry.id === "markdown.date" && typeof iso === "string" ? dailyLink(iso, DATES) : choice.params;
      if (choice.entry.action) runSlashAction(view, choice.entry.id, from, to, params, choice.below);
      else view.dispatch({ changes: { from, to }, userEvent: "input.complete" });
    },
  };
  const engine = createTextEngine(parent, {
    onChange() {},
    onSelectionChange() {},
    extensions: () => [
      markdown({ base: markdownGrammar }),
      markdownCompletions({ searchNotes: async () => [], listTags: async () => [], slash: menu }),
    ],
  });
  const view = EditorView.findFromDOM(parent)!;
  const type = (text: string) => {
    for (const char of text) {
      const at = view.state.selection.main.head;
      view.dispatch({ changes: { from: at, insert: char }, selection: EditorSelection.cursor(at + 1), userEvent: "input.type" });
    }
  };
  const key = (name: string) => view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
  const inStep = () => open?.classList.contains("is-step") === true && open.isConnected;
  const destroy = () => {
    engine.destroy();
    parent.remove();
  };
  return { engine, view, type, key, inStep, destroy };
}

afterEach(() => document.body.replaceChildren());

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Le voci che lavorano su una selezione (colori, sottolineato, link,
// commento) o fuori dal testo (l'immagine chiede un file): qui non c'è niente
// da scegliere, e la loro prova sta nei loro test.
const SELECTION_ONLY = /^markdown\.(?:color|background)\.|^markdown\.(?:underline|link|comment|image)$/;
const ENTRIES = FORMATTING.filter(([id]) => !SELECTION_ONLY.test(id));

describe("il menu «/» con le battute vere", () => {
  for (const wait of [0, 120]) {
    for (const [id, label] of ENTRIES) {
      it(`«${label}» scritta per intero dopo una riga si applica con Invio ${wait ? "dopo una pausa" : "subito"}`, async () => {
        const { engine, view, type, key, inStep, destroy } = editor();
        try {
          engine.setDoc("Riga di prova.\n");
          view.dispatch({ selection: EditorSelection.cursor(engine.getDoc().length) });
          type(`/${label}`);
          if (wait) await pause(wait);
          key("Enter");
          // Un passo aperto (riquadro, linguaggio, nota, data, diagramma…)
          // si conferma con un secondo Invio, come fa una persona.
          for (let n = 0; n < 2 && inStep(); n++) {
            await pause(10);
            key("Enter");
          }
          const doc = engine.getDoc();
          expect(doc).not.toContain(`/${label}`);
          // «Testo normale» su una riga vuota non ha niente da cambiare.
          if (id !== "markdown.paragraph") expect(doc).not.toBe("Riga di prova.\n");
        } finally {
          destroy();
        }
      });
    }
  }

  it("«Elenco puntato» ed «Elenco numerato» sulla riga vuota fanno l'elenco, col cursore dopo il segno", () => {
    for (const [label, mark] of [["Elenco puntato", "- "], ["Elenco numerato", "1. "], ["Punti", "- "]] as const) {
      const { engine, view, type, key, destroy } = editor();
      try {
        engine.setDoc("Riga di prova.\n");
        view.dispatch({ selection: EditorSelection.cursor(engine.getDoc().length) });
        type(`/${label}`);
        key("Enter");
        expect(engine.getDoc()).toBe(`Riga di prova.\n${mark}`);
        expect(view.state.selection.main.head).toBe(engine.getDoc().length);
        type("uova");
        expect(engine.getDoc()).toBe(`Riga di prova.\n${mark}uova`);
      } finally {
        destroy();
      }
    }
  });
});
