// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { markdown } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { embeddedViewsDiscovered, setEmbeddedViewHost, type EmbeddedViewHost } from "../../../../ui/embedded-views";
import { DAY_PAGE_VIEW, dayPageOf, type DayPageSource } from "./day-page";
import { markdownGrammar } from "./grammar";
import { livePreview } from "./livepreview";

// La pagina del giorno (T39) è un widget dopo l'ultima riga: la vista del
// componente ci si monta, e il documento non la contiene mai.

const DAILY = { doc: "Diario/2026-08-19.md", date: "2026-08-19" };
const TEXT = "# 19 agosto\n\nIl banco vede.\n\n- [ ] I caratteri";
/// Ciò che la vista disegnerebbe: un testo riconoscibile nel contenitore.
const DRAWN = "Compiti di oggi · 1";

let known: Set<string>;
let host: {
  known: EmbeddedViewHost["known"];
  mount: Mock<EmbeddedViewHost["mount"]>;
  unmount: Mock<EmbeddedViewHost["unmount"]>;
};

beforeEach(() => {
  known = new Set([DAY_PAGE_VIEW]);
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
});

function open(source: DayPageSource, doc = TEXT): EditorView {
  const parent = document.createElement("div");
  document.body.append(parent);
  return new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [markdown({ base: markdownGrammar }), livePreview({ openWikilink() {}, searchTag() {}, dayPage: source })],
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

describe("la pagina del giorno", () => {
  it("sta dopo l'ultima riga, con la vista del componente, e non entra nel testo", () => {
    const view = open({ current: () => DAILY });
    try {
      const page = view.contentDOM.querySelector<HTMLElement>(".cm-day-page");
      expect(page).not.toBeNull();
      expect(page!.contentEditable).toBe("false");
      expect(page!.getAttribute("aria-label")).toBe("La pagina del giorno");
      // Dopo l'ultima riga del testo, fuori da ogni riga.
      const lines = [...view.contentDOM.querySelectorAll(".cm-line")];
      expect(lines.length).toBeGreaterThan(0);
      expect(lines[lines.length - 1]!.compareDocumentPosition(page!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(page!.closest(".cm-line")).toBeNull();
      expect(host.mount).toHaveBeenCalledTimes(1);
      expect(host.mount.mock.calls[0]![0]).toBe(DAY_PAGE_VIEW);
      expect(host.mount.mock.calls[0]![3]).toEqual({ doc: DAILY.doc, date: DAILY.date });
      expect(page!.textContent).toContain(DRAWN);
      // Il documento è il file e basta: né lo stato né la copia di tutto
      // contengono la pagina.
      expect(view.state.doc.toString()).toBe(TEXT);
      view.dispatch({ selection: EditorSelection.single(0, view.state.doc.length) });
      view.focus();
      expect(copied(view)).toBe(TEXT);
      expect(copied(view)).not.toContain(DRAWN);
      expect(dayPageOf(view.state)).toEqual(DAILY);
    } finally {
      view.destroy();
    }
  });

  it("scrivendo resta in fondo, con la stessa vista: non si rilegge per battuta", () => {
    const view = open({ current: () => DAILY });
    try {
      const page = view.contentDOM.querySelector(".cm-day-page");
      for (const letter of "Due righe") {
        view.dispatch({ changes: { from: view.state.doc.length, insert: letter } });
      }
      view.dispatch({ changes: { from: view.state.doc.length, insert: "\nUn'altra riga" } });
      expect(view.contentDOM.querySelector(".cm-day-page")).toBe(page);
      expect(host.mount).toHaveBeenCalledTimes(1);
      const lines = [...view.contentDOM.querySelectorAll(".cm-line")];
      expect(lines[lines.length - 1]!.compareDocumentPosition(page!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(view.state.doc.toString()).toBe(`${TEXT}Due righe\nUn'altra riga`);
    } finally {
      view.destroy();
    }
    // Chiuso l'editor, la vista si smonta.
    expect(host.unmount).toHaveBeenCalledTimes(1);
  });

  it("una nota che non è una giornaliera non ha la pagina", () => {
    const view = open({ current: () => null });
    try {
      expect(view.contentDOM.querySelector(".cm-day-page")).toBeNull();
      expect(host.mount).not.toHaveBeenCalled();
      expect(dayPageOf(view.state)).toBeNull();
    } finally {
      view.destroy();
    }
  });

  it("col componente dei template spento la pagina sparisce, e torna quando si riaccende", () => {
    known.clear();
    const view = open({ current: () => DAILY });
    try {
      embeddedViewsDiscovered();
      const page = view.contentDOM.querySelector<HTMLElement>(".cm-day-page");
      expect(page?.hidden).toBe(true);
      expect(host.mount).not.toHaveBeenCalled();
      known.add(DAY_PAGE_VIEW);
      embeddedViewsDiscovered();
      expect(page?.hidden).toBe(false);
      expect(host.mount).toHaveBeenCalledTimes(1);
    } finally {
      view.destroy();
    }
  });
});
