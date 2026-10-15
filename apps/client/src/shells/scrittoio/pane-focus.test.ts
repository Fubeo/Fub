// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const world = vi.hoisted(() => ({
  layout: { focus: "a" },
  focused: [] as string[],
  editorTakesFocus: true,
}));

vi.mock("../../state/layout", () => ({
  layout: world.layout,
  focusPane: (id: string) => {
    world.layout.focus = id;
    world.focused.push(id);
  },
}));
vi.mock("../../state/document-controller", () => ({
  focusEditor: () => {
    if (!world.editorTakesFocus) return;
    document.querySelector<HTMLElement>(`.pane[data-pane="${world.layout.focus}"] .editor`)?.focus();
  },
}));

import { focusNeighbour, neighbour, paneBoxes, type PaneBox } from "./pane-focus";

const box = (id: string, left: number, top: number, right: number, bottom: number): PaneBox => ({ id, left, top, right, bottom });

describe("il foglio accanto, dalle caselle", () => {
  // Due colonne: a sinistra un foglio intero, a destra due impilati.
  const boxes = [box("a", 0, 0, 400, 600), box("b", 408, 0, 800, 296), box("c", 408, 304, 800, 600)];

  it("a destra di un foglio intero sta quello che si affaccia di più; a parità, il primo dall'alto", () => {
    expect(neighbour(boxes, "a", "right")).toBe("b");
    const taller = [boxes[0]!, box("b", 408, 0, 800, 196), box("c", 408, 204, 800, 600)];
    expect(neighbour(taller, "a", "right")).toBe("c");
  });

  it("da un foglio impilato si torna a sinistra, e si sale o si scende fra i due", () => {
    expect(neighbour(boxes, "b", "left")).toBe("a");
    expect(neighbour(boxes, "c", "left")).toBe("a");
    expect(neighbour(boxes, "b", "down")).toBe("c");
    expect(neighbour(boxes, "c", "up")).toBe("b");
  });

  it("dove non c'è niente non c'è un accanto", () => {
    expect(neighbour(boxes, "a", "left")).toBeNull();
    expect(neighbour(boxes, "a", "up")).toBeNull();
    expect(neighbour(boxes, "b", "right")).toBeNull();
    expect(neighbour(boxes, "c", "down")).toBeNull();
  });

  it("un foglio in diagonale non conta", () => {
    const diagonal = [box("a", 0, 0, 400, 296), box("d", 408, 304, 800, 600)];
    expect(neighbour(diagonal, "a", "right")).toBeNull();
    expect(neighbour(diagonal, "a", "down")).toBeNull();
  });

  it("fra più fogli nella stessa direzione vince il più vicino", () => {
    const row = [box("a", 0, 0, 200, 600), box("b", 208, 0, 400, 600), box("c", 408, 0, 600, 600)];
    expect(neighbour(row, "a", "right")).toBe("b");
    expect(neighbour(row, "c", "left")).toBe("b");
    expect(neighbour(row, "b", "right")).toBe("c");
  });

  it("due fogli che si toccano o si sormontano di un pixel restano accanto", () => {
    const touching = [box("a", 0, 0, 400, 600), box("b", 399.5, 0, 800, 600)];
    expect(neighbour(touching, "a", "right")).toBe("b");
    expect(neighbour(touching, "b", "left")).toBe("a");
  });

  it("un foglio che non c'è non ha vicini", () => {
    expect(neighbour(boxes, "zz", "right")).toBeNull();
  });
});

describe("il fuoco che si sposta", () => {
  function pane(id: string, rect: { left: number; top: number; right: number; bottom: number }, withEditor: boolean): HTMLElement {
    const el = document.createElement("section");
    el.className = "pane";
    el.dataset.pane = id;
    el.getBoundingClientRect = () => ({ ...rect, width: rect.right - rect.left, height: rect.bottom - rect.top }) as DOMRect;
    el.innerHTML = `<div class="pane-tabs"><button class="tab" aria-selected="true">${id}</button></div>${withEditor ? '<div class="editor" tabindex="0"></div>' : ""}`;
    document.body.append(el);
    return el;
  }

  beforeEach(() => {
    world.layout.focus = "a";
    world.focused.length = 0;
    world.editorTakesFocus = true;
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it("misura solo i fogli che si vedono", () => {
    pane("a", { left: 0, top: 0, right: 400, bottom: 600 }, true);
    pane("b", { left: 0, top: 0, right: 0, bottom: 0 }, true);
    expect(paneBoxes().map((each) => each.id)).toEqual(["a"]);
  });

  it("porta il fuoco del layout e quello della tastiera nel foglio accanto", () => {
    pane("a", { left: 0, top: 0, right: 400, bottom: 600 }, true);
    const b = pane("b", { left: 408, top: 0, right: 800, bottom: 600 }, true);
    expect(focusNeighbour("right")).toBe(true);
    expect(world.focused).toEqual(["b"]);
    expect(document.activeElement).toBe(b.querySelector(".editor"));
  });

  it("se il foglio accanto non ha una superficie che prenda il fuoco, lo posa sulla sua linguetta", () => {
    pane("a", { left: 0, top: 0, right: 400, bottom: 600 }, true);
    const b = pane("b", { left: 408, top: 0, right: 800, bottom: 600 }, false);
    expect(focusNeighbour("right")).toBe(true);
    expect(document.activeElement).toBe(b.querySelector(".tab"));
  });

  it("dove non c'è un foglio non sposta niente", () => {
    const a = pane("a", { left: 0, top: 0, right: 400, bottom: 600 }, true);
    a.querySelector<HTMLElement>(".editor")!.focus();
    expect(focusNeighbour("left")).toBe(false);
    expect(world.focused).toEqual([]);
    expect(document.activeElement).toBe(a.querySelector(".editor"));
  });
});
