// @vitest-environment happy-dom
//
// La prova comune della Tabella (`tabella/conformance.ts`) sul foglio: gli
// stessi gesti della tabella di una nota danno la stessa cella attiva, la
// stessa selezione e le stesse celle. Il foglio non ha bordo, e i gesti che
// esegue col suo catalogo (riempire, inserire, togliere, la somma) si
// controllano dal comando che chiede. I gesti che il foglio non ha
// (`workbookAbsent`) lì non chiedono nessun comando.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TableCaps } from "../../tabella/adapter";
import {
  caseAbsence,
  caseApplies,
  expectedOf,
  playCase,
  seenOf,
  TABLE_CONFORMANCE,
  type ConformanceCase,
  type ConformanceClipboard,
  type ConformanceDriver,
  type ConformancePointer,
  type ConformanceTarget,
} from "../../tabella/conformance";
import { bytesHost, mounted, settle, written } from "./test-support";

afterEach(() => {
  document.body.replaceChildren();
});

/// Il foglio non ha i comandi della tabella delle note: ciò che sa fare in
/// più lo chiede al suo catalogo.
const NONE: TableCaps = {
  insertRows: false,
  deleteRows: false,
  moveRows: false,
  insertColumns: false,
  deleteColumns: false,
  moveColumns: false,
  sort: false,
  align: false,
  merge: false,
  headerRows: 0,
};

const CATALOG = [
  "edit.fillDown",
  "edit.fillRight",
  "edit.autoFill",
  "formulas.autoSum",
  "home.insertRows",
  "home.deleteRows",
  "home.insertColumns",
  "home.deleteColumns",
];

/// Un gesto del puntatore sulla griglia: con la griglia a 0,0 dello schermo e
/// niente scorrimento, le coordinate della tela sono quelle dello schermo
/// (come in `engine.pointer.test.ts`).
function pointer(host: HTMLElement, viewport: HTMLElement, gesture: ConformancePointer): void {
  const press = (target: EventTarget, type: string, x: number, y: number) =>
    target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, button: 0, buttons: type === "pointerup" ? 0 : 1, clientX: x, clientY: y }));
  const inside = (element: HTMLElement) => {
    const row = element.parentElement?.classList.contains("grid-row") ? parseFloat(element.parentElement.style.top) : 0;
    // Più in là dei 4 px dove il bordo di un'intestazione si tira.
    return { x: parseFloat(element.style.left) + 8, y: row + parseFloat(element.style.top) + 8 };
  };
  const cell = (row: number, column: number) => {
    const found = host.querySelector<HTMLElement>(`.grid-cell[data-row="${row}"][data-column="${column}"]`);
    if (!found) throw new Error(`il foglio non mostra la cella ${row},${column}`);
    return inside(found);
  };
  const handle = () => {
    const found = host.querySelector<HTMLElement>(".grid-fill-handle");
    if (!found) throw new Error("il foglio non mostra il quadratino");
    return found;
  };
  switch (gesture.kind) {
    case "fill": {
      const grip = handle();
      const start = inside(grip);
      const end = cell(gesture.to.row, gesture.to.column);
      press(grip, "pointerdown", start.x, start.y);
      press(viewport, "pointermove", end.x, end.y);
      press(viewport, "pointerup", end.x, end.y);
      return;
    }
    case "fill-double":
      handle().dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      return;
    case "header": {
      // Le intestazioni stanno sopra (le lettere) e a sinistra (i numeri).
      const at = (index: number) => gesture.axis === "column" ? { x: cell(0, index).x, y: 10 } : { x: 10, y: cell(index, 0).y };
      const start = at(gesture.index);
      const end = at(gesture.to ?? gesture.index);
      press(viewport, "pointerdown", start.x, start.y);
      if (gesture.to !== undefined) press(viewport, "pointermove", end.x, end.y);
      press(viewport, "pointerup", end.x, end.y);
      return;
    }
  }
}

describe("la prova comune della Tabella, sul foglio", () => {
  const target: ConformanceTarget = { mode: "sheet", caps: NONE, bounded: false, delegates: true };
  /// Il foglio della prova, coi comandi chiesti raccolti invece che eseguiti.
  async function sheet(test: ConformanceCase) {
    const cells: Record<string, string> = {};
    test.rows.forEach((row, r) => row.forEach((value, c) => {
      if (value !== "") cells[`${r},${c}`] = value;
    }));
    const grid = bytesHost({ rows: 20, columns: 10, cells, commands: CATALOG });
    const { engine, host, viewport } = await mounted(grid);
    const asked: string[] = [];
    vi.spyOn(engine, "command").mockImplementation((id: string) => {
      asked.push(id);
      return true;
    });
    viewport.focus();
    const focused = () => engine.editMode() === "ready"
      ? viewport
      : host.querySelector<HTMLElement>(".grid-cell-editor .cm-content")!;
    const height = (test.cells ?? test.rows).length;
    const width = Math.max(...(test.cells ?? test.rows).map((row) => row.length));
    const driver: ConformanceDriver = {
      key: (name, init) => {
        focused().dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init }));
      },
      command: (id) => void engine.command(id),
      pointer: (gesture) => pointer(host, viewport, gesture),
      clipboard: (kind, store: ConformanceClipboard) => {
        const event = new Event(kind, { bubbles: true, cancelable: true });
        Object.defineProperty(event, "clipboardData", {
          value: {
            setData: (type: string, value: string) => {
              if (type === "text/plain") store.text = value;
              if (type === "text/html") store.html = value;
            },
            getData: (type: string) => (type === "text/plain" ? store.text : type === "text/html" ? store.html : ""),
          },
        });
        viewport.dispatchEvent(event);
      },
      settle,
      cells: () => {
        const now = { ...cells, ...written(grid.journal()) };
        return Array.from({ length: height }, (_, r) => Array.from({ length: width }, (_, c) => now[`${r},${c}`] ?? ""));
      },
      active: () => {
        const selection = engine.selection();
        return { ...(selection.active ?? selection.anchor) };
      },
      range: () => {
        const { anchor, focus } = engine.selection();
        return {
          r0: Math.min(anchor.row, focus.row),
          c0: Math.min(anchor.column, focus.column),
          r1: Math.max(anchor.row, focus.row),
          c1: Math.max(anchor.column, focus.column),
        };
      },
      cut: () => engine.cutRange(),
      ranges: () => engine.rangeCount(),
      asked: () => asked,
    };
    return { engine, driver };
  }

  for (const test of TABLE_CONFORMANCE) {
    if (caseApplies(test, target)) {
      it(test.name, async () => {
        const { engine, driver } = await sheet(test);
        const seen = await playCase(test, driver);
        const expected = expectedOf(test, target);
        expect(seenOf(seen, expected)).toEqual(expected);
        engine.destroy();
      });
      continue;
    }
    if (!test.workbookAbsent || caseAbsence(test, target) === null) continue;
    it(`${test.name}: assente (${test.workbookAbsent})`, async () => {
      const { engine, driver } = await sheet(test);
      const seen = await playCase(test, driver);
      // Il foglio non prende il gesto per sé: nessun comando del catalogo.
      expect(seen.asked).toEqual([]);
      engine.destroy();
    });
  }
});
