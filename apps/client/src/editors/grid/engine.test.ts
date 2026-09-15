// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { findTextEditorOrThrow } from "../text/test-support";
import type { GridApplyRequest, GridSession, GridWindow } from "../../host/contract";
import { parseWorkbook } from "./model";
import { commitGridPatches, inputPatch } from "./operation";
import {
  GridEngine,
  type GridChange,
  type GridProviderClient,
} from "./engine";

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

function mockProvider(
  overrides: Partial<GridProviderClient> = {},
): GridProviderClient {
  let source = "";
  const instance = "grid-test";
  const provider: GridProviderClient = {
    listSurfaces: vi.fn(async () => [{
      id: "fub.grid.sheet",
      format: "fubsheet",
      protocol_version: 1,
    }]),
    open: vi.fn(async (_surface, nextSource) => {
      source = nextSource;
      const parsed = parseWorkbook(source);
      return {
        instance,
        sheets: parsed.sheets.map((sheet) => ({
          id: sheet.id,
          name: sheet.name,
          row_count: sheet.rows.length,
          column_count: sheet.columns.length,
        })),
      };
    }),
    window: vi.fn(async (_surface, _instance, request) => {
      const sheet = parseWorkbook(source).sheets.find((candidate) => candidate.id === request.sheet)!;
      const rows = sheet.rows.slice(request.row_start, request.row_start + request.row_count);
      const columns = sheet.columns.slice(
        request.column_start,
        request.column_start + request.column_count,
      );
      const rowIds = new Set(rows.map((row) => row.id));
      const columnIds = new Set(columns.map((column) => column.id));
      return {
        sheet: sheet.id,
        rows: rows.map((row, offset) => ({
          id: row.id,
          index: request.row_start + offset,
          height: row.height ?? null,
          hidden: row.hidden,
        })),
        columns: columns.map((column, offset) => ({
          id: column.id,
          index: request.column_start + offset,
          width: column.width ?? null,
          hidden: column.hidden,
        })),
        cells: (sheet.cells ?? [])
          .filter((cell) => rowIds.has(cell.row) && columnIds.has(cell.column))
          .map((cell) => ({
            key: { sheet: sheet.id, row: cell.row, column: cell.column },
            snapshot: {
              input: cell.input ?? "",
              style: {
                bold: cell.style?.bold ?? false,
                italic: cell.style?.italic ?? false,
                text_color: cell.style?.text_color ?? null,
                fill_color: cell.style?.fill_color ?? null,
                horizontal: cell.style?.horizontal ?? null,
                number_format: cell.style?.number_format ?? null,
              },
            },
            value: Number.isFinite(Number(cell.input))
              ? { kind: "number" as const, value: Number(cell.input) }
              : { kind: "text" as const, value: cell.input ?? "" },
          })),
      };
    }),
    apply: vi.fn(async (_surface: string, _instance: string, request: GridApplyRequest) => {
      const parsed = parseWorkbook(source);
      const patches = request.patches.map((patch) => ({
        coordinate: patch.cell,
        before: patch.before && {
          input: patch.before.input,
          style: {
            ...(patch.before.style.bold ? { bold: true } : {}),
            ...(patch.before.style.italic ? { italic: true } : {}),
            ...(patch.before.style.text_color ? { text_color: patch.before.style.text_color } : {}),
            ...(patch.before.style.fill_color ? { fill_color: patch.before.style.fill_color } : {}),
            ...(patch.before.style.horizontal ? { horizontal: patch.before.style.horizontal } : {}),
            ...(patch.before.style.number_format ? { number_format: patch.before.style.number_format } : {}),
          },
        },
        after: patch.after && {
          input: patch.after.input,
          style: {
            ...(patch.after.style.bold ? { bold: true } : {}),
            ...(patch.after.style.italic ? { italic: true } : {}),
            ...(patch.after.style.text_color ? { text_color: patch.after.style.text_color } : {}),
            ...(patch.after.style.fill_color ? { fill_color: patch.after.style.fill_color } : {}),
            ...(patch.after.style.horizontal ? { horizontal: patch.after.style.horizontal } : {}),
            ...(patch.after.style.number_format ? { number_format: patch.after.style.number_format } : {}),
          },
        },
      }));
      const committed = commitGridPatches(parsed, source, patches)!;
      const before = source;
      source = committed.source;
      return {
        edit: {
          base: "test",
          edits: [{
            span: { start: 0, end: new TextEncoder().encode(before).length },
            text: source,
          }],
        },
        invalidation: { kind: "all" as const },
      };
    }),
    reload: vi.fn(async (_surface, _instance, nextSource) => {
      source = nextSource;
      const parsed = parseWorkbook(source);
      return {
        instance,
        sheets: parsed.sheets.map((sheet) => ({
          id: sheet.id,
          name: sheet.name,
          row_count: sheet.rows.length,
          column_count: sheet.columns.length,
        })),
      };
    }),
    close: vi.fn(async () => {}),
    ...overrides,
  };
  return provider;
}

async function mounted(provider = mockProvider(), waitForOpen = true) {
  const host = document.createElement("div");
  document.body.append(host);
  const changes: GridChange[] = [];
  const engine = new GridEngine(host, {
    surfaceId: "test",
    onChange: (change) => changes.push(change),
    onSelectionChange: () => {},
    provider,
  });
  const viewport = host.querySelector<HTMLElement>(".grid-viewport")!;
  Object.defineProperties(viewport, {
    clientWidth: { configurable: true, value: 600 },
    clientHeight: { configurable: true, value: 300 },
  });
  engine.setDoc(workbook());
  if (waitForOpen) {
    await vi.waitFor(() => expect(provider.open).toHaveBeenCalledTimes(1));
  }
  return { engine, host, viewport, changes, provider };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("GridEngine", () => {
  it("virtualizza entro una finestra limitata e pubblica la semantica grid", async () => {
    const { engine, host, viewport } = await mounted();
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

  it("tiene le battute locali e pubblica una sola operazione al commit", async () => {
    const { engine, host, viewport, changes, provider } = await mounted();
    const windowsBeforeTyping = vi.mocked(provider.window).mock.calls.length;

    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "X", bubbles: true }));
    expect(changes).toHaveLength(0);
    expect(provider.apply).not.toHaveBeenCalled();
    expect(provider.window).toHaveBeenCalledTimes(windowsBeforeTyping);
    expect(host.querySelector<HTMLElement>(".grid-cell-editor")!.hidden).toBe(false);

    host.querySelector<HTMLElement>(".grid-cell-editor .cm-content")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await vi.waitFor(() => expect(changes).toHaveLength(1));
    expect(changes).toHaveLength(1);
    expect(changes[0].operation.kind).toBe("grid");
    expect(changes[0].operation.patches).toHaveLength(1);
    expect(parseWorkbook(engine.getDoc()).sheets[0].cells?.[0].input).toBe("X");
    expect(vi.mocked(provider.apply)).toHaveBeenCalledTimes(1);
    engine.destroy();
  });

  it("incolla TSV come una sola operazione e mantiene undo locale separato dal peer", async () => {
    const { engine, viewport, changes } = await mounted();
    const clipboard = {
      getData: () => "A\tB\nC\tD",
      setData: vi.fn(),
    };
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: clipboard });
    viewport.dispatchEvent(paste);
    await vi.waitFor(() => expect(changes).toHaveLength(1));
    expect(changes).toHaveLength(1);
    expect(changes[0].operation.patches).toHaveLength(4);

    const peerWorkbook = parseWorkbook(engine.getDoc());
    const peerPatch = inputPatch(peerWorkbook.sheets[0], { row: 2, column: 2 }, "peer")!;
    const peer = commitGridPatches(peerWorkbook, engine.getDoc(), [peerPatch])!;
    engine.syncDoc({ text: peer.source, operation: peer.operation });
    await Promise.resolve();

    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }));
    await vi.waitFor(() => expect(changes).toHaveLength(2));
    const afterUndo = parseWorkbook(engine.getDoc()).sheets[0];
    expect(afterUndo.cells?.find((cell) => cell.row === "r0" && cell.column === "c0")?.input).toBe("1");
    expect(afterUndo.cells?.find((cell) => cell.row === "r2" && cell.column === "c2")?.input).toBe("peer");
    expect(changes).toHaveLength(2);
    expect(changes[1].origin).toBe("undo");
    engine.destroy();
  });

  it("estende la selezione da tastiera e ripristina il fuoco dopo Escape", async () => {
    const { engine, host, viewport } = await mounted();
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
    const { engine, host, viewport, changes } = await mounted();
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
    await vi.waitFor(() => expect(changes).toHaveLength(1));
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
    await vi.waitFor(() => expect(changes).toHaveLength(2));
    expect(changes).toHaveLength(2);
    expect(parseWorkbook(engine.getDoc()).sheets[0].cells?.[0].input).toBe("9");
    engine.destroy();
  });

  it("annulla la bozza locale quando un full-text peer ricarica la topologia", async () => {
    const { engine, host, viewport, changes } = await mounted();
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "X", bubbles: true }));
    const peer = JSON.parse(workbook());
    peer.sheets[0].cells[0].input = "peer";

    engine.syncDoc(JSON.stringify(peer));

    expect(host.querySelector<HTMLElement>(".grid-cell-editor")!.hidden).toBe(true);
    expect(parseWorkbook(engine.getDoc()).sheets[0].cells?.[0].input).toBe("peer");
    expect(changes).toHaveLength(0);
    engine.destroy();
  });
  it("salta gli assi nascosti e avvolge Tab sulla riga visibile successiva", async () => {
    const { engine, viewport } = await mounted();
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

  it("non espone un discendente attivo quando ogni asse è nascosto", async () => {
    const { engine, host, viewport, changes } = await mounted();
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

  it("scarta una finestra stantia senza sovrascrivere il valore più recente", async () => {
    const pending: ((value: GridWindow) => void)[] = [];
    const provider = mockProvider({
      window: vi.fn((_surface, _instance, _request) =>
        new Promise<GridWindow>((resolve) => pending.push(resolve))),
    });
    const { engine, host } = await mounted(provider);
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    const latest = JSON.parse(workbook());
    latest.sheets[0].cells[0].input = "2";
    engine.setDoc(JSON.stringify(latest));
    await vi.waitFor(() => expect(pending).toHaveLength(2));

    const response = (value: number): GridWindow => ({
      sheet: "main",
      rows: [{ id: "r0", index: 0, height: null, hidden: false }],
      columns: [{ id: "c0", index: 0, width: null, hidden: false }],
      cells: [{
        key: { sheet: "main", row: "r0", column: "c0" },
        snapshot: {
          input: String(value),
          style: {
            bold: false,
            italic: false,
            text_color: null,
            fill_color: null,
            horizontal: null,
            number_format: null,
          },
        },
        value: { kind: "number", value },
      }],
    });
    pending[1]!(response(22));
    await vi.waitFor(() => {
      expect(host.querySelector<HTMLElement>('.grid-cell[data-row="0"][data-column="0"]')!.textContent)
        .toBe("22");
    });

    pending[0]!(response(11));
    await Promise.resolve();
    expect(host.querySelector<HTMLElement>('.grid-cell[data-row="0"][data-column="0"]')!.textContent)
      .toBe("22");
    engine.destroy();
  });

  it("applica l'ultimo source dopo due reload ravvicinati", async () => {
    const provider = mockProvider();
    const originalReload = provider.reload;
    const reloadSources: string[] = [];
    const releaseReload: (() => void)[] = [];
    provider.reload = vi.fn((surface, instance, source) =>
      new Promise<GridSession>((resolve, reject) => {
        reloadSources.push(source);
        releaseReload.push(() => {
          void originalReload(surface, instance, source).then(resolve, reject);
        });
      }),
    );
    const { engine, host } = await mounted(provider);
    await vi.waitFor(() => expect(provider.window).toHaveBeenCalledTimes(1));

    const first = JSON.parse(workbook());
    first.sheets[0].cells[0].input = "first";
    const latest = JSON.parse(workbook());
    latest.sheets[0].cells[0].input = "latest";
    const firstSource = JSON.stringify(first);
    const latestSource = JSON.stringify(latest);
    engine.setDoc(firstSource);
    engine.setDoc(latestSource);

    await vi.waitFor(() => expect(reloadSources).toHaveLength(1));
    expect(reloadSources[0]).toBe(firstSource);
    releaseReload[0]!();
    await vi.waitFor(() => expect(reloadSources).toHaveLength(2));
    expect(reloadSources[1]).toBe(latestSource);
    releaseReload[1]!();
    await vi.waitFor(() => {
      expect(provider.window).toHaveBeenCalledTimes(2);
      expect(host.querySelector<HTMLElement>('.grid-cell[data-row="0"][data-column="0"]')!.textContent)
        .toBe("latest");
    });
    expect(engine.getDoc()).toBe(latestSource);
    engine.destroy();
  });

  it("non lascia una finestra pre-apply sovrascrivere il valore post-apply", async () => {
    const pending: ((value: GridWindow) => void)[] = [];
    const provider = mockProvider({
      window: vi.fn((_surface, _instance, _request) =>
        new Promise<GridWindow>((resolve) => pending.push(resolve))),
    });
    const { engine, host, viewport } = await mounted(provider);
    await vi.waitFor(() => expect(pending).toHaveLength(1));

    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "X", bubbles: true }));
    host.querySelector<HTMLElement>(".grid-cell-editor .cm-content")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await vi.waitFor(() => expect(provider.apply).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(pending).toHaveLength(2));

    const response = (value: string): GridWindow => ({
      sheet: "main",
      rows: [{ id: "r0", index: 0, height: null, hidden: false }],
      columns: [{ id: "c0", index: 0, width: null, hidden: false }],
      cells: [{
        key: { sheet: "main", row: "r0", column: "c0" },
        snapshot: {
          input: value,
          style: {
            bold: false,
            italic: false,
            text_color: null,
            fill_color: null,
            horizontal: null,
            number_format: null,
          },
        },
        value: { kind: "text", value },
      }],
    });
    pending[1]!(response("post-apply"));
    await vi.waitFor(() => {
      expect(host.querySelector<HTMLElement>('.grid-cell[data-row="0"][data-column="0"]')!.textContent)
        .toBe("post-apply");
    });
    pending[0]!(response("pre-apply"));
    await Promise.resolve();
    expect(host.querySelector<HTMLElement>('.grid-cell[data-row="0"][data-column="0"]')!.textContent)
      .toBe("post-apply");
    engine.destroy();
  });

  it("chiude l'istanza appena aperta anche se destroy arriva durante open", async () => {
    let resolveOpen!: (session: GridSession) => void;
    const opening = new Promise<GridSession>((resolve) => {
      resolveOpen = resolve;
    });
    const provider = mockProvider({
      open: vi.fn(() => opening),
    });
    const { engine } = await mounted(provider, false);
    await vi.waitFor(() => expect(provider.open).toHaveBeenCalledTimes(1));

    engine.destroy();
    resolveOpen({
      instance: "opened-after-destroy",
      sheets: [{ id: "main", name: "Main", row_count: 100, column_count: 50 }],
    });
    await vi.waitFor(() => expect(provider.close).toHaveBeenCalledTimes(1));
    expect(provider.close).toHaveBeenCalledWith("fub.grid.sheet", "opened-after-destroy");
  });

  it("chiude il provider una sola volta anche con destroy ripetuto", async () => {
    const { engine, provider } = await mounted();
    await vi.waitFor(() => expect(provider.window).toHaveBeenCalledTimes(1));

    engine.destroy();
    engine.destroy();
    await vi.waitFor(() => expect(provider.close).toHaveBeenCalledTimes(1));
    expect(provider.close).toHaveBeenCalledTimes(1);
  });
  it("mostra l'input autorevole quando la finestra Rust non è disponibile", async () => {
    const provider = mockProvider({
      window: vi.fn(async () => {
        throw new Error("provider grid non disponibile");
      }),
    });
    const { engine, host } = await mounted(provider);
    await vi.waitFor(() => {
      expect(host.querySelector<HTMLElement>(".grid-surface")!.dataset.provider).toBe("unavailable");
    });

    expect(host.querySelector<HTMLElement>('.grid-cell[data-row="0"][data-column="0"]')!.textContent)
      .toBe("1");
    engine.destroy();
  });
});
