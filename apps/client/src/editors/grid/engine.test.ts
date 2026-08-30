// @vitest-environment happy-dom
import { findTextEditorOrThrow } from "../text/test-support";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { serializeWorkbook } from "./codec";
import { GridEngine, type GridDocumentChange } from "./engine";
import {
  DEFAULT_CELL_STYLE,
  type GridWorkbook,
} from "./model";

function workbook(rows = 20, columns = 12): GridWorkbook {
  return {
    id: "workbook-1",
    metadata: {},
    sheets: [
      {
        id: "sheet-1",
        name: "Foglio 1",
        metadata: {},
        rows: Array.from({ length: rows }, (_, index) => ({
          id: `row-${index + 1}`,
        })),
        columns: Array.from({ length: columns }, (_, index) => ({
          id: `column-${index + 1}`,
        })),
        cells: [
          {
            row: "row-1",
            column: "column-1",
            input: "iniziale",
            style: DEFAULT_CELL_STYLE,
          },
        ],
      },
    ],
  };
}

function mount(onChange = vi.fn<(change: GridDocumentChange) => void>()) {
  const parent = document.createElement("section");
  document.body.append(parent);
  const engine = new GridEngine(parent, { onChange, theme: "dark" });
  const viewport = parent.querySelector<HTMLElement>("[role='grid']")!;
  Object.defineProperties(viewport, {
    clientWidth: { configurable: true, value: 420 },
    clientHeight: { configurable: true, value: 240 },
  });
  engine.setDocument(serializeWorkbook(workbook()));
  return { engine, onChange, parent, viewport };
}

function key(target: HTMLElement, value: string, options: KeyboardEventInit = {}): void {
  target.dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true, ...options }));
}

beforeEach(() => {
  document.body.replaceChildren();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GridEngine verticale", () => {
  it("monta sheet, intestazioni e sole celle della viewport con overscan limitato", () => {
    const { engine, parent, viewport } = mount();

    expect(viewport.getAttribute("aria-rowcount")).toBe("20");
    expect(viewport.getAttribute("aria-colcount")).toBe("12");
    expect(parent.querySelector("[role='columnheader']")?.textContent).toBe("A");
    expect(parent.querySelector("[role='rowheader']")?.textContent).toBe("1");
    const renderedCells = parent.querySelectorAll("[role='gridcell']");
    expect(renderedCells.length).toBeGreaterThan(0);
    expect(renderedCells.length).toBeLessThan(20 * 12);
    expect(parent.querySelector("[role='gridcell']")?.textContent).toBe("iniziale");

    expect(parent.querySelector("[role='row'] [role='gridcell']")).not.toBeNull();
    expect(parent.querySelector("[role='gridcell']")?.getAttribute("aria-labelledby")).toContain(
      "row-1",
    );
    engine.destroy();
  });

  it("mantiene selezione rettangolare e naviga con frecce, Tab, Home, End e PageDown", () => {
    const { engine, parent, viewport } = mount();

    key(viewport, "ArrowRight");
    expect(viewport.getAttribute("aria-activedescendant")).toContain("-c2");
    key(viewport, "ArrowDown", { shiftKey: true });
    expect(parent.querySelectorAll("[role='gridcell'][aria-selected='true']")).toHaveLength(2);
    key(viewport, "Tab");
    expect(viewport.getAttribute("aria-activedescendant")).toContain("-c3");
    key(viewport, "Home");
    expect(viewport.getAttribute("aria-activedescendant")).toContain("-c1");
    key(viewport, "End", { ctrlKey: true });
    expect(viewport.getAttribute("aria-activedescendant")).toContain("-r20-c12");
    key(viewport, "PageDown");
    expect(viewport.getAttribute("aria-activedescendant")).toContain("-r20-c12");

    engine.destroy();
  });

  it("riusa un solo TextEngine in-cell e committa Enter come una GridOperation", () => {
    const { engine, onChange, parent, viewport } = mount();

    key(viewport, "n");
    expect(parent.querySelectorAll(".grid-cell-editor .cm-editor")).toHaveLength(1);
    const cellView = findTextEditorOrThrow(
      parent.querySelector<HTMLElement>(".grid-cell-editor")!,
    );
    expect(cellView?.state.selection.main.head).toBe(1);
    expect(parent.querySelector(".grid-cell-editor .cm-content")?.textContent).toBe("n");
    key(parent.querySelector<HTMLElement>(".grid-cell-editor .cm-content")!, "Enter");
    expect(parent.querySelector<HTMLElement>(".grid-cell-editor")?.hidden).toBe(true);
    expect(viewport.getAttribute("aria-activedescendant")).toContain("-r1-c1");

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].operation).toMatchObject({ kind: "set_cells", sheet: "sheet-1" });
    expect(onChange.mock.calls[0][0].operation.changes).toHaveLength(1);
    expect(onChange.mock.calls[0][0].operation.changes[0]).toMatchObject({
      row: "row-1",
      column: "column-1",
      before: "iniziale",
      after: "n",
    });
    expect(parent.querySelector("[role='gridcell']")?.textContent).toBe("n");

    engine.destroy();
  });

  it("incolla TSV in una sola operazione e separa undo workbook dalla history testuale", () => {
    const { engine, onChange, parent, viewport } = mount();
    const clipboard = new DataTransfer();
    clipboard.setData("text/plain", "1\t2\n3\t4");
    viewport.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, clipboardData: clipboard }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].operation.changes).toHaveLength(4);
    expect(parent.querySelectorAll("[role='gridcell']")[0].textContent).toBe("1");
    expect(engine.undo()).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(parent.querySelectorAll("[role='gridcell']")[0].textContent).toBe("iniziale");
    expect(engine.redo()).toBe(true);
    expect(parent.querySelectorAll("[role='gridcell']")[0].textContent).toBe("1");

    engine.destroy();
  });

  it("formula bar ed editor in-cell fanno cancel con Escape e commit su blur", () => {
    const { engine, onChange, parent, viewport } = mount();

    key(viewport, "x");
    key(parent.querySelector<HTMLElement>(".grid-cell-editor .cm-content")!, "Escape");
    expect(onChange).not.toHaveBeenCalled();
    expect(parent.querySelector("[role='gridcell']")?.textContent).toBe("iniziale");

    key(viewport, "y");
    parent.querySelector<HTMLElement>(".grid-cell-editor .cm-content")!.dispatchEvent(
      new FocusEvent("focusout", { bubbles: true, relatedTarget: document.body }),
    );
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(parent.querySelector("[role='gridcell']")?.textContent).toBe("y");

    engine.destroy();
  });

  it("ripristina foglio, selezione, scroll e focus sulla grid", () => {
    const { engine, viewport } = mount();
    key(viewport, "ArrowRight");
    key(viewport, "ArrowDown");
    viewport.scrollLeft = 30;
    viewport.scrollTop = 20;
    const state = engine.captureViewState();

    key(viewport, "Home", { ctrlKey: true });
    viewport.scrollLeft = 0;
    viewport.scrollTop = 0;
    engine.restoreViewState(state);
    engine.focus();

    expect(viewport.getAttribute("aria-activedescendant")).toContain("-r2-c2");
    expect(viewport.scrollLeft).toBe(30);
    expect(viewport.scrollTop).toBe(20);
    expect(document.activeElement).toBe(viewport);

    engine.destroy();
  });
});
