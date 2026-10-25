// @vitest-environment happy-dom
//
// Il «/» nel testo su un editor vero: si apre scrivendo, si filtra, una
// scelta toglie la query e si annulla in un passo, Esc lascia il testo.
import { describe, expect, it, vi } from "vitest";
import {
  acceptCompletion,
  completionStatus,
  currentCompletions,
} from "@codemirror/autocomplete";
import { markdown } from "@codemirror/lang-markdown";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { undo } from "@codemirror/commands";
import type { SlashMenuEntry } from "../../../core/editor-menu";
import { createTextEngine } from "../../engine";
import { markdownCompletions } from "./completions";
import { markdownGrammar } from "./grammar";
import { runSlashAction, type SlashMenuSource } from "./slash";

const ENTRIES: SlashMenuEntry[] = [
  { id: "markdown.heading.2", label: "Titolo 2", description: "", icon: "", hint: "##", section: "text", action: true },
  { id: "markdown.list.task", label: "Attività", description: "", icon: "", hint: "- [ ]", section: "lists", action: true },
  { id: "markdown.diagram", label: "Diagramma", description: "", icon: "", hint: null, section: "insert", action: true },
  { id: "note.daily", label: "Nota del giorno", description: "", icon: "", hint: null, section: "vault", action: false },
];

function editor() {
  const parent = document.createElement("div");
  document.body.append(parent);
  const chosen: string[] = [];
  const menu: SlashMenuSource = {
    entries: (query) => ENTRIES.filter((entry) => entry.label.toLowerCase().includes(query.toLowerCase())),
    choose(view, entry, from, to) {
      if (entry.action) runSlashAction(view, entry.id, from, to);
      else view.dispatch({ changes: { from, to }, userEvent: "input.complete" });
      chosen.push(entry.id);
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
  const labels = () => currentCompletions(view.state).map((option) => option.label);
  const destroy = () => {
    engine.destroy();
    parent.remove();
  };
  return { engine, view, type, labels, chosen, destroy };
}

const open = async (view: EditorView) => vi.waitFor(() => expect(completionStatus(view.state)).toBe("active"));
/// Il completamento ha finito di chiedere: aperto o chiuso, non in attesa.
/// CodeMirror ignora un Invio arrivato appena dopo l'apertura del menu.
const ready = () => new Promise((resolve) => setTimeout(resolve, 100));
const settled = async (view: EditorView) => vi.waitFor(() => expect(completionStatus(view.state)).not.toBe("pending"));

describe("il menu «/» nel testo", () => {
  it("si apre a inizio riga, filtra mentre si scrive, e la scelta toglie la query in un solo passo", async () => {
    const { engine, view, type, labels, chosen, destroy } = editor();
    try {
      engine.setDoc("Riunione\n");
      view.dispatch({ selection: EditorSelection.cursor(engine.getDoc().length) });
      type("/");
      await open(view);
      expect(labels()).toEqual(["Titolo 2", "Attività", "Diagramma", "Nota del giorno"]);
      type("tit");
      await vi.waitFor(() => expect(labels()).toEqual(["Titolo 2"]));
      await ready();
      expect(acceptCompletion(view)).toBe(true);
      expect(engine.getDoc()).toBe("Riunione\n## ");
      expect(chosen).toEqual(["markdown.heading.2"]);
      undo(view);
      expect(engine.getDoc()).toBe("Riunione\n/tit");
    } finally {
      destroy();
    }
  });

  it("su una riga con del testo la trasforma", async () => {
    const { engine, view, type, labels, destroy } = editor();
    try {
      engine.setDoc("Comprare il pane ");
      view.dispatch({ selection: EditorSelection.cursor(engine.getDoc().length) });
      type("/att");
      await vi.waitFor(() => expect(labels()).toEqual(["Attività"]));
      await ready();
      acceptCompletion(view);
      expect(engine.getDoc()).toBe("- [ ] Comprare il pane ");
    } finally {
      destroy();
    }
  });

  it("un comando del vault toglie la query e passa alla shell", async () => {
    const { engine, view, type, labels, chosen, destroy } = editor();
    try {
      engine.setDoc("");
      type("/nota");
      await vi.waitFor(() => expect(labels()).toEqual(["Nota del giorno"]));
      await ready();
      acceptCompletion(view);
      expect(engine.getDoc()).toBe("");
      expect(chosen).toEqual(["note.daily"]);
    } finally {
      destroy();
    }
  });

  it("Esc chiude e lascia il testo, e scrivendo dopo non si riapre", async () => {
    const { engine, view, type, destroy } = editor();
    try {
      engine.setDoc("");
      type("/ti");
      await open(view);
      view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      expect(completionStatus(view.state)).toBeNull();
      type("t");
      await settled(view);
      expect(completionStatus(view.state)).toBeNull();
      expect(engine.getDoc()).toBe("/tit");
    } finally {
      destroy();
    }
  });

  it("dentro una parola, nel codice e senza risultati non si apre", async () => {
    const { engine, view, type, destroy } = editor();
    try {
      engine.setDoc("e");
      view.dispatch({ selection: EditorSelection.cursor(1) });
      type("/o");
      await settled(view);
      expect(completionStatus(view.state)).toBeNull();
      engine.setDoc("```\ncodice \n```");
      view.dispatch({ selection: EditorSelection.cursor(11) });
      type("/t");
      await settled(view);
      expect(completionStatus(view.state)).toBeNull();
      engine.setDoc("");
      type("/zzz");
      await settled(view);
      expect(completionStatus(view.state)).toBeNull();
    } finally {
      destroy();
    }
  });

  it("il diagramma apre il recinto e riapre il completamento coi modelli", async () => {
    const { engine, view, type, labels, destroy } = editor();
    try {
      engine.setDoc("");
      type("/diag");
      await vi.waitFor(() => expect(labels()).toEqual(["Diagramma"]));
      await ready();
      acceptCompletion(view);
      expect(engine.getDoc()).toBe("```mermaid\n\n```");
      await open(view);
      expect(labels().length).toBeGreaterThan(0);
    } finally {
      destroy();
    }
  });
});
