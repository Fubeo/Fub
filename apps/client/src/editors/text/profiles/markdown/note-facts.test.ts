// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import type { NoteFacts, NoteFactsSource } from "../../../../state/note-facts";
import { openLifetime } from "../../../../ui/lifetime";
import { markdownGrammar } from "./grammar";
import {
  noteFactsChanged,
  noteFactsExtensions,
  noteFactsLabels,
  noteFactsPlace,
  renderNoteFacts,
  type NoteFactsActions,
} from "./note-facts";
import { mountMarkdownSurface, type MarkdownSurface } from "./surface";

const setLanguage = (language: string) => vi.stubGlobal("navigator", { language });

/// L'ora del banco, e due minuti prima.
const NOW = Date.parse("2026-08-19T09:30:00+02:00");
const BEFORE = Date.parse("2026-08-19T09:28:00+02:00");
const FACTS: NoteFacts = { modified: BEFORE, links: 3, tags: ["tema", "banco"] };

const actions = (): NoteFactsActions & { links: number; tags: string[] } => {
  const seen = { links: 0, tags: [] as string[] };
  return {
    get links() { return seen.links; },
    get tags() { return seen.tags; },
    openLinks: () => { seen.links++; },
    searchTag: (tag) => { seen.tags.push(tag); },
  };
};

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("le parole della riga", () => {
  it("i tre dati: modificata, collegamenti, etichette", () => {
    setLanguage("it");
    expect(noteFactsLabels(FACTS, NOW)).toEqual({ modified: "Modificata 2 min fa", links: "3 collegamenti", tags: ["tema", "banco"] });
  });

  it("al singolare, e in inglese", () => {
    setLanguage("it");
    expect(noteFactsLabels({ modified: null, links: 1, tags: [] }, NOW)?.links).toBe("1 collegamento");
    setLanguage("en");
    expect(noteFactsLabels(FACTS, NOW)).toEqual({ modified: "Modified 2 min. ago", links: "3 links", tags: ["tema", "banco"] });
    expect(noteFactsLabels({ modified: null, links: 1, tags: [] }, NOW)?.links).toBe("1 link");
  });

  it("una parte vuota non si scrive; tutte vuote, niente riga", () => {
    setLanguage("it");
    expect(noteFactsLabels({ modified: BEFORE, links: 0, tags: [] }, NOW)).toEqual({ modified: "Modificata 2 min fa", links: null, tags: [] });
    expect(noteFactsLabels({ modified: null, links: 0, tags: [] }, NOW)).toBeNull();
    expect(noteFactsLabels(null, NOW)).toBeNull();
  });
});

describe("la riga disegnata", () => {
  it("è un gruppo col nome, fuori dal testo, con una parte per dato", () => {
    setLanguage("it");
    const life = openLifetime();
    const row = renderNoteFacts(noteFactsLabels(FACTS, NOW)!, actions(), life);
    expect(row.className).toBe("note-facts");
    expect(row.getAttribute("contenteditable")).toBe("false");
    expect(row.getAttribute("role")).toBe("group");
    expect(row.getAttribute("aria-label")).toBe("Dati della nota");
    const parts = [...row.children] as HTMLElement[];
    expect(parts.map((part) => part.className)).toEqual(["note-fact", "note-fact", "note-fact note-fact-tags"]);
    expect(parts[0]!.querySelector("svg")?.dataset.icon).toBe("clock");
    expect(parts[0]!.textContent).toBe("Modificata 2 min fa");
    expect(parts[1]!.querySelector("svg")?.dataset.icon).toBe("backlink");
    expect(parts[1]!.textContent).toBe("3 collegamenti");
    expect([...row.querySelectorAll(".note-tag")].map((tag) => tag.textContent)).toEqual(["#tema", "#banco"]);
    life.close();
  });

  it("«3 collegamenti» apre la scheda, un'etichetta la cerca; col clic e con Invio o Spazio", () => {
    const seen = actions();
    const life = openLifetime();
    const row = renderNoteFacts(noteFactsLabels(FACTS, NOW)!, seen, life);
    const links = row.querySelectorAll<HTMLElement>(".note-fact")[1]!;
    const tag = row.querySelector<HTMLElement>(".note-tag")!;
    expect(links.getAttribute("role")).toBe("button");
    expect(links.tabIndex).toBe(0);
    links.click();
    links.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    tag.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    tag.click();
    expect(seen.links).toBe(2);
    expect(seen.tags).toEqual(["tema", "tema"]);
    life.close();
    links.click();
    expect(seen.links).toBe(2);
  });
});

function liveView(doc: string, facts: NoteFacts | null): EditorView {
  const parent = document.createElement("div");
  document.body.append(parent);
  const extensions = noteFactsExtensions({ current: () => facts, actions: actions() });
  return new EditorView({
    parent,
    state: EditorState.create({ doc, extensions: [markdown({ base: markdownGrammar }), extensions.field, extensions.live] }),
  });
}

describe("in Live", () => {
  it("dopo la riga del primo titolo, e il testo della nota non cambia", () => {
    const doc = "# Benvenuto\n\nUn paragrafo.\n\n# Secondo\n";
    const view = liveView(doc, FACTS);
    expect(noteFactsPlace(view.state)).toEqual({ at: "# Benvenuto".length, side: 1 });
    const row = view.dom.querySelector(".cm-content .note-facts");
    expect(row).not.toBeNull();
    expect(row!.previousElementSibling?.textContent).toBe("# Benvenuto");
    expect(view.state.doc.toString()).toBe(doc);
    view.destroy();
  });

  it("senza titolo in cima al testo, dopo il frontmatter se c'è", () => {
    expect(noteFactsPlace(EditorState.create({ doc: "Solo testo.\n", extensions: markdown({ base: markdownGrammar }) }))).toEqual({ at: 0, side: -1 });
    const state = EditorState.create({ doc: "---\ntags: [a]\n---\nTesto\n", extensions: markdown({ base: markdownGrammar }) });
    expect(noteFactsPlace(state)).toEqual({ at: "---\ntags: [a]\n---".length, side: 1 });
  });

  it("senza dati non c'è; arrivano i dati e compare, se ne vanno e sparisce", () => {
    const view = liveView("# Titolo\n", null);
    expect(view.dom.querySelector(".note-facts")).toBeNull();
    view.dispatch({ effects: noteFactsChanged.of(FACTS) });
    expect(view.dom.querySelector(".note-facts")).not.toBeNull();
    view.dispatch({ effects: noteFactsChanged.of({ modified: null, links: 0, tags: [] }) });
    expect(view.dom.querySelector(".note-facts")).toBeNull();
    view.destroy();
  });

  it("cento etichette stanno in una riga sola che va a capo", () => {
    const tags = Array.from({ length: 100 }, (_, index) => `t${index}`);
    const view = liveView("# Titolo\n", { modified: null, links: 0, tags });
    expect(view.dom.querySelectorAll(".note-facts").length).toBe(1);
    expect(view.dom.querySelectorAll(".note-tag").length).toBe(100);
    view.destroy();
  });
});

interface Mounted {
  ed: MarkdownSurface;
  parent: HTMLElement;
  follow: ReturnType<typeof vi.fn>;
  draw: (facts: NoteFacts) => void;
  openLinks: ReturnType<typeof vi.fn>;
  searchTag: ReturnType<typeof vi.fn>;
}

function surface(doc = "# Benvenuto\n\nTesto.\n"): Mounted {
  const parent = document.createElement("div");
  document.body.append(parent);
  let draw: (facts: NoteFacts) => void = () => {};
  const follow = vi.fn((_doc: () => string, next: (facts: NoteFacts) => void) => {
    draw = next;
    return () => {};
  });
  const openLinks = vi.fn();
  const searchTag = vi.fn();
  const source: NoteFactsSource = { follow, openLinks };
  const ed = mountMarkdownSurface({ paneId: "riquadro", documentId: "Benvenuto.md", parent }, {
    onChange: () => {},
    onSelectionChange: () => {},
    onOpenWikilink: () => {},
    onOpenPath: () => {},
    onSearchTag: searchTag,
    completions: { searchNotes: async () => [], listTags: async () => [] },
    noteFacts: source,
  });
  ed.buffer.setDoc(doc);
  return { ed, parent, follow, draw: (facts) => draw(facts), openLinks, searchTag };
}

describe("nella superficie", () => {
  it("una lettura sola all'apertura, nessuna a ogni battuta", () => {
    const { ed, parent, follow } = surface();
    const view = EditorView.findFromDOM(parent)!;
    for (const char of "nuove parole") view.dispatch({ changes: { from: view.state.doc.length, insert: char }, userEvent: "input.type" });
    expect(follow).toHaveBeenCalledTimes(1);
    expect(follow.mock.calls[0]![0]()).toBe("Benvenuto.md");
    ed.destroy();
  });

  it("in Live sotto il titolo, in Sorgente no, in Lettura dopo il primo h1", () => {
    setLanguage("it");
    const { ed, parent, draw, openLinks, searchTag } = surface();
    draw(FACTS);
    expect(parent.querySelector(".cm-content .note-facts")).not.toBeNull();
    ed.setMode("source");
    expect(parent.querySelector(".note-facts")).toBeNull();
    ed.setMode("reading");
    const reading = parent.querySelector<HTMLElement>(".markdown-rendered")!;
    const row = reading.querySelector<HTMLElement>(".note-facts")!;
    expect(row.previousElementSibling?.tagName).toBe("H1");
    row.querySelectorAll<HTMLElement>(".note-fact")[1]!.click();
    row.querySelector<HTMLElement>(".note-tag")!.click();
    expect(openLinks).toHaveBeenCalledTimes(1);
    expect(searchTag).toHaveBeenCalledWith("tema");
    // La copia della resa (la presentazione) non porta la riga.
    const host = document.createElement("div");
    const unmount = ed.mountPresentation(host);
    expect(host.querySelector("h1")).not.toBeNull();
    expect(host.querySelector(".note-facts")).toBeNull();
    unmount();
    ed.setMode("live_preview");
    expect(reading.querySelector(".note-facts")).toBeNull();
    expect(parent.querySelector(".cm-content .note-facts")).not.toBeNull();
    ed.destroy();
  });

  it("nei Blocchi sotto il titolo della testata, e non anche nel testo", async () => {
    const { ed, parent, draw } = surface();
    draw(FACTS);
    ed.setMode("blocks");
    await vi.waitFor(() => expect(parent.querySelector(".cm-fub-page")).not.toBeNull());
    const rows = parent.querySelectorAll(".note-facts");
    expect(rows.length).toBe(1);
    expect(rows[0]!.previousElementSibling?.classList.contains("cm-fub-page-title")).toBe(true);
    // Dati nuovi: la riga cambia e la testata resta quella.
    const header = parent.querySelector(".cm-fub-page");
    draw({ modified: null, links: 1, tags: [] });
    expect(parent.querySelector(".cm-fub-page")).toBe(header);
    expect(parent.querySelector(".note-facts")?.textContent).toContain("1");
    ed.destroy();
  });

  it("due riquadri sulla stessa nota seguono ognuno per sé", () => {
    const left = surface();
    const right = surface();
    left.draw(FACTS);
    expect(left.parent.querySelector(".note-facts")).not.toBeNull();
    expect(right.parent.querySelector(".note-facts")).toBeNull();
    right.draw(FACTS);
    expect(right.parent.querySelector(".note-facts")).not.toBeNull();
    left.ed.destroy();
    right.ed.destroy();
  });
});
