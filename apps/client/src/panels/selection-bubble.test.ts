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

  it("smontata, non lascia la bolla né ascolti", async () => {
    const f = fixture();
    make(f);
    bubble.destroy();
    expect(document.querySelector(".selection-bubble")).toBeNull();
    f.select(null);
  });
});
