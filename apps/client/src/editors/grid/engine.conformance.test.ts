// @vitest-environment happy-dom
//
// La prova comune della Tabella (`tabella/conformance.ts`) sul foglio: gli
// stessi gesti della tabella di una nota danno la stessa cella attiva, la
// stessa selezione e le stesse celle. Il foglio non ha bordo, e i gesti che
// esegue col suo catalogo (riempire, inserire, togliere) si controllano dal
// comando che chiede.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TableCaps } from "../../tabella/adapter";
import {
  caseApplies,
  expectedOf,
  playCase,
  seenOf,
  TABLE_CONFORMANCE,
  type ConformanceClipboard,
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

const CATALOG = ["edit.fillDown", "edit.fillRight", "home.insertRows", "home.deleteRows", "home.insertColumns", "home.deleteColumns"];

describe("la prova comune della Tabella, sul foglio", () => {
  const target: ConformanceTarget = { mode: "sheet", caps: NONE, bounded: false, delegates: true };
  for (const test of TABLE_CONFORMANCE) {
    it.runIf(caseApplies(test, target))(test.name, async () => {
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
      const seen = await playCase(test, {
        key: (name, init) => {
          focused().dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init }));
        },
        command: (id) => void engine.command(id),
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
      });
      const expected = expectedOf(test, target);
      expect(seenOf(seen, expected)).toEqual(expected);
      engine.destroy();
    });
  }
});
