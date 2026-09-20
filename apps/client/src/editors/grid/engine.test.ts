// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { findTextEditorOrThrow } from "../text/test-support";
import { parseWorkbook } from "./model";
import { commitGridPatches, inputPatch } from "./operation";
import type { GridWindow } from "../../host/contract";
import { GridEngine, type GridChange, type GridHost } from "./engine";

function workbook(rows = 100, columns = 50): string {
  return JSON.stringify({
    version: 1,
    sheets: [{
      id: "main",
      name: "Main",
      rows: Array.from({ length: rows }, (_, index) => ({ id: `r${index}`, hidden: false })),
      columns: Array.from({ length: columns }, (_, index) => ({ id: `c${index}`, hidden: false })),
      cells: [{ row: "r0", column: "c0", input: "1" }],
    }],
  });
}

function mounted(
  grid?: GridHost,
  source = workbook(),
) {
  const host = document.createElement("div");
  document.body.append(host);
  const changes: GridChange[] = [];
  const engine = new GridEngine(host, {
    surfaceId: "test",
    formatId: "fubsheet",
    revision: "rev-1",
    onChange: (change) => changes.push(change),
    onSelectionChange: () => {},
    grid,
  });
  const viewport = host.querySelector<HTMLElement>(".grid-viewport")!;
  Object.defineProperties(viewport, {
    clientWidth: { configurable: true, value: 600 },
    clientHeight: { configurable: true, value: 300 },
  });
  engine.setDoc(source);
  return { engine, host, viewport, changes };
}
function protocolHost(
  source: string,
  onClose?: (instance: string) => void,
): GridHost & {
  calls: string[];
  openedInstances: string[];
  closedInstances: string[];
  activeInstances: Set<string>;
} {
  const calls: string[] = [];
  const openedInstances: string[] = [];
  const closedInstances: string[] = [];
  const activeInstances = new Set<string>();
  let openCount = 0;
  let value = "1";
  let currentRevision = "rev-1";
  const rows = Array.from({ length: 100 }, (_, index) => ({ id: `r${index}`, index, height: null, hidden: false }));
  const columns = Array.from({ length: 50 }, (_, index) => ({ id: `c${index}`, index, width: null, hidden: false }));
  const window = () => ({
    revision: currentRevision,
    sheet: "main",
    row_start: 0,
    column_start: 0,
    total_rows: 100,
    total_columns: 50,
    rows,
    columns,
    cells: [{
      key: { sheet: "main", row: "r0", column: "c0" },
      input: value,
      style: { bold: false, italic: false, text_color: null, fill_color: null, horizontal: null, number_format: null },
      value: { kind: "number" as const, value: Number(value === "1" ? 1 : 2) },
    }],
  });
  const start = new TextEncoder().encode(source.slice(0, source.indexOf('"1"'))).length;
  return {
    calls,
    openedInstances,
    closedInstances,
    activeInstances,
    listGridSurfaces: async () => {
      calls.push("list");
      return [{ id: "sheet", format: "fubsheet", family: "grid", protocol_version: 1 }];
    },
    openGrid: async () => {
      calls.push("open");
      openCount += 1;
      const instance = `grid-test-${openCount}`;
      openedInstances.push(instance);
      activeInstances.add(instance);
      return {
        instance,
        revision: currentRevision,
        sheets: [{ id: "main", name: "Main", row_count: 100, column_count: 50 }],
      };
    },
    gridWindow: async (_surface, _instance, _request) => { calls.push("window"); return window(); },
    applyGrid: async () => {
      calls.push("apply");
      value = "X";
      currentRevision = "rev-2";
      return {
        revision: currentRevision,
        edit: { from: start, to: start + 3, deleted: '"1"', inserted: '"X"' },
        invalidation: { kind: "cells", cells: [{ sheet: "main", row: "r0", column: "c0" }] },
      };
    },
    reloadGrid: async (_surface, _instance, _source, _revision) => {
      calls.push("reload");
      return {
        instance: openedInstances[openedInstances.length - 1] ?? "grid-test-missing",
        revision: currentRevision,
        sheets: [{ id: "main", name: "Main", row_count: 100, column_count: 50 }],
      };
    },
    closeGrid: async (_surface, instance) => {
      calls.push("close");
      closedInstances.push(instance);
      activeInstances.delete(instance);
      onClose?.(instance);
    },
  };
}
afterEach(() => {
  document.body.replaceChildren();
});

describe("GridEngine", () => {
  it("virtualizza entro una finestra limitata e pubblica la semantica grid", () => {
    const { engine, host, viewport } = mounted();
    expect(viewport.getAttribute("role")).toBe("grid");
    expect(viewport.getAttribute("aria-rowcount")).toBe("101");
    expect(viewport.getAttribute("aria-colcount")).toBe("51");
    expect(engine.renderedCellCount()).toBeLessThan(200);
    expect(host.querySelectorAll(".grid-cell").length).toBe(engine.renderedCellCount());

    viewport.scrollTop = 1_400;
    viewport.dispatchEvent(new Event("scroll"));
    const renderedRows = [...host.querySelectorAll<HTMLElement>(".grid-cell")]
      .map((cell) => Number(cell.dataset.row));
    expect(Math.min(...renderedRows)).toBeGreaterThan(40);
    expect(engine.renderedCellCount()).toBeLessThan(200);
    engine.destroy();
  });
  it("annida ogni intestazione e cella alla propria riga semantica", () => {
    const { engine, viewport } = mounted();
    const rows = [...viewport.querySelectorAll<HTMLElement>('[role="row"]')];
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.every((row) => row.parentElement === viewport)).toBe(true);
    expect(rows[0]?.getAttribute("aria-rowindex")).toBe("1");

    for (const row of rows) {
      const rowIndex = row.getAttribute("aria-rowindex");
      expect(rowIndex).not.toBeNull();
      for (const child of [...row.children]) {
        const role = child.getAttribute("role");
        expect(["columnheader", "rowheader", "gridcell", "presentation"]).toContain(role);
        if (role === "columnheader") {
          expect(child.getAttribute("aria-rowindex")).toBe("1");
          expect(Number(child.getAttribute("aria-colindex"))).toBeGreaterThan(1);
        } else if (role === "rowheader") {
          expect(child.getAttribute("aria-rowindex")).toBe(rowIndex);
          expect(child.getAttribute("aria-colindex")).toBe("1");
        } else if (role === "gridcell") {
          expect(child.getAttribute("aria-rowindex")).toBe(rowIndex);
          expect(Number(child.getAttribute("aria-colindex"))).toBeGreaterThan(1);
        }
      }
    }
    expect([...viewport.querySelectorAll<HTMLElement>('[role="gridcell"]')]
      .every((cell) => cell.parentElement?.getAttribute("role") === "row")).toBe(true);
    engine.destroy();
  });

  it("tiene le battute locali e pubblica una sola operazione al commit", () => {
    const { engine, host, viewport, changes } = mounted();

    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "X", bubbles: true }));
    expect(changes).toHaveLength(0);
    expect(host.querySelector<HTMLElement>(".grid-cell-editor")!.hidden).toBe(false);

    host.querySelector<HTMLElement>(".grid-cell-editor .cm-content")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(changes).toHaveLength(1);
    expect(changes[0].operation.kind).toBe("grid");
    expect(changes[0].operation.patches).toHaveLength(1);
    expect(parseWorkbook(engine.getDoc()).sheets[0].cells?.[0].input).toBe("X");
    engine.destroy();
  });

  it("incolla TSV come una sola operazione e mantiene undo locale separato dal peer", () => {
    const { engine, viewport, changes } = mounted();
    const clipboard = {
      getData: () => "A\tB\nC\tD",
      setData: vi.fn(),
    };
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: clipboard });
    viewport.dispatchEvent(paste);
    expect(changes).toHaveLength(1);
    expect(changes[0].operation.patches).toHaveLength(4);

    const peerWorkbook = parseWorkbook(engine.getDoc());
    const peerPatch = inputPatch(peerWorkbook.sheets[0], { row: 2, column: 2 }, "peer")!;
    const peer = commitGridPatches(peerWorkbook, engine.getDoc(), [peerPatch])!;
    engine.syncDoc({ text: peer.source, operation: peer.operation });

    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }));
    const afterUndo = parseWorkbook(engine.getDoc()).sheets[0];
    expect(afterUndo.cells?.find((cell) => cell.row === "r0" && cell.column === "c0")?.input).toBe("1");
    expect(afterUndo.cells?.find((cell) => cell.row === "r2" && cell.column === "c2")?.input).toBe("peer");
    expect(changes).toHaveLength(2);
    expect(changes[1].origin).toBe("undo");
    engine.destroy();
  });
  it("negozia Grid v1, non chiama l'host per battuta e applica il diff guardato", async () => {
    const source = workbook();
    const grid = protocolHost(source);
    const { engine, host, viewport, changes } = mounted(grid);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const windowsBeforeTyping = grid.calls.filter((call) => call === "window").length;
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "X", bubbles: true }));
    expect(grid.calls.filter((call) => call === "apply")).toHaveLength(0);
    host.querySelector<HTMLElement>(".grid-cell-editor .cm-content")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(grid.calls.filter((call) => call === "window").length).toBeGreaterThan(windowsBeforeTyping);
    expect(grid.calls.filter((call) => call === "apply")).toHaveLength(1);
    expect(changes).toHaveLength(1);
    expect(changes[0].text).toContain('"X"');
    expect(engine.getDoc()).toContain('"X"');
    engine.destroy();
  });

  it("risolve l'invalidazione sulle coordinate globali senza degradare gli ID sconosciuti", async () => {
    const sourceValue = JSON.parse(workbook(512, 256)) as {
      sheets: [{ cells: { row: string; column: string; input: string }[] }];
    };
    sourceValue.sheets[0].cells.push({ row: "r300", column: "c200", input: "old" });
    const source = JSON.stringify(sourceValue);
    const grid = protocolHost(source);
    const requests: { row_start: number; column_start: number }[] = [];
    const open = grid.openGrid;
    const targetStart = new TextEncoder().encode(source.slice(0, source.indexOf('"old"'))).length;
    let revision = "rev-1";
    Object.assign(grid, {
      openGrid: async (surface: string, text: string, requestedRevision: string) => {
        const session = await open(surface, text, requestedRevision);
        return {
          ...session,
          revision,
          sheets: [{ id: "main", name: "Main", row_count: 512, column_count: 256 }],
        };
      },
      gridWindow: async (
        _surface: string,
        _instance: string,
        request: Parameters<GridHost["gridWindow"]>[2],
      ) => {
        requests.push({ row_start: request.row_start, column_start: request.column_start });
        grid.calls.push("window");
        const rows = Array.from({ length: request.row_count }, (_, offset) => ({
          id: `r${request.row_start + offset}`,
          index: request.row_start + offset,
          height: null,
          hidden: false,
        }));
        const columns = Array.from({ length: request.column_count }, (_, offset) => ({
          id: `c${request.column_start + offset}`,
          index: request.column_start + offset,
          width: null,
          hidden: false,
        }));
        const cells: GridWindow["cells"] = [];
        if (request.row_start === 0 && request.column_start === 0) {
          cells.push({
            key: { sheet: "main", row: "r0", column: "c0" },
            input: revision === "rev-2" ? "corrupt" : "1",
            style: { bold: false, italic: false, text_color: null, fill_color: null, horizontal: null, number_format: null },
            value: { kind: "number" as const, value: 1 },
          });
        }
        if (
          request.row_start <= 300
          && 300 < request.row_start + request.row_count
          && request.column_start <= 200
          && 200 < request.column_start + request.column_count
        ) {
          cells.push({
            key: { sheet: "main", row: "r300", column: "c200" },
            input: revision === "rev-2" ? "new" : "old",
            style: { bold: revision === "rev-2", italic: false, text_color: null, fill_color: null, horizontal: null, number_format: null },
            value: { kind: "number" as const, value: revision === "rev-2" ? 99 : 1 },
          });
        }
        return {
          revision,
          sheet: "main",
          row_start: request.row_start,
          column_start: request.column_start,
          total_rows: 512,
          total_columns: 256,
          rows,
          columns,
          cells,
        };
      },
      applyGrid: async () => {
        revision = "rev-2";
        return {
          revision,
          edit: { from: targetStart, to: targetStart + 5, deleted: '"old"', inserted: '"new"' },
          invalidation: {
            kind: "cells" as const,
            cells: [
              { sheet: "main", row: "r300", column: "c200" },
              { sheet: "main", row: "missing-row", column: "missing-column" },
            ],
          },
        };
      },
    });
    const { engine, host, viewport } = mounted(grid, source);
    for (let index = 0; index < 12; index += 1) await Promise.resolve();

    viewport.scrollTop = 300 * 28;
    viewport.scrollLeft = 200 * 120;
    viewport.dispatchEvent(new Event("scroll"));
    for (let index = 0; index < 12; index += 1) await Promise.resolve();
    expect(host.querySelector<HTMLElement>('.grid-cell[data-row="300"][data-column="200"]')?.textContent).toBe("1");

    const target = host.querySelector<HTMLElement>('.grid-cell[data-row="300"][data-column="200"]')!;
    target.dispatchEvent(new Event("pointerdown", { bubbles: true, cancelable: true }));
    const requestsBeforeInvalidation = requests.length;
    const formula = findTextEditorOrThrow(
      host.querySelector<HTMLElement>(".grid-formula-editor")!,
    );
    formula.focus();
    formula.dispatch({
      changes: { from: 0, to: formula.state.doc.length, insert: "new" },
      userEvent: "input",
    });
    formula.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    for (let index = 0; index < 12; index += 1) await Promise.resolve();
    expect(requests.slice(requestsBeforeInvalidation)).toEqual([{ row_start: 256, column_start: 128 }]);
    expect(host.querySelector<HTMLElement>('.grid-cell[data-row="300"][data-column="200"]')?.textContent).toBe("99");
    expect(host.querySelector<HTMLElement>('.grid-cell[data-row="300"][data-column="200"]')?.style.fontWeight).toBe("700");
    expect(parseWorkbook(engine.getDoc()).sheets[0].cells?.find((cell) => cell.row === "r0" && cell.column === "c0")?.input)
      .toBe("1");
    engine.destroy();
  });
  it("estende la selezione da tastiera e ripristina il fuoco dopo Escape", async () => {
    const { engine, host, viewport } = mounted();
    viewport.focus();
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true, bubbles: true }));
    expect(engine.selection()).toEqual({ anchor: { row: 0, column: 0 }, focus: { row: 0, column: 1 } });

    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "F2", bubbles: true }));
    host.querySelector<HTMLElement>(".grid-cell-editor .cm-content")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await Promise.resolve();
    expect(document.activeElement).toBe(viewport);
    engine.destroy();
  });

  it("la formula bar conserva la bozza e gestisce commit, cancel e blur", async () => {
    const { engine, host, viewport, changes } = mounted();
    const formula = findTextEditorOrThrow(
      host.querySelector<HTMLElement>(".grid-formula-editor")!,
    );

    formula.focus();
    formula.dispatch({
      changes: { from: 0, to: formula.state.doc.length, insert: "7" },
      userEvent: "input",
    });
    expect(changes).toHaveLength(0);
    formula.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(changes).toHaveLength(1);
    expect(parseWorkbook(engine.getDoc()).sheets[0].cells?.[0].input).toBe("7");

    formula.focus();
    formula.dispatch({
      changes: { from: 0, to: formula.state.doc.length, insert: "8" },
      userEvent: "input",
    });
    formula.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(changes).toHaveLength(1);
    await Promise.resolve();
    expect(parseWorkbook(engine.getDoc()).sheets[0].cells?.[0].input).toBe("7");

    formula.focus();
    formula.dispatch({
      changes: { from: 0, to: formula.state.doc.length, insert: "9" },
      userEvent: "input",
    });
    viewport.focus();
    await Promise.resolve();
    expect(changes).toHaveLength(2);
    expect(parseWorkbook(engine.getDoc()).sheets[0].cells?.[0].input).toBe("9");
    engine.destroy();
  });

  it("annulla la bozza locale quando un full-text peer ricarica la topologia", () => {
    const { engine, host, viewport, changes } = mounted();
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "X", bubbles: true }));
    const peer = JSON.parse(workbook());
    peer.sheets[0].cells[0].input = "peer";

    engine.syncDoc(JSON.stringify(peer));

    expect(host.querySelector<HTMLElement>(".grid-cell-editor")!.hidden).toBe(true);
    expect(parseWorkbook(engine.getDoc()).sheets[0].cells?.[0].input).toBe("peer");
    expect(changes).toHaveLength(0);
    engine.destroy();
  });
  it("salta gli assi nascosti e avvolge Tab sulla riga visibile successiva", () => {

    const { engine, viewport } = mounted();
    const source = JSON.parse(workbook(3, 3));
    source.sheets[0].rows[0].hidden = true;
    source.sheets[0].columns[1].hidden = true;
    engine.setDoc(JSON.stringify(source));

    expect(engine.selection().focus).toEqual({ row: 1, column: 0 });
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(engine.selection().focus).toEqual({ row: 1, column: 2 });
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(engine.selection().focus).toEqual({ row: 2, column: 0 });
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }));
    expect(engine.selection().focus).toEqual({ row: 1, column: 2 });
    engine.destroy();
  });

  it("non espone un discendente attivo quando ogni asse è nascosto", () => {
    const { engine, host, viewport, changes } = mounted();
    const source = JSON.parse(workbook(1, 1));
    source.sheets[0].rows[0].hidden = true;
    source.sheets[0].columns[0].hidden = true;
    engine.setDoc(JSON.stringify(source));

    expect(viewport.hasAttribute("aria-activedescendant")).toBe(false);
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "X", bubbles: true }));
    expect(host.querySelector<HTMLElement>(".grid-cell-editor")!.hidden).toBe(true);
    expect(changes).toHaveLength(0);
    engine.destroy();
  });


  it("sceglie deterministicamente la prima superficie compatibile dichiarata", async () => {
    const grid = protocolHost(workbook());
    let selected: string | null = null;
    const open = grid.openGrid;
    Object.assign(grid, {
      listGridSurfaces: async () => [
        { id: "first", format: "fubsheet", family: "grid", protocol_version: 1 },
        { id: "second", format: "fubsheet", family: "grid", protocol_version: 1 },
      ],
      openGrid: async (surface: string, source: string, revision: string) => {
        selected = surface;
        return open(surface, source, revision);
      },
    });
    const { engine } = mounted(grid);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(selected).toBe("first");
    engine.destroy();
  });

  it("chiude prima del teardown e riapre con un'istanza nuova senza residui", async () => {
    let mountedAtClose = false;
    const grid = protocolHost(workbook(), () => {
      mountedAtClose = document.querySelector(".grid-surface") !== null;
    });
    const first = mounted(grid);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    first.engine.destroy();
    expect(grid.openedInstances).toEqual(["grid-test-1"]);
    expect(grid.closedInstances).toEqual(["grid-test-1"]);
    expect(grid.activeInstances.size).toBe(0);
    expect(mountedAtClose).toBe(true);
    expect(first.host.querySelector(".grid-surface")).toBeNull();

    const second = mounted(grid);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(grid.openedInstances).toEqual(["grid-test-1", "grid-test-2"]);
    expect(grid.activeInstances).toEqual(new Set(["grid-test-2"]));
    const callsAfterSecondOpen = grid.calls.length;
    first.viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "X", bubbles: true }));
    await Promise.resolve();
    expect(grid.calls.length).toBe(callsAfterSecondOpen);
    expect(grid.closedInstances).toEqual(["grid-test-1"]);

    second.engine.destroy();
    expect(grid.closedInstances).toEqual(["grid-test-1", "grid-test-2"]);
    expect(grid.activeInstances.size).toBe(0);
    expect(second.host.querySelector(".grid-surface")).toBeNull();
    const callsAfterDestroy = grid.calls.length;
    second.viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "X", bubbles: true }));
    await Promise.resolve();
    expect(grid.calls.length).toBe(callsAfterDestroy);
  });
  it("legge solo il viewport anche con assi da centomila righe", async () => {
    const grid = protocolHost(workbook(1, 1));
    const open = grid.openGrid;
    Object.assign(grid, {
      openGrid: async (surface: string, source: string, revision: string) => {
        const session = await open(surface, source, revision);
        return {
          ...session,
          sheets: [{ id: "main", name: "Main", row_count: 100_000, column_count: 1_000 }],
        };
      },
      gridWindow: async (_surface: string, _instance: string, request: {
        revision: string;
        sheet: string;
        row_start: number;
        row_count: number;
        column_start: number;
        column_count: number;
      }) => {
        grid.calls.push("window");
        return {
          revision: request.revision,
          sheet: request.sheet,
          row_start: request.row_start,
          column_start: request.column_start,
          total_rows: 100_000,
          total_columns: 1_000,
          rows: Array.from({ length: request.row_count }, (_, index) => ({
            id: `r${request.row_start + index}`,
            index: request.row_start + index,
            height: null,
            hidden: false,
          })),
          columns: Array.from({ length: request.column_count }, (_, index) => ({
            id: `c${request.column_start + index}`,
            index: request.column_start + index,
            width: null,
            hidden: false,
          })),
          cells: [],
        };
      },
    });
    const { engine, viewport } = mounted(grid);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    const initialWindows = grid.calls.filter((call) => call === "window").length;
    expect(initialWindows).toBeLessThanOrEqual(4);
    viewport.scrollTop = 90_000 * 28;
    viewport.dispatchEvent(new Event("scroll"));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(grid.calls.filter((call) => call === "window").length).toBeLessThanOrEqual(initialWindows + 4);
    engine.destroy();
  });

  it("rifiuta famiglia o versione sconosciuta prima di aprire una sessione", async () => {
    const source = workbook();
    const grid = protocolHost(source);
    Object.assign(grid, {
      listGridSurfaces: async () => [
        { id: "wrong-family", format: "fubsheet", family: "other", protocol_version: 1 },
        { id: "wrong-version", format: "fubsheet", family: "grid", protocol_version: 2 },
      ],
    });
    const { engine, host } = mounted(grid);
    await Promise.resolve();
    await Promise.resolve();
    expect(grid.calls.filter((call) => call === "open")).toHaveLength(0);
    expect(host.querySelector<HTMLElement>(".grid-surface")!.dataset.gridProtocol).toBe("fallback");
    engine.destroy();
  });

  it("chiude la sessione se il provider cade nella prima finestra", async () => {
    const source = workbook();
    const grid = protocolHost(source);
    Object.assign(grid, {
      gridWindow: async () => {
        throw new Error("provider trap");
      },
    });
    const { engine, host } = mounted(grid);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(grid.calls.filter((call) => call === "open")).toHaveLength(1);
    expect(grid.calls.filter((call) => call === "close")).toHaveLength(1);
    expect(host.querySelector<HTMLElement>(".grid-surface")!.dataset.gridProtocol).toBe("fallback");
    engine.destroy();
  });

  it("chiude la sessione e ricostruisce il fallback se reload fallisce", async () => {
    const source = workbook();
    const grid = protocolHost(source);
    const { engine, host } = mounted(grid);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    Object.assign(grid, {
      reloadGrid: async () => {
        throw new Error("provider trap");
      },
    });
    const next = JSON.stringify({
      version: 1,
      sheets: [{
        id: "main",
        name: "Main",
        rows: [{ id: "r0" }],
        columns: [{ id: "c0" }],
        cells: [{ row: "r0", column: "c0", input: "reloaded" }],
      }],
    });
    engine.syncDoc(next);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(grid.calls.filter((call) => call === "close")).toHaveLength(1);
    expect(engine.getDoc()).toBe(next);
    expect(host.querySelector<HTMLElement>(".grid-surface")!.dataset.gridProtocol).toBe("fallback");
    expect(host.querySelector<HTMLElement>('.grid-cell[data-row="0"][data-column="0"]')!.textContent)
      .toBe("reloaded");
    engine.destroy();
  });

  it("ignora un reload stantio senza chiudere la nuova istanza", async () => {
    const source = workbook();
    const grid = protocolHost(source);
    const current = mounted(grid);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    let rejectReload: ((reason?: unknown) => void) | undefined;
    Object.assign(grid, {
      reloadGrid: async () => new Promise<never>((_resolve, reject) => {
        rejectReload = reject;
      }),
    });
    const stale = JSON.stringify({
      version: 1,
      sheets: [{
        id: "main",
        name: "Main",
        rows: [{ id: "r0" }],
        columns: [{ id: "c0" }],
        cells: [{ row: "r0", column: "c0", input: "stale" }],
      }],
    });
    current.engine.syncDoc(stale);
    await Promise.resolve();
    const fresh = workbook(2, 2);
    current.engine.setDoc(fresh);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    rejectReload?.(new Error("stale reload"));
    await Promise.resolve();
    await Promise.resolve();
    expect(grid.closedInstances).toEqual(["grid-test-1"]);
    expect(grid.activeInstances).toEqual(new Set(["grid-test-2"]));
    expect(current.engine.getDoc()).toBe(fresh);
    expect(current.host.querySelector<HTMLElement>(".grid-surface")!.dataset.gridProtocol).toBe("v1");
    current.engine.destroy();
  });

  it("ignora il rifiuto di un apply stantio senza abbattere il provider nuovo", async () => {
    const source = workbook();
    const grid = protocolHost(source);
    const current = mounted(grid);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    let rejectApply: ((reason?: unknown) => void) | undefined;
    Object.assign(grid, {
      applyGrid: async () => new Promise<never>((_resolve, reject) => {
        rejectApply = reject;
      }),
    });
    current.viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "X", bubbles: true }));
    current.host.querySelector<HTMLElement>(".grid-cell-editor .cm-content")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await Promise.resolve();
    const fresh = workbook(2, 2);
    current.engine.setDoc(fresh);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    rejectApply?.(new Error("stale apply"));
    await Promise.resolve();
    await Promise.resolve();
    expect(grid.closedInstances).toEqual(["grid-test-1"]);
    expect(grid.activeInstances).toEqual(new Set(["grid-test-2"]));
    expect(current.engine.getDoc()).toBe(fresh);
    expect(current.host.querySelector<HTMLElement>(".grid-surface")!.dataset.gridProtocol).toBe("v1");
    current.engine.destroy();
  });

});
