// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { createTextEngine } from "../../engine";
import { createMarkdownProfile } from "./profile";
import { cursorIsLiteral, mountMarkdownSurface, type EditorSlashHost, type MarkdownSurface } from "./surface";
import { api } from "../../../../host/ipc";
import { state } from "../../../../state/store";
import { closeCommandPalette } from "../../../../ui/palette";

interface TestEditor {
  ed: MarkdownSurface;
  parent: HTMLElement;
  view: () => EditorView;
  reading: () => HTMLElement;
}

function editor(
  onChange: (text: string) => void = () => {},
  slash?: EditorSlashHost,
): TestEditor {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const ed = mountMarkdownSurface({ paneId: "riquadro", documentId: "notes/current.md", parent }, {
    onChange: (change) => onChange(change.text),
    onSelectionChange: () => {},
    onOpenWikilink: () => {},
    onOpenPath: () => {},
    onSearchTag: () => {},
    completions: { searchNotes: async () => [], listTags: async () => [] },
    slash,
  });
  const reading = () => {
    const el = parent.querySelector<HTMLElement>(":scope > .pane-preview.markdown-rendered");
    if (!el) throw new Error("la lettura non è montata");
    return el;
  };
  return {
    ed,
    parent,
    reading,
    view: () => {
      const view = EditorView.findFromDOM(parent);
      if (!view) throw new Error("l'editor non è montato");
      return view;
    },
  };
}

describe("la superficie Markdown", () => {
  it("delega la sola lettura al motore senza bloccare la sincronizzazione", () => {
    const { ed, view } = editor();
    ed.buffer.setDoc("prima");
    ed.setReadOnly(true);

    expect(view().state.readOnly).toBe(true);
    ed.buffer.syncDoc("seconda");
    expect(ed.buffer.getDoc()).toBe("seconda");

    ed.setReadOnly(false);
    expect(view().state.readOnly).toBe(false);
    ed.destroy();
  });
  it("cambia modo sul buffer corrente senza toccare testo o selezione", () => {
    const { ed, parent, view, reading } = editor();
    ed.buffer.setDoc("# Titolo\n\n- [ ] da fare\n");
    view().dispatch({ selection: { anchor: 3 } });
    const anchor = view().state.selection.main.anchor;

    ed.setMode("reading");
    expect(ed.buffer.getDoc()).toBe("# Titolo\n\n- [ ] da fare\n");
    expect(parent.dataset.markdownMode).toBe("reading");
    expect(reading().style.display).not.toBe("none");
    expect(reading().textContent).toContain("da fare");

    ed.setMode("live_preview");
    expect(ed.buffer.getDoc()).toBe("# Titolo\n\n- [ ] da fare\n");
    expect(view().state.selection.main.anchor).toBe(anchor);
    expect(parent.dataset.markdownMode).toBe("live_preview");
    ed.destroy();
  });
  it("in lettura raccoglie le battute di un altro riquadro in un ridisegno solo", () => {
    vi.useFakeTimers();
    try {
      const { ed, reading } = editor();
      ed.buffer.setDoc("prima");
      ed.setMode("reading");
      const drawn = reading().firstElementChild;
      ed.buffer.syncDoc("prima s");
      ed.buffer.syncDoc("prima se");
      ed.buffer.syncDoc("prima seconda");
      // Il buffer è subito allineato; il reso aspetta la fine della finestra.
      expect(ed.buffer.getDoc()).toBe("prima seconda");
      expect(reading().firstElementChild).toBe(drawn);
      vi.runOnlyPendingTimers();
      expect(reading().textContent).toContain("prima seconda");
      ed.buffer.syncDoc("terza");
      ed.destroy();
      // Smontato, il ridisegno in attesa non parte.
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
  it("il task cliccato in lettura cambia solo il simbolo ed è annullabile", () => {
    const changes: string[] = [];
    const { ed, parent } = editor((text) => changes.push(text));
    ed.buffer.setDoc("- [ ] da fare\n");
    ed.setMode("reading");
    const box = parent.querySelector<HTMLInputElement>(
      ":scope > .pane-preview.markdown-rendered input[type=\"checkbox\"]",
    );
    expect(box).not.toBeNull();
    box!.click();
    expect(ed.buffer.getDoc()).toBe("- [x] da fare\n");
    expect(changes[changes.length - 1]).toBe("- [x] da fare\n");
    expect(ed.undo()).toBe(true);
    expect(ed.buffer.getDoc()).toBe("- [ ] da fare\n");
    ed.destroy();
  });
  it("apre slash da /, filtra il registro e invoca con la selezione del buffer dopo il flush", async () => {
    const previousDoc = state.currentDoc;
    state.currentDoc = "notes/current.md";
    const sequence: string[] = [];
    const specs = [
      {
        id: "selection.wrap",
        title: "Wrap selection",
        description: "Wrap selected text",
        keybinding: null,
        params: [
          { name: "doc", title: "Document", description: "", kind: { kind: "document" as const }, required: true },
          { name: "text", title: "Text", description: "", kind: { kind: "text" as const }, required: true },
        ],
        scope: { writes: true, reach: "document" as const, reversible: true },
        surfaces: ["slash_selection" as const],
      },
      {
        id: "selection.search",
        title: "Search selection",
        description: "Look for matching text",
        keybinding: null,
        params: [{ name: "find", title: "Find", description: "", kind: { kind: "text" as const }, required: true }],
        scope: { writes: false, reach: "session" as const, reversible: true },
        surfaces: ["slash_selection" as const],
      },
      {
        // Un comando che non si dichiara nel menu `/` non ci compare, qualunque
        // nome abbiano i suoi parametri.
        id: "vault.undeclared",
        title: "Undeclared",
        description: "Takes a text but never asked to be here",
        keybinding: null,
        params: [{ name: "text", title: "Text", description: "", kind: { kind: "text" as const }, required: true }],
        scope: { writes: true, reach: "document" as const, reversible: true },
        surfaces: [],
      },
    ];
    const list = vi.spyOn(api, "listCommands").mockResolvedValue(specs);
    const invoke = vi.spyOn(api, "invokeCommand").mockImplementation(async () => {
      sequence.push("invoke");
      return { notify: null, effect: { kind: "done" }, undo: null, partial: null };
    });
    vi.spyOn(api, "queryIndex").mockResolvedValue({ kind: "settings", value: [] });
    const slash = {
      currentDoc: vi.fn(() => state.currentDoc),
      onEffect: vi.fn(),
      notify: vi.fn(),
      flushPendingSave: vi.fn(async () => {
        sequence.push("flush");
        return [];
      }),
      publishContext: vi.fn(async () => {
        sequence.push("context");
      }),
    } satisfies EditorSlashHost;
    const { ed, parent, view } = editor(() => {}, slash);
    const text = "before needle after";
    try {
      ed.buffer.setDoc(text);
      view().dispatch({ selection: { anchor: 7, head: 13 } });
      const content = view().contentDOM;
      content.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true, cancelable: true }));
      await vi.waitFor(() => expect(document.querySelector<HTMLInputElement>("#command-palette input")).not.toBeNull());
      const input = document.querySelector<HTMLInputElement>("#command-palette input")!;
      expect(ed.buffer.getDoc()).toBe(text);
      expect(document.querySelectorAll("#command-palette [role=option]")).toHaveLength(2);
      input.value = "wrap";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      expect(document.querySelectorAll("#command-palette [role=option]")).toHaveLength(1);
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
      expect(sequence).toEqual(["flush", "context", "invoke"]);
      expect(invoke).toHaveBeenCalledWith(
        "selection.wrap", { doc: "notes/current.md", text: "needle" }, "apply",
      );
      expect(ed.buffer.getDoc()).toBe(text); // a non-edit outcome never writes through the editor

      content.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true, cancelable: true }));
      await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(2));
      ed.buffer.setDoc("different buffer");
      expect(document.getElementById("command-palette")?.dataset.shellMotion).toBe("exit");
      content.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true, cancelable: true }));
      await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(3));
      const outsider = document.createElement("button");
      document.body.append(outsider);
      outsider.focus();
      expect(document.getElementById("command-palette")?.dataset.shellMotion).toBe("exit");
      outsider.remove();
      const count = list.mock.calls.length;
      ed.destroy();
      content.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true, cancelable: true }));
      expect(list).toHaveBeenCalledTimes(count);
    } finally {
      ed.destroy();
      parent.remove();
      closeCommandPalette();
      state.currentDoc = previousDoc;
      vi.restoreAllMocks();
    }
  });
  it("lascia il / come testo dentro una parola, nel codice e nei link", async () => {
    const previousDoc = state.currentDoc;
    state.currentDoc = "notes/current.md";
    const list = vi.spyOn(api, "listCommands").mockResolvedValue([]);
    vi.spyOn(api, "queryIndex").mockResolvedValue({ kind: "settings", value: [] });
    const slash = {
      currentDoc: vi.fn(() => state.currentDoc),
      onEffect: vi.fn(),
      notify: vi.fn(),
      flushPendingSave: vi.fn(async () => []),
      publishContext: vi.fn(async () => {}),
    } satisfies EditorSlashHost;
    const { ed, parent, view } = editor(() => {}, slash);
    const press = () => view().contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { key: "/", bubbles: true, cancelable: true }),
    );
    try {
      for (const text of ["e", "24", "`a", "[[Progetti", "https://x.org"]) {
        ed.buffer.setDoc(text);
        view().dispatch({ selection: { anchor: text.length } });
        expect(press()).toBe(true);
      }
      expect(list).not.toHaveBeenCalled();

      ed.buffer.setDoc("prima ");
      view().dispatch({ selection: { anchor: 6 } });
      expect(press()).toBe(false);
      const live = "#command-palette:not([data-shell-motion=exit]) input";
      await vi.waitFor(() => expect(document.querySelector(live)).not.toBeNull());
      document.querySelector<HTMLInputElement>(live)!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
      expect(ed.buffer.getDoc()).toBe("prima /");
    } finally {
      ed.destroy();
      parent.remove();
      closeCommandPalette();
      state.currentDoc = previousDoc;
      vi.restoreAllMocks();
    }
  });
  it("shows all P05 commands, collects template arguments and confirms a daily plan", async () => {
    const previousDoc = state.currentDoc;
    state.currentDoc = "notes/current.md";
    const ids = [
      "note.from_template", "note.daily", "note.unique", "note.random",
      "note.insert_datetime", "note.insert_template", "note.extract", "note.merge",
    ];
    const params = (id: string) => {
      if (id === "note.from_template" || id === "note.insert_template") {
        return [{ name: "template", title: "Template", description: "", kind: { kind: "text" as const }, required: true }];
      }
      if (id === "note.merge") {
        return [{ name: "from", title: "Sources", description: "", kind: { kind: "documents" as const }, required: true }];
      }
      if (id === "note.daily") {
        return [{ name: "date", title: "Date", description: "", kind: { kind: "text" as const }, required: false }];
      }
      return [];
    };
    const specs = ids.map((id) => ({
      id, title: id, description: id, keybinding: null, params: params(id),
      scope: {
        writes: id !== "note.random",
        reach: id === "note.insert_template" || id === "note.insert_datetime"
          ? "document" as const : "vault" as const,
        reversible: true,
      },
      surfaces: ["slash" as const],
    }));
    vi.spyOn(api, "listCommands").mockResolvedValue(specs);
    const invoke = vi.spyOn(api, "invokeCommand").mockImplementation(async (_id, _args, mode) => ({
      notify: null,
      effect: mode === "dry_run"
        ? { kind: "plan", summary: "Daily", docs: ["Daily/2024-02-29.md"], edits: [] }
        : { kind: "done" },
      undo: null, partial: null,
    }));
    vi.spyOn(api, "queryIndex").mockResolvedValue({ kind: "settings", value: [] });
    const slash = {
      currentDoc: () => state.currentDoc,
      onEffect: vi.fn(),
      notify: vi.fn(),
      flushPendingSave: vi.fn(async () => []),
      publishContext: vi.fn(async () => {}),
    } satisfies EditorSlashHost;
    const { ed, parent, view } = editor(() => {}, slash);
    const open = async () => {
      view().contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true, cancelable: true }));
      await vi.waitFor(() => expect([...document.querySelectorAll<HTMLElement>("#command-palette [data-command-id]")]
        .map((item) => item.dataset.commandId).sort()).toEqual([...ids].sort()));
    };
    try {
      ed.buffer.setDoc("untouched");
      await open();
      const search = document.querySelector<HTMLInputElement>("#command-palette input.palette-input")!;
      search.value = "insert_template";
      search.dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelector<HTMLElement>('#command-palette [data-command-id="note.insert_template"]')!.click();
      document.querySelector<HTMLButtonElement>("#command-palette form .palette-actions button:last-child")!.click();
      expect(document.querySelector<HTMLInputElement>("#command-palette input.palette-input")?.value)
        .toBe("insert_template");
      document.querySelector<HTMLElement>('#command-palette [data-command-id="note.insert_template"]')!.click();
      const template = document.querySelector<HTMLInputElement>("#command-palette form input")!;
      template.value = "Templates/typed.md";
      document.querySelector<HTMLFormElement>("#command-palette form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith(
        "note.insert_template", { template: "Templates/typed.md" }, "apply",
      ));
      expect(ed.buffer.getDoc()).toBe("untouched");

      await open();
      document.querySelector<HTMLElement>('#command-palette [data-command-id="note.daily"]')!.click();
      document.querySelector<HTMLInputElement>("#command-palette form input")!.value = "2024-02-29";
      document.querySelector<HTMLFormElement>("#command-palette form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith(
        "note.daily", { date: "2024-02-29" }, "dry_run",
      ));
      expect(invoke).not.toHaveBeenCalledWith("note.daily", expect.anything(), "apply");
      document.querySelector<HTMLButtonElement>("#command-palette .palette-actions .primary")!.click();
      await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith(
        "note.daily", { date: "2024-02-29" }, "apply",
      ));
      await open();
      document.querySelector<HTMLElement>('#command-palette [data-command-id="note.merge"]')!.click();
      document.querySelector<HTMLTextAreaElement>("#command-palette form textarea")!.value =
        "notes/a.md\nnotes/b.md";
      document.querySelector<HTMLFormElement>("#command-palette form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith(
        "note.merge", { from: ["notes/a.md", "notes/b.md"] }, "dry_run",
      ));
      expect(ed.buffer.getDoc()).toBe("untouched");
    } finally {
      ed.destroy();
      parent.remove();
      closeCommandPalette();
      state.currentDoc = previousDoc;
      vi.restoreAllMocks();
    }
  });
});

describe("il cursore letterale della palette slash", () => {
  it("è deciso dal profilo sui nodi Markdown che il motore gli dà", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const profile = createMarkdownProfile({
      callbacks: { openWikilink: () => {}, searchTag: () => {} },
      completions: { searchNotes: async () => [], listTags: async () => [] },
    });
    const engine = createTextEngine(parent, {
      onChange: () => {},
      onSelectionChange: () => {},
      extensions: () => profile.extensions(),
    });
    const at = (doc: string, head: number) => {
      engine.setDoc(doc);
      EditorView.findFromDOM(parent)!.dispatch({ selection: { anchor: head } });
      return cursorIsLiteral(engine.cursorContext());
    };
    try {
      expect(at("testo `codice qui` e altro", 10)).toBe(true);
      expect(at("vedi [[Nota in corso", 20)).toBe(true);
      expect(at("vedi [[Nota]] e poi ", 20)).toBe(false);
      expect(at("un link [qui](https://esempio.it) fine", 20)).toBe(true);
      expect(at("testo semplice ", 15)).toBe(false);
    } finally {
      engine.destroy();
      parent.remove();
    }
  });
});
