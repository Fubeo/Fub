// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { markdown } from "@codemirror/lang-markdown";
import { history, undo } from "@codemirror/commands";
import { EditorState, Prec } from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { markdownGrammar } from "../grammar";
import { livePreview } from "../livepreview";
import { liveReveal } from "../../../live-reveal";
import { propertiesDisplay } from "../../../properties-display";
import { renderMarkdown } from "../render";
import { blocksMode, plainMode } from "../blocks/index";
import { retitleView } from "../blocks/page";
import { mountReadingHeader } from "./header";
import { firstHeading } from "./title";
import { renamedPageName } from "../../../../../state/page-rename";
import corpus from "../../../../../__fixtures__/corpus-syntax.json";
import "../../../../../i18n/strings";
import { parsedView } from "../test-support";

// Il titolo e il primo H1 (T7): il titolo è il nome del file, e un primo H1
// che dice la stessa cosa si ripiega nel titolo, in Scrittura e in Lettura.
// Rinominare dal titolo riscrive anche l'H1, nello stesso gesto.

const views: EditorView[] = [];
beforeEach(() => vi.stubGlobal("navigator", { language: "it" }));
afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

interface Page {
  name: string;
  renames: string[];
  /// La risposta della rinomina: `null` riuscita, una frase se no.
  answer: string | null;
  /// Il rifiuto dell'host: la rinomina lancia invece di rispondere.
  refusal?: unknown;
}

function mount(
  doc: string,
  page: Page,
  options: { readOnly?: boolean; plain?: boolean; renamedPage?: (name: string) => string; notify?: (message: string, tone: string) => void } = {},
): EditorView {
  const pageOptions = {
    page: () => page.name,
    ...(options.renamedPage ? { renamedPage: options.renamedPage } : {}),
    ...(options.notify ? { notify: options.notify } : {}),
    rename: async (name: string) => {
      page.renames.push(name);
      if (page.refusal !== undefined) throw page.refusal;
      if (page.answer === null) page.name = name;
      return page.answer;
    },
  };
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      extensions: [
        history(),
        markdown({ base: markdownGrammar }),
        livePreview({ openWikilink() {}, searchTag() {} }),
        Prec.highest(liveReveal.of("mai")),
        propertiesDisplay.of("visible"),
        EditorState.readOnly.of(options.readOnly ?? false),
        options.plain ? plainMode(pageOptions) : blocksMode(pageOptions),
      ],
    }),
  });
  parsedView(view);
  views.push(view);
  return view;
}

const page = (name: string, answer: string | null = null): Page => ({ name, renames: [], answer });
const titleOf = (view: EditorView) => view.dom.querySelector<HTMLInputElement>("input.cm-fub-page-title")!;
const press = (target: HTMLElement, key: string) =>
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));
const shown = (view: EditorView) => view.contentDOM.textContent ?? "";

describe("il primo H1 in Scrittura", () => {
  it("uguale al nome si ripiega nel titolo: non si vede, e il file non cambia", () => {
    const doc = "---\nstato: aperto\n---\n# Mostra di primavera\n\nIl testo.";
    const view = mount(doc, page("Mostra di primavera"));
    expect(titleOf(view).value).toBe("Mostra di primavera");
    expect(shown(view)).not.toContain("# Mostra");
    expect(view.contentDOM.querySelector(".cm-fub-h1-line, .cm-fub-h1")).toBeNull();
    expect(shown(view)).toContain("Il testo.");
    expect(view.state.doc.toString()).toBe(doc);
  });

  it("anche con la formattazione, dopo un commento %% e senza frontmatter; coi blocchi spenti lo stesso", () => {
    const formatted = mount("# **Mostra** di primavera\nTesto", page("Mostra di primavera"));
    expect(shown(formatted)).not.toContain("Mostra");
    const commented = mount("%% per me %%\n# Mostra\nTesto", page("mostra"));
    expect(shown(commented)).not.toContain("Mostra");
    const plain = mount("# Mostra\nTesto", page("Mostra"), { plain: true });
    expect(shown(plain)).not.toContain("Mostra");
  });

  it("diverso dal nome, o non in cima, resta un titolo del testo", () => {
    expect(shown(mount("# Un altro titolo\nTesto", page("Mostra")))).toContain("Un altro titolo");
    expect(shown(mount("Prima.\n\n# Mostra\nTesto", page("Mostra")))).toContain("Mostra");
  });

  it("ciò che si scrive prima dell'H1 nascosto scende sotto, dove comincia il testo", () => {
    for (const [doc, expected] of [
      ["# Mostra\n\nTesto", "# Mostra\n\nCiaoTesto"],
      ["---\na: 1\n---\n# Mostra\nTesto", "---\na: 1\n---\n# Mostra\nCiaoTesto"],
      ["# Mostra", "# Mostra\nCiao"],
    ] as const) {
      const view = mount(doc, page("Mostra"));
      view.dispatch({ changes: { from: 0, insert: "Ciao" }, selection: { anchor: 4 }, userEvent: "input.type" });
      expect(view.state.doc.toString(), doc).toBe(expected);
      expect(shown(view), doc).not.toContain("Mostra");
    }
  });

  it("Ctrl-Home in una nota senza frontmatter porta al testo, non dentro il titolo nascosto", () => {
    const view = mount("# Mostra\n\nTesto", page("Mostra"));
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    view.dispatch({ selection: { anchor: 0 }, userEvent: "select" });
    expect(view.state.selection.main.head).toBe("# Mostra\n\n".length);
    expect(shown(view)).not.toContain("Mostra");
  });

  it("il cursore dell'apertura, prima dell'H1 nascosto, scende sotto con la prima modifica che non si batte", () => {
    for (const doc of ["# Mostra\n", "# Mostra\n\nTesto"]) {
      const view = mount(doc, page("Mostra"));
      expect(view.state.selection.main.head).toBe(0);
      // Il testo appeso da un altro riquadro: in fondo, nessun gesto qui.
      view.dispatch({ changes: { from: view.state.doc.length, insert: "\naltro" } });
      expect(view.state.doc.toString(), doc).toBe(`${doc}\naltro`);
      expect(view.state.selection.main.head, doc).toBe("# Mostra\n\n".length);
      expect(shown(view), doc).not.toContain("Mostra");
    }
  });

  it("una selezione che ci entra lo rivede: niente si scrive al buio", () => {
    const view = mount("# Mostra\n\nTesto", page("Mostra"));
    view.dispatch({ selection: { anchor: 3 } });
    expect(shown(view)).toContain("Mostra");
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    expect(shown(view)).not.toContain("Mostra");
  });

  it("↓ dal titolo e Invio portano al testo sotto l'H1; Backspace lì non lo unisce al titolo", () => {
    const doc = "# Mostra\n\nTesto";
    const view = mount(doc, page("Mostra"));
    const title = titleOf(view);
    title.focus();
    press(title, "ArrowDown");
    // Senza proprietà, «Aggiungi una proprietà» e poi il testo.
    press(document.activeElement as HTMLElement, "ArrowDown");
    expect(view.state.selection.main.head).toBe(doc.indexOf("Testo"));
    expect(shown(view)).not.toContain("Mostra");
    expect(runScopeHandlers(view, new KeyboardEvent("keydown", { key: "Backspace" }), "editor")).toBe(true);
    expect(view.state.doc.toString()).toBe(doc);
  });
});

describe("il titolo e la rinomina", () => {
  it("una rinomina che l'host rifiuta dice che cosa non è riuscito e la specie dell'errore, e il titolo torna quello di prima", async () => {
    const doc = "---\na: 1\n---\n# Mostra\n\nTesto";
    const note = { ...page("Mostra"), refusal: { kind: "permission_denied", message: "il vault è di sola lettura" } };
    const notices: Array<[string, string]> = [];
    const view = mount(doc, note, { notify: (message, tone) => notices.push([message, tone]) });
    const title = titleOf(view);
    title.focus();
    title.value = "Mostra d'estate";
    press(title, "Enter");
    await settled();
    expect(notices).toEqual([["Non ho potuto rinominare la pagina in «Mostra d'estate»: non è permesso", "guasto"]]);
    expect(view.state.doc.toString()).toBe(doc);
    expect(titleOf(view).value).toBe("Mostra");
  });

  it("Invio rinomina e riscrive l'H1 ripiegato nello stesso gesto: un annulla lo riporta", async () => {
    const doc = "---\na: 1\n---\n# Mostra\n\nTesto";
    const note = page("Mostra");
    const view = mount(doc, note);
    const title = titleOf(view);
    title.focus();
    title.value = "Mostra d'estate";
    press(title, "Enter");
    await settled();
    expect(note.renames).toEqual(["Mostra d'estate"]);
    expect(view.state.doc.toString()).toBe("---\na: 1\n---\n# Mostra d'estate\n\nTesto");
    // Il titolo nuovo e l'H1 nuovo dicono la stessa cosa: resta ripiegato.
    expect(titleOf(view).value).toBe("Mostra d'estate");
    expect(shown(view)).not.toContain("Mostra d'estate");
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(doc);
  });

  it("un titolo con «/» sposta il file: l'H1 prende il nome della pagina, non il percorso", async () => {
    const doc = "# Mostra\n\nTesto";
    const note = page("Mostra");
    const view = mount(doc, note, { renamedPage: (name) => renamedPageName("Mostra.md", name) });
    const title = titleOf(view);
    title.focus();
    title.value = "Archivio/Nuova";
    press(title, "Enter");
    await settled();
    expect(note.renames).toEqual(["Archivio/Nuova"]);
    expect(view.state.doc.toString()).toBe("# Nuova\n\nTesto");
  });

  it("l'uscita dal campo rinomina; senza H1 ripiegato il testo non cambia", async () => {
    const doc = "# Un altro titolo\nTesto";
    const note = page("Mostra");
    const view = mount(doc, note);
    const title = titleOf(view);
    title.focus();
    title.value = "Nuova";
    title.dispatchEvent(new FocusEvent("blur"));
    await settled();
    expect(note.renames).toEqual(["Nuova"]);
    expect(view.state.doc.toString()).toBe(doc);
  });

  it("Esc torna al nome di prima e non rinomina niente", async () => {
    const doc = "# Mostra\nTesto";
    const note = page("Mostra");
    const view = mount(doc, note);
    const title = titleOf(view);
    title.focus();
    title.value = "Altro";
    press(title, "Escape");
    await settled();
    expect(title.value).toBe("Mostra");
    expect(note.renames).toEqual([]);
    expect(view.state.doc.toString()).toBe(doc);
  });

  it("una rinomina rifiutata (un nome preso, caratteri vietati) lascia l'H1 com'era e il titolo torna", async () => {
    const doc = "# Mostra\nTesto";
    const note = page("Mostra", "Il nome «Altro» c'è già");
    const view = mount(doc, note);
    const title = titleOf(view);
    title.focus();
    title.value = "Altro";
    press(title, "Enter");
    await settled();
    expect(note.renames).toEqual(["Altro"]);
    expect(view.state.doc.toString()).toBe(doc);
    expect(titleOf(view).value).toBe("Mostra");
  });

  it("in sola lettura il titolo non si modifica", () => {
    const view = mount("# Mostra\nTesto", page("Mostra"), { readOnly: true });
    expect(titleOf(view).readOnly).toBe(true);
    expect(shown(view)).not.toContain("Mostra");
    expect(retitleView(view, "Mostra", "Altro")).toBe(false);
  });

  it("una rinomina che arriva da fuori mentre si scrive il titolo: ciò che si scrive resta, e l'H1 non si tocca", () => {
    const doc = "# Mostra\nTesto";
    const note = page("Mostra");
    const view = mount(doc, note);
    const title = titleOf(view);
    title.focus();
    title.value = "Mia";
    note.name = "Da fuori";
    view.dispatch({});
    expect(titleOf(view).value).toBe("Mia");
    expect(view.state.doc.toString()).toBe(doc);
    // Il nome nuovo non è l'H1: l'H1 torna un titolo del testo.
    expect(shown(view)).toContain("Mostra");
  });
});

function reading(doc: string, name: string) {
  const element = document.createElement("div");
  element.className = "markdown-rendered";
  element.innerHTML = renderMarkdown(doc).html;
  document.body.append(element);
  const before = element.innerHTML;
  const state = EditorState.create({ doc });
  const unmount = mountReadingHeader(element, state, { page: () => name }, "visible", { open: false, set: () => {} });
  return { element, before, unmount };
}

/// L'H1 che la pelle nasconde (`skin/document.css`).
const hidden = (element: HTMLElement) => element.querySelector(".markdown-rendered > .cm-fub-page[data-title-fold] ~ h1:first-of-type");

describe("il primo H1 in Lettura", () => {
  it("uguale al nome la testata lo segna, e la pelle nasconde proprio quell'H1", () => {
    const { element } = reading("---\na: 1\n---\n%% nota %%\n# Mostra\n\n## Sezione\n\n# Altro", "Mostra");
    expect(hidden(element)?.textContent).toBe("Mostra");
  });

  it("diverso dal nome, o non in cima, non si nasconde", () => {
    expect(hidden(reading("# Altro\nTesto", "Mostra").element)).toBeNull();
    expect(hidden(reading("Testo\n\n# Mostra", "Mostra").element)).toBeNull();
  });
});

describe("sul corpus", () => {
  const cases = corpus as { name: string; source: string }[];

  it("col primo H1 ripiegato il file non cambia un byte, in Scrittura e in Lettura", () => {
    let folded = 0;
    for (const { name, source } of cases) {
      const buffer = EditorState.create({ doc: source }).doc;
      const heading = firstHeading(buffer, 0);
      const title = heading?.text || "Nota";
      if (heading) folded++;
      const view = mount(source, page(title));
      expect(view.state.doc.toString(), name).toBe(buffer.toString());
      view.destroy();
      views.splice(views.indexOf(view), 1);
      const { element, before, unmount } = reading(source, title);
      unmount();
      expect(element.innerHTML, name).toBe(before);
      element.remove();
    }
    // Il corpus ha davvero note che cominciano con un H1.
    expect(folded).toBeGreaterThan(0);
  });
});
