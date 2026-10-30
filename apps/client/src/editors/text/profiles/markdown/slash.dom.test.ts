// @vitest-environment happy-dom
//
// Il «/» nel testo su un editor vero: il pannello si apre scrivendo e riceve
// ciò che si scrive, una scelta toglie la query e si annulla in un passo, Esc
// lascia il testo, e l'editor dice di avere un elenco finché il pannello è aperto.
import { describe, expect, it } from "vitest";
import { markdown } from "@codemirror/lang-markdown";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { undo } from "@codemirror/commands";
import type { SlashChoice, SlashMenuEntry, SlashPanel, SlashPlace } from "../../../core/editor-menu";
import { createTextEngine } from "../../engine";
import { markdownCompletions } from "./completions";
import { markdownGrammar } from "./grammar";
import { openSlashAt, openSlashMenu, openSlashTransform, runSlashAction, type SlashMenuSource, type SlashPanelCore } from "./slash";

function entry(id: string, action = true): SlashMenuEntry {
  return { id, label: id, description: "", icon: "", hint: null, section: "text", action, picker: null, params: {}, quick: false, span: null, why: null };
}

/// Un pannello finto: ricorda ciò che riceve e lascia scegliere al test.
interface FakePanel {
  events: SlashPanelCore;
  transform: boolean;
  updates: { query: string; place: SlashPlace }[];
  keys: string[];
  closed: boolean;
}

function editor() {
  const parent = document.createElement("div");
  document.body.append(parent);
  const panels: FakePanel[] = [];
  const chosen: { id: string; transform: boolean; params: Readonly<Record<string, unknown>> }[] = [];
  const menu: SlashMenuSource = {
    enabled: () => true,
    panel(events, transform): SlashPanel {
      const fake: FakePanel = { events, transform, updates: [], keys: [], closed: false };
      panels.push(fake);
      const dom = document.createElement("div");
      return {
        dom,
        listId: "lista-finta",
        update: (query, place) => void fake.updates.push({ query, place }),
        key: (event) => {
          fake.keys.push(event.key);
          return event.key === "ArrowDown";
        },
        placed: () => {},
        close: () => {
          fake.closed = true;
        },
      };
    },
    choose(view, choice, from, to, transform) {
      chosen.push({ id: choice.entry.id, transform, params: choice.params });
      // «Trasforma» lo esegue la superficie sulla selezione (`surface.ts`).
      if (transform) return;
      if (choice.entry.action) runSlashAction(view, choice.entry.id, from, to, choice.params, choice.below);
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
  const panel = () => panels[panels.length - 1]!;
  const pick = (id: string, action = true, params: Readonly<Record<string, unknown>> = {}, below = false) => {
    const choice: SlashChoice = { entry: entry(id, action), params, below };
    panel().events.choose(choice);
  };
  const key = (name: string) => view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
  const destroy = () => {
    engine.destroy();
    parent.remove();
  };
  return { engine, view, type, panels, panel, pick, key, chosen, destroy };
}

describe("il menu «/» nel testo", () => {
  it("si apre a inizio riga, riceve ciò che si scrive, e la scelta toglie la query in un solo passo", () => {
    const { engine, view, type, panel, pick, chosen, destroy } = editor();
    try {
      engine.setDoc("Riunione\n");
      view.dispatch({ selection: EditorSelection.cursor(engine.getDoc().length) });
      type("/");
      expect(openSlashMenu(view.state)).toMatchObject({ from: 9, query: "" });
      expect(view.contentDOM.getAttribute("aria-haspopup")).toBe("listbox");
      expect(view.contentDOM.getAttribute("aria-controls")).toBe("lista-finta");
      type("tit");
      expect(panel().updates.map((each) => each.query)).toEqual(["", "t", "ti", "tit"]);
      expect(panel().updates[0]!.place).toEqual({ line: "empty", above: "paragraph", inList: false });
      pick("markdown.heading.2");
      expect(engine.getDoc()).toBe("Riunione\n## ");
      expect(chosen.map((each) => each.id)).toEqual(["markdown.heading.2"]);
      expect(openSlashMenu(view.state)).toBeNull();
      expect(panel().closed).toBe(true);
      expect(view.contentDOM.hasAttribute("aria-haspopup")).toBe(false);
      expect(view.contentDOM.hasAttribute("aria-controls")).toBe(false);
      undo(view);
      expect(engine.getDoc()).toBe("Riunione\n/tit");
    } finally {
      destroy();
    }
  });

  it("dopo del testo il blocco nasce sotto, e la riga resta com'era", () => {
    const { engine, view, type, panel, pick, destroy } = editor();
    try {
      engine.setDoc("Comprare il pane ");
      view.dispatch({ selection: EditorSelection.cursor(engine.getDoc().length) });
      type("/att");
      expect(panel().updates[panel().updates.length - 1]!.place.line).toBe("after-text");
      pick("markdown.list.task");
      expect(engine.getDoc()).toBe("Comprare il pane\n- [ ] ");
    } finally {
      destroy();
    }
  });

  it("⇧↵ mette il blocco sotto anche su una riga vuota", () => {
    const { engine, type, pick, destroy } = editor();
    try {
      engine.setDoc("");
      type("/tit");
      pick("markdown.heading.2", true, {}, true);
      expect(engine.getDoc()).toBe("\n## ");
    } finally {
      destroy();
    }
  });

  it("gli argomenti del passo arrivano all'azione: la tabella 2 × 3", () => {
    const { engine, type, pick, destroy } = editor();
    try {
      engine.setDoc("");
      type("/tab");
      pick("markdown.table", true, { rows: 2, cols: 3 });
      expect(engine.getDoc().split("\n").filter((line) => line.startsWith("|"))).toHaveLength(3);
    } finally {
      destroy();
    }
  });

  it("un comando del vault toglie la query e passa alla shell", () => {
    const { engine, type, pick, chosen, destroy } = editor();
    try {
      engine.setDoc("");
      type("/nota");
      pick("note.daily", false);
      expect(engine.getDoc()).toBe("");
      expect(chosen).toEqual([{ id: "note.daily", transform: false, params: {} }]);
    } finally {
      destroy();
    }
  });

  it("i tasti vanno al pannello finché è aperto; quelli che non prende restano all'editor", () => {
    const { engine, type, panel, key, destroy } = editor();
    try {
      engine.setDoc("");
      type("/ti");
      expect(key("ArrowDown")).toBe(false);
      expect(key("x")).toBe(true);
      expect(panel().keys).toEqual(["ArrowDown", "x"]);
    } finally {
      destroy();
    }
  });

  it("Esc lascia il testo, e scrivendo dopo non si riapre", () => {
    const { engine, view, type, panel, panels, destroy } = editor();
    try {
      engine.setDoc("");
      type("/ti");
      panel().events.dismiss();
      expect(openSlashMenu(view.state)).toBeNull();
      type("t");
      expect(openSlashMenu(view.state)).toBeNull();
      expect(panels).toHaveLength(1);
      expect(engine.getDoc()).toBe("/tit");
    } finally {
      destroy();
    }
  });

  it("dentro una parola e nel codice resta testo", () => {
    const { engine, view, type, destroy } = editor();
    try {
      engine.setDoc("e");
      view.dispatch({ selection: EditorSelection.cursor(1) });
      type("/o");
      expect(openSlashMenu(view.state)).toBeNull();
      engine.setDoc("```\ncodice \n```");
      view.dispatch({ selection: EditorSelection.cursor(11) });
      type("/t");
      expect(openSlashMenu(view.state)).toBeNull();
    } finally {
      destroy();
    }
  });

  it("il «+» della maniglia apre il pannello sul «/» che ha scritto", () => {
    const { engine, view, panels, destroy } = editor();
    try {
      engine.setDoc("Uno\n/");
      view.dispatch({ selection: EditorSelection.cursor(5) });
      expect(openSlashMenu(view.state)).toBeNull();
      expect(openSlashAt(view, 4)).toBe(true);
      expect(panels).toHaveLength(1);
      expect(openSlashMenu(view.state)).toMatchObject({ from: 4, transform: false });
    } finally {
      destroy();
    }
  });

  it("il «/» su una selezione apre «Trasforma», che agisce sulla selezione", () => {
    const { engine, view, panel, pick, chosen, destroy } = editor();
    try {
      engine.setDoc("Primo\nSecondo");
      view.dispatch({ selection: EditorSelection.range(0, 13) });
      expect(openSlashTransform(view)).toBe(true);
      expect(panel().transform).toBe(true);
      pick("markdown.list.bullet");
      expect(chosen[0]).toMatchObject({ id: "markdown.list.bullet", transform: true });
      expect(engine.getDoc()).toBe("Primo\nSecondo");
      expect(openSlashMenu(view.state)).toBeNull();
    } finally {
      destroy();
    }
  });
});
