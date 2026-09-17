// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { findTextEditorOrThrow } from "../text/test-support";
import { parseWorkbook } from "./model";
import { commitGridPatches, inputPatch } from "./operation";
import { GridEngine, type GridChange, type GridEngineOptions, type GridHost } from "./engine";

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
  evaluator: GridEngineOptions["evaluate"] = async () => ({ cells: [], dependencies: [] }),
  grid?: GridHost,
) {
  const host = document.createElement("div");
  document.body.append(host);
  const changes: GridChange[] = [];
  const evaluate = vi.fn(evaluator);
  const engine = new GridEngine(host, {
    surfaceId: "test",
    formatId: "fubsheet",
    revision: "rev-1",
    onChange: (change) => changes.push(change),
    onSelectionChange: () => {},
    evaluate,
    grid,
  });
  const viewport = host.querySelector<HTMLElement>(".grid-viewport")!;
  Object.defineProperties(viewport, {
    clientWidth: { configurable: true, value: 600 },
    clientHeight: { configurable: true, value: 300 },
  });
  engine.setDoc(workbook());
  return { engine, host, viewport, changes, evaluate };
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

  it("tiene le battute locali e pubblica una sola operazione al commit", () => {
    const { engine, host, viewport, changes, evaluate } = mounted();
    const evaluationsBeforeTyping = evaluate.mock.calls.length;

    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "X", bubbles: true }));
    expect(changes).toHaveLength(0);
    expect(evaluate).toHaveBeenCalledTimes(evaluationsBeforeTyping);
    expect(host.querySelector<HTMLElement>(".grid-cell-editor")!.hidden).toBe(false);

    host.querySelector<HTMLElement>(".grid-cell-editor .cm-content")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(changes).toHaveLength(1);
    expect(changes[0].operation.kind).toBe("grid");
    expect(changes[0].operation.patches).toHaveLength(1);
    expect(parseWorkbook(engine.getDoc()).sheets[0].cells?.[0].input).toBe("X");
    expect(evaluate.mock.calls.length).toBe(evaluationsBeforeTyping + 1);
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
    const { engine, host, viewport, changes } = mounted(undefined, grid);
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
    expect(grid.calls.filter((call) => call === "window").length).toBeGreaterThan(windowsBeforeTyping);
    expect(grid.calls.filter((call) => call === "apply")).toHaveLength(1);
    expect(changes).toHaveLength(1);
    expect(changes[0].text).toContain('"X"');
    expect(engine.getDoc()).toContain('"X"');
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

  it("scarta una valutazione stantia senza sovrascrivere il valore più recente", async () => {
    const pending: ((value: {
      cells: { sheet: string; row: string; column: string; value: { kind: "number"; value: number } }[];
      dependencies: never[];
    }) => void)[] = [];
    const evaluator = () => new Promise<{
      cells: { sheet: string; row: string; column: string; value: { kind: "number"; value: number } }[];
      dependencies: never[];
    }>((resolve) => pending.push(resolve));
    const { engine, host } = mounted(evaluator);
    const latest = JSON.parse(workbook());
    latest.sheets[0].cells[0].input = "2";
    engine.setDoc(JSON.stringify(latest));


    pending[1]!({
      cells: [{ sheet: "main", row: "r0", column: "c0", value: { kind: "number", value: 22 } }],
      dependencies: [],
    });
    await Promise.resolve();
    expect(host.querySelector<HTMLElement>('.grid-cell[data-row="0"][data-column="0"]')!.textContent)
      .toBe("22");

    pending[0]!({
      cells: [{ sheet: "main", row: "r0", column: "c0", value: { kind: "number", value: 11 } }],
      dependencies: [],
    });
    await Promise.resolve();
    expect(host.querySelector<HTMLElement>('.grid-cell[data-row="0"][data-column="0"]')!.textContent)
      .toBe("22");
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
    const { engine } = mounted(undefined, grid);
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
    const first = mounted(undefined, grid);
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

    const second = mounted(undefined, grid);
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
  it("rifiuta famiglia o versione sconosciuta prima di aprire una sessione", async () => {
    const source = workbook();
    const grid = protocolHost(source);
    Object.assign(grid, {
      listGridSurfaces: async () => [
        { id: "wrong-family", format: "fubsheet", family: "other", protocol_version: 1 },
        { id: "wrong-version", format: "fubsheet", family: "grid", protocol_version: 2 },
      ],
    });
    const { engine, host } = mounted(undefined, grid);
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
    const { engine, host } = mounted(undefined, grid);
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
    const { engine, host } = mounted(undefined, grid);
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
    expect(grid.calls.filter((call) => call === "close")).toHaveLength(1);
    expect(engine.getDoc()).toBe(next);
    expect(host.querySelector<HTMLElement>(".grid-surface")!.dataset.gridProtocol).toBe("fallback");
    expect(host.querySelector<HTMLElement>('.grid-cell[data-row="0"][data-column="0"]')!.textContent)
      .toBe("reloaded");
    engine.destroy();
  });

  it("mostra l'input autorevole quando il valutatore Rust non è disponibile", async () => {
    const { engine, host } = mounted(async () => {
      throw new Error("host fake: il motore formule Rust non è montato");
    });
    await Promise.resolve();

    expect(host.querySelector<HTMLElement>(".grid-surface")!.dataset.evaluation).toBe("unavailable");
    expect(host.querySelector<HTMLElement>('.grid-cell[data-row="0"][data-column="0"]')!.textContent)
      .toBe("1");
    engine.destroy();
  });
});
