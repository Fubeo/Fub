// @vitest-environment happy-dom
//
// Le tabelle del documento nel modo «documento» della Tabella: Tab fra le
// celle, Maiusc con le frecce oltre la cella per scegliere celle, e sulle
// celle scelte Canc, gli appunti e «Unisci celle».
import { afterEach, describe, expect, it } from "vitest";
import { RichEngine } from "./engine";
import { selectedCells } from "./cell-selection";
import { parseProjection, type Block, type Para, type Table, type TextInline } from "./projection";

let engines: RichEngine[] = [];
afterEach(() => {
  for (const engine of engines) engine.destroy();
  engines = [];
  document.body.replaceChildren();
});

const para = (x: string): Block => ({ t: "para", role: { kind: "body" }, c: x ? [{ t: "text", x }] : [] }) as Block;
const cell = (x: string) => ({ k: `K${x}`, blocks: [para(x)] });

function engine(rows: string[][]): RichEngine {
  const parent = document.createElement("div");
  document.body.append(parent);
  const made = new RichEngine(parent, { label: () => "documento", onChange: () => {}, onSelectionChange: () => {} });
  const table: Block = { t: "table", k: "T", rows: rows.map((row, r) => ({ k: `R${r}`, cells: row.map(cell) })) } as Block;
  made.setDoc(JSON.stringify({ format: "fub-rich", version: 1, blocks: [table, para("dopo")] }));
  engines.push(made);
  return made;
}

function at(e: RichEngine, needle: string): number {
  let found = -1;
  e.state.doc.descendants((node, pos) => {
    if (found < 0 && node.isText && node.text!.includes(needle)) found = pos + node.text!.indexOf(needle);
    return found < 0;
  });
  if (found < 0) throw new Error(`${needle} non c'è`);
  return found;
}

function grid(e: RichEngine): string[][] {
  const table = parseProjection(e.getDoc()).blocks.find((b) => b.t === "table") as Table;
  return table.rows.map((row) => row.cells.map((c) => c.blocks.map((b) => ((b as Para).c?.[0] as TextInline | undefined)?.x ?? "").join("+")));
}

function press(key: string, init: KeyboardEventInit = {}): boolean {
  const editable = document.querySelector<HTMLElement>(".rich-content")!;
  return !editable.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
}

describe("le tabelle del documento", () => {
  it("Tab va alla cella dopo col suo testo scelto, Maiusc+Tab a quella prima", () => {
    const e = engine([["a", "b"], ["c", "d"]]);
    e.select(at(e, "a"));
    expect(press("Tab")).toBe(true);
    expect(e.state.doc.textBetween(e.state.selection.from, e.state.selection.to)).toBe("b");
    press("Tab");
    expect(e.state.doc.textBetween(e.state.selection.from, e.state.selection.to)).toBe("c");
    press("Tab", { shiftKey: true });
    expect(e.state.doc.textBetween(e.state.selection.from, e.state.selection.to)).toBe("b");
    // Nessuna tabulazione scritta.
    expect(grid(e)).toEqual([["a", "b"], ["c", "d"]]);
  });

  it("Tab nell'ultima cella aggiunge una riga come l'ultima, e ci va", () => {
    const e = engine([["a", "b"], ["c", "d"]]);
    e.select(at(e, "d") + 1);
    press("Tab");
    expect(grid(e)).toEqual([["a", "b"], ["c", "d"], ["", ""]]);
    e.apply((state, dispatch) => {
      dispatch?.(state.tr.insertText("x"));
      return true;
    });
    expect(grid(e)[2]).toEqual(["x", ""]);
  });

  it("Maiusc+freccia alla fine della cella sceglie le celle, Canc le svuota", () => {
    const e = engine([["a", "b", "c"], ["d", "e", "f"]]);
    e.select(at(e, "a") + 1);
    expect(press("ArrowRight", { shiftKey: true })).toBe(true);
    expect(press("ArrowDown", { shiftKey: true })).toBe(true);
    const chosen = selectedCells(e.state)!;
    expect(chosen.range).toEqual({ r0: 0, c0: 0, r1: 1, c1: 1 });
    expect(document.querySelectorAll(".is-cell-selected")).toHaveLength(4);
    expect(document.querySelector(".has-cell-selection")).not.toBeNull();
    expect(press("Delete")).toBe(true);
    expect(grid(e)).toEqual([["", "", "c"], ["", "", "f"]]);
    expect(selectedCells(e.state)).toBeNull();
  });

  it("dentro il testo della cella Maiusc+freccia resta del testo", () => {
    const e = engine([["abc", "b"]]);
    e.select(at(e, "abc") + 1);
    expect(press("ArrowRight", { shiftKey: true })).toBe(false);
    expect(selectedCells(e.state)).toBeNull();
  });

  it("una freccia senza Maiusc spegne le celle scelte", () => {
    const e = engine([["a", "b"]]);
    e.select(at(e, "a") + 1);
    press("ArrowRight", { shiftKey: true });
    expect(selectedCells(e.state)).not.toBeNull();
    e.select(at(e, "a"));
    expect(selectedCells(e.state)).toBeNull();
  });

  it("le celle scelte in una riga si uniscono", () => {
    const e = engine([["a", "b", "c"], ["d", "e", "f"]]);
    e.select(at(e, "a") + 1);
    press("ArrowRight", { shiftKey: true });
    press("ArrowRight", { shiftKey: true });
    expect(e.run("rich.table.merge")).toBe(true);
    expect(grid(e)[0]).toEqual(["a+b+c"]);
  });

  it("copia le celle scelte in TSV e in una tabella HTML", () => {
    const e = engine([["a", "b"], ["c", "d"]]);
    e.select(at(e, "a") + 1);
    press("ArrowDown", { shiftKey: true });
    const data = new Map<string, string>();
    const event = new Event("copy", { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(event, "clipboardData", { value: { setData: (type: string, value: string) => void data.set(type, value) } });
    document.querySelector<HTMLElement>(".rich-content")!.dispatchEvent(event);
    expect(data.get("text/plain")).toBe("a\nc\n");
    expect(data.get("text/html")).toContain("<table");
  });
});
