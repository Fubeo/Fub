// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CommandSpec } from "../host/contract";
import type { EditorSurface } from "../editors/core/registry";
import type { SelectionBox, SurfaceEditorActions } from "../editors/core/editor-actions";
import { registerFormatIcons } from "./format-bar";
import { bubblePlace, createSelectionBubble, FORMATBAR_EVENT, type SelectionBubble } from "./selection-bubble";

const VIEW = { width: 1000, height: 700 };
const SIZE = { width: 200, height: 36 };

describe("dove sta la bolla", () => {
  it("sopra il testo, centrata", () => {
    const at = bubblePlace({ left: 400, top: 300, right: 500, bottom: 320 }, SIZE, VIEW);
    expect(at).toEqual({ left: 350, top: 256 });
  });

  it("sotto il testo quando sopra non c'è posto", () => {
    const at = bubblePlace({ left: 400, top: 20, right: 500, bottom: 40 }, SIZE, VIEW);
    expect(at.top).toBe(48);
  });

  it("mai fuori dai bordi della finestra", () => {
    expect(bubblePlace({ left: 0, top: 300, right: 20, bottom: 320 }, SIZE, VIEW).left).toBe(8);
    expect(bubblePlace({ left: 980, top: 300, right: 1000, bottom: 320 }, SIZE, VIEW).left).toBe(792);
  });
});

function spec(id: string, title: string): CommandSpec {
  return {
    id, title, description: "", keybinding: null, params: [],
    scope: { writes: false, reach: "session", reversible: true }, surfaces: ["toolbar"],
  };
}

const SPECS = [spec("text.undo", "Annulla"), spec("markdown.bold", "Grassetto"), spec("markdown.heading.1", "Titolo 1")];

function fixture() {
  let box: SelectionBox | null = { left: 400, top: 300, right: 500, bottom: 320 };
  const listeners = new Set<() => void>();
  const runs: string[] = [];
  const actions: SurfaceEditorActions = {
    has: (id) => id === "markdown.bold" || id === "markdown.heading.1" || id === "text.undo",
    editable: () => true,
    state: () => ({ enabled: true, active: false }),
    run: (id) => (runs.push(id), true),
    chord: () => null,
    subscribe: (listener) => (listeners.add(listener), () => listeners.delete(listener)),
    selectionBox: () => box,
  };
  const surface = { family: "text", profile: "markdown", surfaceId: "p", modes: [], setMode: () => {}, editorActions: actions, destroy: () => {} } as EditorSurface;
  return {
    surface,
    runs,
    select(next: SelectionBox | null) {
      box = next;
      for (const listener of listeners) listener();
    },
  };
}

describe("la bolla di selezione", () => {
  let off = true;
  let bubble: SelectionBubble;
  let stop: () => void;
  const frames = async () => {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
  };

  beforeEach(() => {
    off = true;
    stop = registerFormatIcons();
  });
  afterEach(() => {
    bubble?.destroy();
    stop();
    document.body.innerHTML = "";
  });

  function make(f: ReturnType<typeof fixture>) {
    bubble = createSelectionBubble({
      surface: () => f.surface,
      writing: () => true,
      focusPane: () => {},
      runCommand: () => {},
      wanted: () => off,
      active: () => true,
    });
    bubble.update(SPECS);
  }

  it("compare con un testo scelto e la barra spenta, e porta solo i gesti sul testo", async () => {
    make(fixture());
    await frames();
    expect(bubble.element.hidden).toBe(false);
    const commands = [...bubble.element.querySelectorAll<HTMLElement>("[data-command]")].map((el) => el.dataset["command"]);
    expect(commands).toEqual(["markdown.bold"]);
  });

  it("non compare con la barra accesa", async () => {
    off = false;
    make(fixture());
    await frames();
    expect(bubble.element.hidden).toBe(true);
  });

  it("sparisce quando la selezione si svuota e torna quando c'è di nuovo", async () => {
    const f = fixture();
    make(f);
    await frames();
    f.select(null);
    await frames();
    expect(bubble.element.hidden).toBe(true);
    f.select({ left: 10, top: 100, right: 60, bottom: 120 });
    await frames();
    expect(bubble.element.hidden).toBe(false);
  });

  it("a selezione ferma, un altro avviso non riscrive nulla: in WebKit ogni attributo riscritto ridipinge", async () => {
    const f = fixture();
    make(f);
    await frames();
    const records: MutationRecord[] = [];
    const observer = new MutationObserver((list) => records.push(...list));
    observer.observe(bubble.element, { attributes: true });
    for (let step = 0; step < 3; step++) {
      f.select({ left: 400, top: 300, right: 500, bottom: 320 });
      await frames();
    }
    records.push(...observer.takeRecords());
    expect(records.map((record) => record.attributeName)).toEqual([]);
    f.select({ left: 10, top: 100, right: 60, bottom: 120 });
    await frames();
    records.push(...observer.takeRecords());
    observer.disconnect();
    // Si sposta: `left` e `top`, nient'altro.
    expect([...new Set(records.map((record) => record.attributeName))]).toEqual(["style"]);
  });

  it("un clic esegue l'azione sulla superficie", async () => {
    const f = fixture();
    make(f);
    await frames();
    bubble.element.querySelector<HTMLButtonElement>("[data-command='markdown.bold']")!.click();
    expect(f.runs).toEqual(["markdown.bold"]);
  });

  it("l'evento della barra la fa riconsiderare", async () => {
    off = false;
    make(fixture());
    await frames();
    expect(bubble.element.hidden).toBe(true);
    off = true;
    window.dispatchEvent(new CustomEvent(FORMATBAR_EVENT));
    await frames();
    expect(bubble.element.hidden).toBe(false);
  });

  it("si posa con la misura vera, coi decimali, e si riposa quando la misura cambia", async () => {
    // Un `ResizeObserver` finto, che il test fa parlare quando vuole.
    const observers: ((entries: unknown[]) => void)[] = [];
    const original = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      constructor(callback: (entries: unknown[]) => void) {
        observers.push(callback);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    try {
      const f = fixture();
      f.select({ left: 221.96875, top: 300, right: 300.921875, bottom: 320 });
      make(f);
      // Il motore la misura 451,84 px: arrotondata a 452 il centro cadrebbe a
      // 35,4 e la bolla a 35 px; quella vera va a 35,5, cioè a 36.
      bubble.element.getBoundingClientRect = () => ({ width: 451.84375, height: 36 }) as DOMRect;
      await frames();
      expect(bubble.element.style.left).toBe("36px");
      // La stessa misura dal `ResizeObserver` non la sposta.
      const report = (width: number) => {
        for (const observer of observers) observer([{ borderBoxSize: [{ inlineSize: width, blockSize: 36 }] }]);
      };
      report(451.84375);
      await frames();
      expect(bubble.element.style.left).toBe("36px");
      // Una misura nuova la riposa, centrata, senza aspettare un altro avviso.
      report(100);
      await frames();
      expect(bubble.element.style.left).toBe(`${Math.round((221.96875 + 300.921875) / 2 - 50)}px`);
    } finally {
      globalThis.ResizeObserver = original;
    }
  });

  it("smontata, non lascia la bolla né ascolti", async () => {
    const f = fixture();
    make(f);
    bubble.destroy();
    expect(document.querySelector(".selection-bubble")).toBeNull();
    f.select(null);
  });
});
