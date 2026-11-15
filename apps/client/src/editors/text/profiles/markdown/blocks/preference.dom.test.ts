// @vitest-environment happy-dom
// I blocchi come preferenza (`editor.blocks`, E2) nella superficie vera, col
// profilo intero e la sua mappa dei tasti: una prova per ogni riga della
// tabella dei gesti, coi blocchi accesi e spenti, e i casi limite del piano.
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorSelection } from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { getCM } from "@replit/codemirror-vim";
import { undoDepth } from "@codemirror/commands";
import type { SettingEntry } from "../../../../../host/contract";
import { settings } from "../../../../../host/query";
import { forwardNotice } from "../../../../../state/kernel";
import { t } from "../../../../../i18n/strings";
import { mountMarkdownSurface, type MarkdownSurface } from "../surface";
import { blockSelection } from "./selection";
import { blockTextSpan, bodySpan } from "./keys";
import { modelOf } from "./transform";

vi.mock("../../../../../host/query", () => ({ settings: vi.fn() }));

function toggle(key: string, value: boolean): SettingEntry {
  return {
    spec: { key, label: key, description: "", group: "Editor", scope: "machine", kind: { kind: "toggle", default: true }, program_writable: false },
    value,
    source: "machine",
  };
}

interface Note {
  readonly ed: MarkdownSurface;
  readonly view: EditorView;
  readonly parent: HTMLElement;
}

const mounted: Note[] = [];
afterEach(() => {
  for (const note of mounted.splice(0)) {
    note.ed.destroy();
    note.parent.remove();
  }
  vi.mocked(settings).mockReset();
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/// Le impostazioni che il backend serve d'ora in poi.
function serve(blocks: boolean, vim = false): void {
  vi.mocked(settings).mockResolvedValue([toggle("editor.blocks", blocks), toggle("editor.vim", vim)]);
}

/// Una nota in Scrittura, con le impostazioni già lette.
async function note(doc: string, blocks: boolean, anchor = 0, extra: { vim?: boolean; escapeLeaves?: boolean } = {}): Promise<Note> {
  serve(blocks, extra.vim === true);
  const parent = document.createElement("div");
  document.body.append(parent);
  const ed = mountMarkdownSurface({ paneId: "riquadro", documentId: "Nota.md", parent, escapeLeaves: extra.escapeLeaves }, {
    onChange: () => {},
    onSelectionChange: () => {},
    onOpenWikilink: () => {},
    onOpenPath: () => {},
    onSearchTag: () => {},
    completions: { searchNotes: async () => [], listTags: async () => [] },
  });
  ed.buffer.setDoc(doc);
  await settle();
  await settle();
  const view = EditorView.findFromDOM(parent)!;
  view.dispatch({ selection: { anchor } });
  const made = { ed, view, parent };
  mounted.push(made);
  expect(handles(made), "i blocchi seguono la preferenza").toBe(blocks);
  return made;
}

/// La preferenza cambiata altrove (le Impostazioni, il menu «…»): il backend
/// la dice con `setting_changed`.
async function change(blocks: boolean, vim = false): Promise<void> {
  serve(blocks, vim);
  forwardNotice({ event: { type: "setting_changed", key: "editor.blocks", scope: "machine" }, origin: { actor: { kind: "user" }, batch: null } });
  await settle();
  await settle();
}

const press = (view: EditorView, key: string, extra: KeyboardEventInit = {}) =>
  runScopeHandlers(view, new KeyboardEvent("keydown", { key, ...extra }), "editor");
const chosen = (view: EditorView) => view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to);
const handles = (n: Note) => n.view.scrollDOM.querySelector(".cm-fub-block-handles") !== null;
const header = (n: Note) => n.view.dom.querySelector(".cm-fub-page-header, .cm-fub-page") !== null;

describe("maniglia e «+»", () => {
  it("accesi ci sono, spenti no; la testata resta in tutti e due", async () => {
    const on = await note("---\nicon: 🧳\n---\nUno\n\nDue", true, 20);
    expect(on.view.scrollDOM.querySelector(".cm-fub-block-add")).not.toBeNull();
    expect(on.view.scrollDOM.querySelector(".cm-fub-block-grip")).not.toBeNull();
    expect(header(on)).toBe(true);
    const off = await note("---\nicon: 🧳\n---\nUno\n\nDue", false, 20);
    expect(off.view.scrollDOM.querySelector(".cm-fub-block-add")).toBeNull();
    expect(off.view.scrollDOM.querySelector(".cm-fub-block-grip")).toBeNull();
    expect(header(off), "la testata non è un blocco").toBe(true);
  });
});

describe("Ctrl A", () => {
  const doc = "---\ntitolo: x\n---\n## Titolo\n\n- [ ] voce\n  - figlia\n\nUltimo";

  it("accesi: la prima volta il testo del blocco, la seconda tutti i blocchi, poi niente", async () => {
    const { view } = await note(doc, true, doc.indexOf("voce") + 1);
    expect(press(view, "a", { ctrlKey: true })).toBe(true);
    expect(chosen(view)).toBe("voce");
    expect(view.state.field(blockSelection, false) ?? null).toBeNull();
    expect(press(view, "a", { ctrlKey: true })).toBe(true);
    expect(view.state.field(blockSelection)).not.toBeNull();
    expect(chosen(view), "titolo e proprietà fuori").toBe("## Titolo\n\n- [ ] voce\n  - figlia\n\nUltimo");
    const before = view.state.selection;
    expect(press(view, "a", { ctrlKey: true })).toBe(true);
    expect(view.state.selection.eq(before)).toBe(true);
  });

  it("accesi: il testo di un titolo è senza i suoi segni", async () => {
    const { view } = await note(doc, true, doc.indexOf("Titolo") + 2);
    press(view, "a", { ctrlKey: true });
    expect(chosen(view)).toBe("Titolo");
  });

  it("spenti: il corpo della nota dal primo all'ultimo blocco, titolo e proprietà fuori; il secondo non fa altro", async () => {
    const { view } = await note(doc, false, doc.indexOf("voce") + 1);
    expect(press(view, "a", { ctrlKey: true })).toBe(true);
    expect(chosen(view)).toBe("## Titolo\n\n- [ ] voce\n  - figlia\n\nUltimo");
    expect(view.state.field(blockSelection, false)).toBeUndefined();
    const before = view.state.selection;
    expect(press(view, "a", { ctrlKey: true })).toBe(true);
    expect(view.state.selection.eq(before)).toBe(true);
  });

  it("nota senza frontmatter: spenti prende tutto, accesi tutti i blocchi", async () => {
    const plain = "Uno\n\nDue\n";
    const off = await note(plain, false, 1);
    press(off.view, "a", { ctrlKey: true });
    expect(chosen(off.view)).toBe(plain);
    const on = await note(plain, true, 1);
    press(on.view, "a", { ctrlKey: true });
    press(on.view, "a", { ctrlKey: true });
    expect(chosen(on.view)).toBe("Uno\n\nDue");
  });

  it("nota col solo frontmatter: Ctrl A non prende niente e non si rompe, nei due stati", async () => {
    const only = "---\ntitolo: x\n---\n";
    for (const blocks of [true, false]) {
      const { view } = await note(only, blocks, 0);
      const before = view.state.selection;
      expect(press(view, "a", { ctrlKey: true })).toBe(true);
      expect(press(view, "a", { ctrlKey: true })).toBe(true);
      expect(view.state.selection.eq(before)).toBe(true);
      expect(view.state.doc.toString()).toBe(only);
    }
    expect(bodySpan(EditorView.findFromDOM(mounted[0]!.parent)!.state)).toBeNull();
  });
});

describe("Esc", () => {
  it("accesi seleziona il blocco del cursore, ↓ sceglie, Maiusc allarga", async () => {
    const { view } = await note("Uno\n\nDue\n\nTre", true, 1);
    expect(press(view, "Escape")).toBe(true);
    expect(chosen(view)).toBe("Uno");
    press(view, "ArrowDown");
    expect(chosen(view)).toBe("Due");
    press(view, "ArrowDown", { shiftKey: true });
    expect(chosen(view)).toBe("Due\n\nTre");
  });

  it("spenti non è di Scrittura: niente selezione di blocchi, passa a chi chiude ciò che è aperto", async () => {
    const { view } = await note("Uno\n\nDue", false, 1);
    expect(press(view, "Escape")).toBe(false);
    expect(view.state.field(blockSelection, false)).toBeUndefined();
    expect(view.state.selection.main.empty).toBe(true);
  });

  it("con Vim resta di Vim, nei due stati", async () => {
    for (const blocks of [true, false]) {
      const { view } = await note("Uno\n\nDue", blocks, 6, { vim: true });
      expect(getCM(view), "Vim è acceso").not.toBeNull();
      press(view, "Escape");
      expect(view.state.field(blockSelection, false) ?? null).toBeNull();
      // Fuori dal modo inserimento i tasti di Scrittura si fanno da parte.
      press(view, "ArrowUp", { ctrlKey: true, shiftKey: true });
      expect(view.state.doc.toString()).toBe("Uno\n\nDue");
    }
  });
});

describe("Ctrl Maiusc ↑ ↓", () => {
  it("accesi sposta il blocco", async () => {
    const { view } = await note("Uno\n\nDue\nsotto", true, 6);
    press(view, "ArrowUp", { ctrlKey: true, shiftKey: true });
    expect(view.state.doc.toString()).toBe("Due\nsotto\n\nUno");
  });

  it("spenti sposta la riga, o le righe scelte, e non entra nella testata", async () => {
    const { view } = await note("---\na: 1\n---\nUno\nDue\nTre", false, 0);
    const at = view.state.doc.toString().indexOf("Due");
    view.dispatch({ selection: { anchor: at } });
    press(view, "ArrowUp", { ctrlKey: true, shiftKey: true });
    expect(view.state.doc.toString()).toBe("---\na: 1\n---\nDue\nUno\nTre");
    press(view, "ArrowUp", { ctrlKey: true, shiftKey: true });
    expect(view.state.doc.toString(), "la prima riga del corpo non sale nella testata").toBe("---\na: 1\n---\nDue\nUno\nTre");
    const doc = view.state.doc.toString();
    view.dispatch({ selection: EditorSelection.single(doc.indexOf("Due"), doc.indexOf("Uno") + 1) });
    press(view, "ArrowDown", { ctrlKey: true, shiftKey: true });
    expect(view.state.doc.toString()).toBe("---\na: 1\n---\nTre\nDue\nUno");
  });
});

describe("Ctrl D", () => {
  it("accesi duplica il blocco del cursore, e si scrive nella copia", async () => {
    const { view } = await note("- a\n- b\n\nfine", true, 3);
    expect(press(view, "d", { ctrlKey: true })).toBe(true);
    expect(view.state.doc.toString()).toBe("- a\n- a\n- b\n\nfine");
    expect(view.state.selection.main.head).toBe(7);
    expect(view.state.field(blockSelection)).toBeNull();
  });

  it("accesi duplica la selezione di blocchi, e la copia resta scelta", async () => {
    const { view } = await note("Uno\n\nDue", true, 1);
    press(view, "Escape");
    press(view, "d", { ctrlKey: true });
    expect(view.state.doc.toString()).toBe("Uno\n\nUno\n\nDue");
    expect(view.state.field(blockSelection)).not.toBeNull();
  });

  it("spenti sceglie la prossima occorrenza, con un cursore in più", async () => {
    const { view } = await note("gatto e gatto", false, 2);
    press(view, "d", { ctrlKey: true });
    expect(chosen(view)).toBe("gatto");
    press(view, "d", { ctrlKey: true });
    expect(view.state.selection.ranges.map((range) => view.state.sliceDoc(range.from, range.to))).toEqual(["gatto", "gatto"]);
    expect(view.state.doc.toString()).toBe("gatto e gatto");
  });
});

describe("trascinare", () => {
  it("accesi dalla maniglia, che ha il suo posto d'arrivo; spenti niente maniglia, il testo scelto come oggi", async () => {
    const on = await note("Uno\n\nDue", true, 1);
    expect(on.view.scrollDOM.querySelector(".cm-fub-block-drop")).not.toBeNull();
    const off = await note("Uno\n\nDue", false, 1);
    expect(off.view.scrollDOM.querySelector(".cm-fub-block-drop")).toBeNull();
    expect(off.view.scrollDOM.querySelector(".cm-fub-block-grip")).toBeNull();
  });
});

describe("il «/» e il menu del blocco", () => {
  const transform = (ed: MarkdownSurface) =>
    (ed.contextMenu!(null)?.context ?? []).some((entry) => typeof entry !== "string" && entry.label === t("editor_menu.transform_block"));

  it("accesi la maniglia apre il menu del blocco; spenti «Trasforma in» sta nel tasto destro; nei due il tasto destro lo offre", async () => {
    const on = await note("Un paragrafo", true, 3);
    expect(on.view.dom.querySelector(".cm-fub-block-grip")).not.toBeNull();
    expect(transform(on.ed)).toBe(true);
    const off = await note("Un paragrafo", false, 3);
    expect(off.view.dom.querySelector(".cm-fub-block-grip")).toBeNull();
    expect(transform(off.ed)).toBe(true);
  });
});

describe("cambiare la chiave", () => {
  it("non riapre la nota: stessa vista, stesso testo, stessa selezione e stessa cronologia", async () => {
    const n = await note("Uno\n\nDue", true, 1);
    n.view.dispatch({ changes: { from: 3, insert: "!" }, userEvent: "input.type" });
    const depth = undoDepth(n.view.state);
    expect(depth).toBeGreaterThan(0);
    await change(false);
    expect(EditorView.findFromDOM(n.parent)).toBe(n.view);
    expect(handles(n)).toBe(false);
    expect(n.view.state.doc.toString()).toBe("Uno!\n\nDue");
    expect(n.view.state.selection.main.head).toBe(1);
    expect(undoDepth(n.view.state), "la cronologia resta").toBe(depth);
    await change(true);
    expect(handles(n)).toBe(true);
    expect(n.ed.undo()).toBe(true);
    expect(n.view.state.doc.toString()).toBe("Uno\n\nDue");
  });

  it("con una selezione di blocchi attiva, la selezione si riduce a testo", async () => {
    const n = await note("Uno\n\nDue\n\nTre", true, 1);
    press(n.view, "Escape");
    press(n.view, "ArrowDown", { shiftKey: true });
    expect(chosen(n.view)).toBe("Uno\n\nDue");
    await change(false);
    expect(n.view.state.field(blockSelection, false)).toBeUndefined();
    expect(chosen(n.view)).toBe("Uno\n\nDue");
    expect(n.view.dom.querySelector(".cm-fub-block-selected")).toBeNull();
    // Una battuta ora sostituisce il testo, come in ogni editor di testo.
    n.view.dispatch(n.view.state.replaceSelection("X"));
    expect(n.view.state.doc.toString()).toBe("X\n\nTre");
  });

  it("durante una composizione (IME) aspetta che finisca", async () => {
    const n = await note("Uno\n\nDue", true, 1);
    let composing = true;
    Object.defineProperty(n.view, "compositionStarted", { configurable: true, get: () => composing });
    await change(false);
    expect(handles(n), "la composizione non si interrompe").toBe(true);
    composing = false;
    n.view.contentDOM.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    await settle();
    expect(handles(n)).toBe(false);
  });

  it("in Sorgente non cambia niente; tornando in Scrittura vale la chiave nuova", async () => {
    const n = await note("Uno\n\nDue", true, 1);
    n.ed.setMode("source");
    await change(false);
    expect(handles(n)).toBe(false);
    n.ed.setMode("live_preview");
    expect(handles(n)).toBe(false);
    expect(header(n)).toBe(true);
  });
});

describe("dentro una scheda di nota della lavagna (A-6, regola 3)", () => {
  it("Esc resta all'ospite nei due stati; spenti niente maniglie, Ctrl A il corpo", async () => {
    const on = await note("Uno\n\nDue", true, 1, { escapeLeaves: true });
    expect(press(on.view, "Escape")).toBe(false);
    const off = await note("Uno\n\nDue", false, 1, { escapeLeaves: true });
    expect(press(off.view, "Escape")).toBe(false);
    expect(handles(off)).toBe(false);
    press(off.view, "a", { ctrlKey: true });
    expect(chosen(off.view)).toBe("Uno\n\nDue");
  });
});

describe("il testo di un blocco", () => {
  it("toglie i segni di titoli, voci, citazioni e riquadri, e prende il codice", async () => {
    const doc = "# Uno #\n\n> citata\n> due\n\n> [!note] Titolo\n> corpo\n\n```js\nx = 1\n```\n\n1. numero\n   - figlia";
    const { view } = await note(doc, true, 0);
    const blocks = modelOf(view.state);
    const texts = blocks.map((_, index) => {
      const span = blockTextSpan(view.state, blocks, index);
      return view.state.sliceDoc(span.from, span.to);
    });
    expect(texts).toEqual(["Uno", "citata\n> due", "Titolo\n> corpo", "x = 1", "numero", "figlia"]);
  });
});
