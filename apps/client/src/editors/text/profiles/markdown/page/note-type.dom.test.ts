// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { markdown } from "@codemirror/lang-markdown";
import { history, undo } from "@codemirror/commands";
import { EditorState, Prec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdownGrammar } from "../grammar";
import { livePreview } from "../livepreview";
import { liveReveal } from "../../../live-reveal";
import { propertiesDisplay } from "../../../properties-display";
import { blocksMode } from "../blocks/index";
import type { BlocksOptions } from "../blocks/handles";
import { refreshPageHeader } from "../blocks/page";
import type { NoteType, NoteTypeList, NoteTypeState } from "../../../../../state/note-types";
import { noteTypeSource, typedChanges } from "./note-type";
import { loadLazyParts } from "../../../../../ui/lazy-part";
import { parsedView } from "../test-support";

// Il tipo della nota nella testata (E5): le proprietà in evidenza del tipo,
// la sua icona, l'avviso di un tipo guasto con «Scegli il tipo», e «In
// evidenza» che scrive nel tipo e non nella nota.

const LIBRO: NoteType = {
  doc: "Tipi/Libro.md",
  link: "Tipi/Libro",
  name: "Libro",
  icon: "📘",
  featured: ["letto", "autore"],
  properties: [
    { key: "autore", kind: "text" },
    { key: "letto", kind: "checkbox" },
    { key: "generi", kind: "list" },
  ],
  folder: "Biblioteca",
  notes: 0,
  readable: true,
  revision: "r1",
};
const TYPES: NoteTypeList = { folder: "Tipi", types: [LIBRO] };

const views: EditorView[] = [];
// I pezzi che arrivano con un `import()` (`ui/lazy-part.ts`) qui ci sono già,
// come dopo il riscaldamento: i gesti si guardano col loro codice.
beforeAll(loadLazyParts);
beforeEach(() => vi.stubGlobal("navigator", { language: "it" }));
afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

/// Una testata coi tipi detti da `states` (il valore di `tipo` → lo stato).
function mount(doc: string, states: Record<string, NoteTypeState>, options: Partial<BlocksOptions> = {}): EditorView {
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
        blocksMode({
          page: () => "Dune",
          noteType: (raw) => states[raw] ?? { state: "missing", wanted: raw.replace(/^\[\[|\]\]$/g, "") },
          listTypes: () => Promise.resolve(TYPES),
          ...options,
        }),
      ],
    }),
  });
  parsedView(view);
  views.push(view);
  return view;
}

const shown = (view: EditorView) => [...view.dom.querySelectorAll<HTMLElement>(".cm-fub-page-prop")].map((row) => row.dataset.key);
const keyButton = (view: EditorView, key: string) => view.dom.querySelector<HTMLElement>(`.cm-fub-page-prop[data-key="${key}"] .cm-fub-page-prop-key`)!;
const menuItem = (label: string) => [...document.querySelectorAll<HTMLElement>(".cm-fub-prop-menu [role^=menuitem]")].find((row) => row.textContent?.includes(label));
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const TYPED = "---\nanno: 1965\ntipo: \"[[Tipi/Libro]]\"\nautore: Herbert\npagine: 412\nletto: true\neditore: Chilton\n---\nTesto";

describe("il tipo nella testata", () => {
  it("mette in evidenza tipo e le proprietà del tipo, nel suo ordine; le altre stanno dietro «Altre»", () => {
    const view = mount(TYPED, { "[[Tipi/Libro]]": { state: "typed", type: LIBRO } });
    expect(shown(view)).toEqual(["tipo", "letto", "autore"]);
    expect(view.dom.querySelector(".cm-fub-page-props-more")?.textContent).toContain("3");
  });

  it("senza un'icona sua la nota mostra quella del tipo, che si cambia per la nota", () => {
    const view = mount(TYPED, { "[[Tipi/Libro]]": { state: "typed", type: LIBRO } });
    const icon = view.dom.querySelector<HTMLButtonElement>(".cm-fub-page-icon[data-from-type]");
    expect(icon?.textContent).toBe("📘");
    expect(icon?.getAttribute("aria-label")).toContain("Libro");
    // L'icona c'è già: «Aggiungi un'icona» non si offre.
    expect([...view.dom.querySelectorAll(".cm-fub-page-tool")].some((tool) => tool.textContent?.includes("icona"))).toBe(false);
  });

  it("l'icona del tipo scritta come nome nudo (`book`) è la figura, non la parola", () => {
    const view = mount(TYPED, { "[[Tipi/Libro]]": { state: "typed", type: { ...LIBRO, icon: "book" } } });
    const icon = view.dom.querySelector<HTMLElement>(".cm-fub-page-icon[data-from-type]");
    expect(icon?.querySelector("svg")).not.toBeNull();
    expect(icon?.textContent).not.toContain("book");
  });

  it("un tipo che non c'è lo dice la testata, e la nota non cambia", () => {
    const doc = "---\ntipo: \"[[Tipi/Romanzo]]\"\nautore: Herbert\n---\nTesto";
    const view = mount(doc, {});
    const notice = view.dom.querySelector<HTMLElement>(".cm-fub-page-type-notice");
    expect(notice?.getAttribute("role")).toBe("note");
    expect(notice?.textContent).toContain("«Tipi/Romanzo» non c'è");
    expect(notice?.querySelector("button")?.textContent).toBe("Scegli il tipo");
    // Senza un tipo che si legge l'evidenza è quella di una nota qualsiasi.
    expect(shown(view)).toEqual(["tipo", "autore"]);
    expect(view.state.doc.toString()).toBe(doc);
  });

  it("un tipo che non si legge offre di aprirlo, e uno ambiguo di sceglierne uno", () => {
    const opened: string[] = [];
    const unreadable = mount("---\ntipo: Libro\n---\n", { Libro: { state: "unreadable", doc: "Tipi/Libro.md", name: "Libro" } }, { openType: (doc) => opened.push(doc) });
    const buttons = [...unreadable.dom.querySelectorAll<HTMLButtonElement>(".cm-fub-page-type-notice button")];
    expect(buttons.map((button) => button.textContent)).toEqual(["Apri il tipo", "Scegli il tipo"]);
    buttons[0]!.click();
    expect(opened).toEqual(["Tipi/Libro.md"]);
    const ambiguous = mount("---\ntipo: Libro\n---\n", { Libro: { state: "ambiguous", wanted: "Libro", candidates: ["Tipi/Libro.md", "Tipi/Vecchi/Libro.md"] } });
    expect(ambiguous.dom.querySelector(".cm-fub-page-type-notice")?.textContent).toContain("Più tipi si chiamano «Libro»");
  });

  it("in sola lettura l'avviso c'è ma «Scegli il tipo» no", () => {
    const readOnly = new EditorView({
      parent: document.body,
      state: EditorState.create({
        doc: "---\ntipo: \"[[Tipi/Romanzo]]\"\n---\n",
        extensions: [EditorState.readOnly.of(true), markdown({ base: markdownGrammar }), propertiesDisplay.of("visible"), blocksMode({ page: () => "Dune", noteType: (raw) => ({ state: "missing", wanted: raw }) })],
      }),
    });
    views.push(readOnly);
    expect(readOnly.dom.querySelector(".cm-fub-page-type-notice")).not.toBeNull();
    expect(readOnly.dom.querySelector(".cm-fub-page-type-notice button")).toBeNull();
  });

  it("i tipi che non si leggono lo dicono con il soggetto, non con la sola specie", async () => {
    const notify = vi.fn();
    const view = mount("---\ntipo: \"[[Tipi/Romanzo]]\"\n---\nTesto", {}, {
      listTypes: () => Promise.reject({ kind: "internal", message: "parse failed: yaml codec" }),
      notify,
    });
    view.dom.querySelector<HTMLButtonElement>(".cm-fub-page-type-notice button")!.click();
    await settle();
    expect(notify).toHaveBeenCalledWith("Non ho potuto leggere i tipi del vault: si è verificato un problema imprevisto", "guasto");
  });

  it("«Scegli il tipo» scrive il link e le proprietà che mancano, senza togliere niente, in un passo d'annullamento", async () => {
    const doc = "---\ntipo: \"[[Tipi/Romanzo]]\"\nautore: Herbert\n---\nTesto";
    const view = mount(doc, {});
    view.dom.querySelector<HTMLButtonElement>(".cm-fub-page-type-notice button")!.click();
    await settle();
    const row = document.querySelector<HTMLElement>(".note-type-popover .note-type-menu-item");
    expect(row?.textContent).toContain("Libro");
    // Da tastiera: Invio sul primo tipo.
    row!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(view.state.doc.toString()).toBe("---\ntipo: \"[[Tipi/Libro]]\"\nautore: Herbert\nletto: false\ngeneri: []\n---\nTesto");
    undo(view);
    expect(view.state.doc.toString()).toBe(doc);
  });

  it("«In evidenza» in una nota con un tipo scrive nel tipo e non nella nota", () => {
    const calls: [string, string, boolean][] = [];
    const view = mount(TYPED, { "[[Tipi/Libro]]": { state: "typed", type: LIBRO } }, {
      featureInType: (type, key, on) => calls.push([type.doc, key, on]),
    });
    view.dom.querySelector<HTMLElement>(".cm-fub-page-props-more")!.click();
    keyButton(view, "pagine").click();
    menuItem("Metti in evidenza")!.click();
    keyButton(view, "autore").click();
    menuItem("Togli dall'evidenza")!.click();
    expect(calls).toEqual([["Tipi/Libro.md", "pagine", true], ["Tipi/Libro.md", "autore", false]]);
    expect(view.state.doc.toString()).toBe(TYPED);
    // `tipo` sta sempre in evidenza: il suo menu non lo offre.
    keyButton(view, "tipo").click();
    expect(menuItem("evidenza")).toBeUndefined();
  });

  it("la testata segue il tipo che arriva dopo, senza che il testo cambi", () => {
    const states: Record<string, NoteTypeState> = {};
    const view = mount(TYPED, states, { noteType: (raw) => states[raw] ?? null });
    expect(view.dom.querySelector(".cm-fub-page-type-notice")).toBeNull();
    expect(shown(view)).toEqual(["anno", "tipo", "autore", "pagine"]);
    states["[[Tipi/Libro]]"] = { state: "typed", type: LIBRO };
    refreshPageHeader(view);
    expect(shown(view)).toEqual(["tipo", "letto", "autore"]);
  });
});

describe("la fonte del tipo", () => {
  it("chiede subito alla prima lettura, poi solo dopo una pausa, e mai per un valore che sa già", async () => {
    vi.useFakeTimers();
    try {
      const asked: string[] = [];
      let changed = 0;
      const { openLifetime } = await import("../../../../../ui/lifetime");
      const life = openLifetime();
      const source = noteTypeSource({
        lookup: (raw) => {
          asked.push(raw);
          return Promise.resolve(raw === "[[Tipi/Libro]]" ? { state: "typed", type: LIBRO } : { state: "missing", wanted: raw });
        },
        changed: () => { changed += 1; },
        lifetime: life,
      });
      expect(source.stateFor("[[Tipi/Libro]]")).toBeNull();
      await vi.advanceTimersByTimeAsync(0);
      expect(changed).toBe(1);
      expect(source.stateFor("[[Tipi/Libro]]")?.state).toBe("typed");
      // Chi scrive il nome a mano: una domanda sola, dopo l'ultima battuta.
      source.stateFor("[[Tipi/L");
      source.stateFor("[[Tipi/Li");
      source.stateFor("[[Tipi/Lib]]");
      await vi.advanceTimersByTimeAsync(100);
      expect(asked).toEqual(["[[Tipi/Libro]]"]);
      await vi.advanceTimersByTimeAsync(400);
      expect(asked).toEqual(["[[Tipi/Libro]]", "[[Tipi/Lib]]"]);
      expect(source.stateFor("[[Tipi/Lib]]")?.state).toBe("missing");
      // Chiusa la vita, una risposta in ritardo non rifà niente.
      source.refresh();
      life.close();
      await vi.advanceTimersByTimeAsync(0);
      expect(changed).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("un frontmatter che non si legge non riceve il tipo", () => {
    const state = EditorState.create({ doc: "---\ntipo: [\n---\nTesto" });
    expect(typedChanges(state, LIBRO)).toBeNull();
  });
});
