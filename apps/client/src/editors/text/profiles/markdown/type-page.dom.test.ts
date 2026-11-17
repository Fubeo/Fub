// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { markdown } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { embeddedViewsDiscovered, setEmbeddedViewHost, type EmbeddedViewHost } from "../../../../ui/embedded-views";
import { markdownGrammar } from "./grammar";
import { livePreview } from "./livepreview";
import { refreshTypePage, TYPE_PAGE_VIEW, typePageOf, type TypePageSource } from "./type-page";

// La pagina del tipo (T33, E5) è un widget dopo l'ultima riga della nota del
// tipo: la vista del componente delle proprietà ci si monta, e il documento,
// che è il modello delle note nuove, non la contiene mai.

const TYPE = "Tipi/Libro.md";
const TEXT = "---\nicon: book\nfeatured: [autore]\n---\n# {{title}}\n\nNote di lettura.";
/// Ciò che la vista disegnerebbe: un testo riconoscibile nel contenitore.
const DRAWN = "Note di tipo Libro · 2";

let known: Set<string>;
let host: {
  known: EmbeddedViewHost["known"];
  mount: Mock<EmbeddedViewHost["mount"]>;
  unmount: Mock<EmbeddedViewHost["unmount"]>;
};

beforeEach(() => {
  vi.stubGlobal("navigator", { language: "it" });
  known = new Set([TYPE_PAGE_VIEW]);
  host = {
    known: (view) => known.has(view),
    mount: vi.fn<EmbeddedViewHost["mount"]>((_view, _instance, container) => {
      const drawn = document.createElement("details");
      drawn.className = "ui-section";
      drawn.open = true;
      const summary = document.createElement("summary");
      summary.textContent = DRAWN;
      drawn.append(summary);
      container.replaceChildren(drawn);
      return Promise.resolve();
    }),
    unmount: vi.fn<EmbeddedViewHost["unmount"]>(),
  };
  setEmbeddedViewHost(host);
});

afterEach(() => {
  setEmbeddedViewHost(null);
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

function open(source: TypePageSource, doc = TEXT): EditorView {
  const parent = document.createElement("div");
  document.body.append(parent);
  return new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [markdown({ base: markdownGrammar }), livePreview({ openWikilink() {}, searchTag() {}, typePage: source })],
    }),
  });
}

/// Ciò che CodeMirror mette negli appunti copiando la selezione.
function copied(view: EditorView): string {
  let text = "";
  const event = new Event("copy", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: {
      clearData() {},
      setData(type: string, value: string) {
        if (type === "text/plain") text = value;
      },
    },
  });
  view.contentDOM.dispatchEvent(event);
  return text;
}

const pageOf = (view: EditorView) => view.contentDOM.querySelector<HTMLElement>(".cm-day-page[data-type-page]");

describe("la pagina del tipo", () => {
  it("sta dopo l'ultima riga, con la vista del componente, e non entra nel testo", () => {
    const view = open({ current: () => TYPE });
    try {
      const page = pageOf(view);
      expect(page).not.toBeNull();
      expect(page!.contentEditable).toBe("false");
      expect(page!.getAttribute("aria-label")).toBe("Le note di questo tipo");
      const lines = [...view.contentDOM.querySelectorAll(".cm-line")];
      expect(lines[lines.length - 1]!.compareDocumentPosition(page!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(page!.closest(".cm-line")).toBeNull();
      expect(host.mount).toHaveBeenCalledTimes(1);
      expect(host.mount.mock.calls[0]![0]).toBe(TYPE_PAGE_VIEW);
      expect(host.mount.mock.calls[0]![3]).toEqual({ doc: TYPE });
      expect(page!.textContent).toContain(DRAWN);
      // Il tipo è il file e basta: il modello delle note nuove non porta la
      // pagina, né lo stato né la copia.
      expect(view.state.doc.toString()).toBe(TEXT);
      view.dispatch({ selection: EditorSelection.single(0, view.state.doc.length) });
      view.focus();
      expect(copied(view)).not.toContain(DRAWN);
      expect(typePageOf(view.state)).toBe(TYPE);
    } finally {
      view.destroy();
    }
    // Chiuso l'editor, la vista si smonta.
    expect(host.unmount).toHaveBeenCalledTimes(1);
  });

  it("scrivendo nel tipo resta in fondo, con la stessa vista: non si rilegge per battuta", () => {
    const view = open({ current: () => TYPE });
    try {
      const page = pageOf(view);
      for (const letter of "Altro") view.dispatch({ changes: { from: view.state.doc.length, insert: letter } });
      expect(pageOf(view)).toBe(page);
      expect(host.mount).toHaveBeenCalledTimes(1);
    } finally {
      view.destroy();
    }
  });

  it("compare quando il core dice che la nota è un tipo, e sparisce quando non lo è più", () => {
    let current: string | null = null;
    const view = open({ current: () => current });
    try {
      expect(pageOf(view)).toBeNull();
      expect(host.mount).not.toHaveBeenCalled();
      current = TYPE;
      refreshTypePage(view);
      expect(pageOf(view)).not.toBeNull();
      expect(host.mount).toHaveBeenCalledTimes(1);
      // La stessa risposta non rifà niente.
      refreshTypePage(view);
      expect(host.mount).toHaveBeenCalledTimes(1);
      // La cartella dei tipi è cambiata: la nota non è più un tipo.
      current = null;
      refreshTypePage(view);
      expect(pageOf(view)).toBeNull();
      expect(typePageOf(view.state)).toBeNull();
      expect(view.state.doc.toString()).toBe(TEXT);
    } finally {
      view.destroy();
    }
  });

  it("col componente delle proprietà spento la pagina sparisce, e torna quando si riaccende", () => {
    known.clear();
    const view = open({ current: () => TYPE });
    try {
      embeddedViewsDiscovered();
      const page = pageOf(view);
      expect(page?.hidden).toBe(true);
      expect(host.mount).not.toHaveBeenCalled();
      known.add(TYPE_PAGE_VIEW);
      embeddedViewsDiscovered();
      expect(page?.hidden).toBe(false);
      expect(host.mount).toHaveBeenCalledTimes(1);
    } finally {
      view.destroy();
    }
  });
});
