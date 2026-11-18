// @vitest-environment happy-dom
//
// Le tabelle del documento nel modo «documento» della Tabella: Tab fra le
// celle, Maiusc con le frecce oltre la cella per scegliere celle, e sulle
// celle scelte i gesti del foglio, gli appunti e «Unisci celle».
import { afterEach, describe, expect, it, vi } from "vitest";
import { TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { resolvedLanguage, t } from "../../i18n/strings";
import { todayText } from "../../tabella/series";
import { recentNotices } from "../../ui/notify";
import { RichEngine } from "./engine";
import { cellAt, cellBoxes, cutCells, DOCUMENT_TABLE_CAPS, selectedCells } from "./cell-selection";
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
  type ConformanceTarget,
} from "../../tabella/conformance";
import { parseProjection, type Block, type Para, type Table, type TextInline } from "./projection";

let engines: RichEngine[] = [];
afterEach(() => {
  for (const engine of engines) engine.destroy();
  engines = [];
  document.body.replaceChildren();
});

const para = (x: string): Block => ({ t: "para", role: { kind: "body" }, c: x ? [{ t: "text", x }] : [] }) as Block;

function engine(rows: string[][]): RichEngine {
  return engineOf(rows.map((row) => row.map((x) => [para(x)])));
}

/// Un documento con una tabella di celle coi blocchi `rows`, poi «dopo».
function engineOf(rows: Block[][][]): RichEngine {
  const parent = document.createElement("div");
  document.body.append(parent);
  const made = new RichEngine(parent, { label: () => "documento", onChange: () => {}, onSelectionChange: () => {} });
  const table: Block = { t: "table", k: "T", rows: rows.map((row, r) => ({ k: `R${r}`, cells: row.map((blocks, c) => ({ k: `K${r}-${c}`, blocks })) })) } as Block;
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
    // Come nei fogli di calcolo le celle restano scelte, e Ctrl+Z torna in un passo.
    expect(selectedCells(e.state)?.range).toEqual({ r0: 0, c0: 0, r1: 1, c1: 1 });
    expect(press("z", { ctrlKey: true })).toBe(true);
    expect(grid(e)).toEqual([["a", "b", "c"], ["d", "e", "f"]]);
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

  it("il taglio segna le celle (non le svuota), Esc toglie il segno, una modifica anche", () => {
    const e = engine([["a", "b"], ["c", "d"]]);
    e.select(at(e, "a") + 1);
    press("ArrowDown", { shiftKey: true });
    const cut = () => {
      const event = new Event("cut", { bubbles: true, cancelable: true }) as ClipboardEvent;
      Object.defineProperty(event, "clipboardData", { value: { setData: () => {} } });
      document.querySelector<HTMLElement>(".rich-content")!.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(cut()).toBe(true);
    expect(grid(e)).toEqual([["a", "b"], ["c", "d"]]);
    expect(document.querySelectorAll(".is-cell-cut")).toHaveLength(2);
    expect(press("Escape")).toBe(true);
    expect(document.querySelectorAll(".is-cell-cut")).toHaveLength(0);
    expect(selectedCells(e.state)).not.toBeNull();
    cut();
    expect(document.querySelectorAll(".is-cell-cut")).toHaveLength(2);
    e.apply((state, dispatch) => {
      dispatch?.(state.tr.insertText("x"));
      return true;
    });
    expect(document.querySelectorAll(".is-cell-cut")).toHaveLength(0);
  });

  it("un Ctrl+clic fuori dalle celle le spegne: Canc dopo non svuota le celle vecchie", () => {
    const e = engine([["a", "b", "c"], ["d", "e", "f"], ["g", "h", "i"]]);
    e.select(at(e, "e") + 1);
    press("ArrowRight", { shiftKey: true });
    press("ArrowDown", { shiftKey: true });
    expect(selectedCells(e.state)?.range).toEqual({ r0: 1, c0: 1, r1: 2, c1: 2 });
    // Ctrl+clic nel paragrafo dopo la tabella: il browser sposta il cursore.
    const content = document.querySelector<HTMLElement>(".rich-content")!;
    content.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, ctrlKey: true, button: 0, clientX: 5, clientY: 500 }));
    content.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, ctrlKey: true, button: 0, clientX: 5, clientY: 500 }));
    e.apply((state, dispatch) => {
      dispatch?.(state.tr.setSelection(TextSelection.create(state.doc, at(e, "dopo") + 2)).setMeta("pointer", true));
      return true;
    });
    expect(selectedCells(e.state)).toBeNull();
    press("Delete");
    expect(grid(e)).toEqual([["a", "b", "c"], ["d", "e", "f"], ["g", "h", "i"]]);
  });

  it("con più intervalli copia e taglia non fanno niente e lo dicono", () => {
    const e = engine([["a", "b"], ["c", "d"]]);
    e.select(at(e, "a") + 1);
    press("ArrowRight", { shiftKey: true });
    press("F8", { shiftKey: true });
    press("ArrowDown");
    expect(selectedCells(e.state)?.others).toHaveLength(1);
    const data = new Map<string, string>();
    const event = new Event("cut", { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(event, "clipboardData", { value: { setData: (type: string, value: string) => void data.set(type, value) } });
    document.querySelector<HTMLElement>(".rich-content")!.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(data.size).toBe(0);
    expect(cutCells(e.state)).toBeNull();
    expect(recentNotices()[0]?.text).toBe(t("grid.multi.refused"));
  });

  it("il primo taglio dice che incollato fuori dalla sua tabella si copia", () => {
    const e = engine([["a", "b"], ["c", "d"]]);
    e.select(at(e, "a") + 1);
    press("ArrowDown", { shiftKey: true });
    const event = new Event("cut", { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(event, "clipboardData", { value: { setData: () => {} } });
    document.querySelector<HTMLElement>(".rich-content")!.dispatchEvent(event);
    expect(recentNotices().map((notice) => notice.text)).toContain(t("table.cut.marked"));
  });

  it("dove ci sono celle unite Ctrl+«+» non inserisce colonne", () => {
    const e = engine([["a", "b", "c"], ["d", "e", "f"]]);
    e.select(at(e, "a") + 1);
    press("ArrowRight", { shiftKey: true });
    e.run("rich.table.merge");
    e.select(at(e, "f") + 1);
    expect(press(" ", { ctrlKey: true, code: "Space" })).toBe(true);
    expect(press("+", { ctrlKey: true, shiftKey: true, code: "Equal" })).toBe(true);
    expect(grid(e)).toEqual([["a+b", "c"], ["d", "e", "f"]]);
  });

  it("senza celle scelte Invio, Ctrl+D e Ctrl+«+» restano del testo", () => {
    const e = engine([["a", "b"], ["c", "d"]]);
    e.select(at(e, "a") + 1);
    expect(press("d", { ctrlKey: true, code: "KeyD" })).toBe(false);
    expect(press("+", { ctrlKey: true, shiftKey: true, code: "Equal" })).toBe(false);
    expect(selectedCells(e.state)).toBeNull();
    expect(grid(e)).toEqual([["a", "b"], ["c", "d"]]);
  });

  it("Ctrl+; con celle scelte: il testo semplice lascia il posto alla data, una cella ricca non perde niente", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-15T12:00:00"));
    try {
      const today = todayText(new Date(), resolvedLanguage());
      const bold: Block = { t: "para", role: { kind: "body" }, c: [{ t: "text", x: "nero", m: ["b"] }] } as Block;
      const e = engineOf([
        [[para("a")], [para("b")]],
        [[para("uno"), para("due")], [bold]],
      ]);
      const cellText = () => {
        const table = parseProjection(e.getDoc()).blocks.find((b) => b.t === "table") as Table;
        return table.rows.map((row) => row.cells.map((c) => c.blocks.map((b) => ((b as Para).c ?? []).map((i) => (i as TextInline).x).join("")).join("+")));
      };
      // Una cella di solo testo: la data al suo posto.
      e.select(at(e, "a") + 1);
      press("ArrowRight", { shiftKey: true });
      press(";", { ctrlKey: true, code: "Semicolon" });
      expect(cellText()[0]).toEqual([today, "b"]);
      // Due paragrafi: la data in fondo al primo, il secondo resta.
      e.select(at(e, "due") + 3);
      press("ArrowRight", { shiftKey: true });
      press(";", { ctrlKey: true, code: "Semicolon" });
      expect(cellText()[1]![0]).toBe(`uno ${today}+due`);
      // Un testo in grassetto resta in grassetto, e la data va dopo.
      e.select(at(e, "nero"));
      press("ArrowLeft", { shiftKey: true });
      press(";", { ctrlKey: true, code: "Semicolon" });
      const table = parseProjection(e.getDoc()).blocks.find((b) => b.t === "table") as Table;
      const inlines = (table.rows[1]!.cells[1]!.blocks[0] as Para).c as TextInline[];
      expect(inlines[0]).toMatchObject({ x: "nero", m: ["b"] });
      expect(inlines.map((i) => i.x).join("")).toBe(`nero ${today}`);
    } finally {
      vi.useRealTimers();
    }
  });

  it("Ctrl+Alt con le frecce sposta righe e colonne col cambio di tabella comune: con celle unite le colonne restano", () => {
    const e = engine([["a", "b", "c"], ["d", "e", "f"]]);
    e.select(at(e, "e") + 1);
    expect(e.run("markdown.table.column.right")).toBe(true);
    expect(grid(e)).toEqual([["a", "c", "b"], ["d", "f", "e"]]);
    expect(e.run("markdown.table.row.up")).toBe(true);
    expect(grid(e)).toEqual([["d", "f", "e"], ["a", "c", "b"]]);
    // Il cursore resta nel testo che si è spostato.
    expect(e.state.selection.$from.parent.textContent).toBe("e");
    e.select(at(e, "a") + 1);
    press("ArrowRight", { shiftKey: true });
    e.run("rich.table.merge");
    e.select(at(e, "f") + 1);
    expect(e.run("markdown.table.column.left")).toBe(false);
    expect(e.run("markdown.table.column.right")).toBe(false);
    expect(grid(e)).toEqual([["d", "f", "e"], ["a+c", "b"]]);
    // Le righe si spostano anche con celle unite: ognuna resta intera.
    expect(e.run("markdown.table.row.down")).toBe(true);
    expect(grid(e)).toEqual([["a+c", "b"], ["d", "f", "e"]]);
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

// IMP-132: il trascinamento del browser lascia una selezione di testo da una
// cella all'altra; Canc e Backspace su di lei toglievano una cella dalla riga.
describe("la forma della tabella resta", () => {
  const NINE = [["aa", "bb", "cc"], ["dd", "ee", "ff"], ["gg", "hh", "ii"]];
  const keyCode = (key: string) => (key === "Backspace" ? 8 : 46);

  for (const key of ["Delete", "Backspace"]) {
    it(`${key} su una selezione di testo da una cella all'altra svuota le celle, in ogni riga`, () => {
      const e = engine(NINE);
      // Due celle della prima riga, come il trascinamento della scheda.
      e.select(at(e, "aa") + 1, at(e, "bb") + 1);
      expect(selectedCells(e.state)?.range).toEqual({ r0: 0, c0: 0, r1: 0, c1: 1 });
      expect(press(key, { keyCode: keyCode(key) })).toBe(true);
      expect(grid(e)).toEqual([["", "", "cc"], ["dd", "ee", "ff"], ["gg", "hh", "ii"]]);
      // Le due celle dell'ultima riga, la colonna di mezzo.
      e.select(at(e, "hh") + 1, at(e, "ii") + 1);
      press(key, { keyCode: keyCode(key) });
      e.select(at(e, "ee"), at(e, "ff") + 2);
      press(key, { keyCode: keyCode(key) });
      expect(grid(e)).toEqual([["", "", "cc"], ["dd", "", ""], ["gg", "", ""]]);
      expect(press("z", { ctrlKey: true })).toBe(true);
      expect(press("z", { ctrlKey: true })).toBe(true);
      expect(press("z", { ctrlKey: true })).toBe(true);
      expect(grid(e)).toEqual(NINE);
    });

    it(`${key} su una selezione che esce dalla tabella toglie il testo e svuota le celle, senza unirle`, () => {
      const e = engine(NINE);
      e.select(at(e, "ee") + 1, at(e, "dopo") + 2);
      expect(selectedCells(e.state)).toBeNull();
      expect(press(key, { keyCode: keyCode(key) })).toBe(true);
      expect(grid(e)).toEqual([["aa", "bb", "cc"], ["dd", "e", ""], ["", "", ""]]);
      const blocks = parseProjection(e.getDoc()).blocks;
      const after = blocks[blocks.length - 1] as Para;
      expect((after.c?.[0] as TextInline).x).toBe("po");
    });
  }

  it("una lettera su una selezione che esce dalla tabella va al posto del testo scelto", () => {
    const e = engine([["aa", "bb"]]);
    e.select(at(e, "bb") + 1, at(e, "dopo") + 2);
    const editable = document.querySelector<HTMLElement>(".rich-content")!;
    const keypress = new KeyboardEvent("keypress", { key: "x", bubbles: true, cancelable: true });
    Object.defineProperty(keypress, "charCode", { value: 120 });
    const typed = !editable.dispatchEvent(keypress);
    expect(typed).toBe(true);
    expect(grid(e)).toEqual([["aa", "bx"]]);
    const blocks = parseProjection(e.getDoc()).blocks;
    const after = blocks[blocks.length - 1] as Para;
    expect((after.c?.[0] as TextInline).x).toBe("po");
  });

  // IMP-134: il trascinamento su più righe sceglieva solo l'ultima riga, o
  // niente. Il puntatore del test è quello vero di ProseMirror e della
  // superficie (mousedown, mousemove, mouseup); la posizione sotto il
  // puntatore la dà `posAtCoords`, che happy-dom non sa calcolare.
  describe("col trascinamento", () => {
    const drag = (e: RichEngine, path: string[], options: { late?: [string, string] } = {}) => {
      const spot = (needle: string) => ({ clientX: 10 + path.indexOf(needle), clientY: 10 + path.indexOf(needle) });
      const spy = vi.spyOn(EditorView.prototype, "posAtCoords").mockImplementation(({ left }) => {
        const needle = path[left - 10];
        return needle ? { pos: at(e, needle) + 1, inside: -1 } : null;
      });
      try {
        const content = document.querySelector<HTMLElement>(".rich-content")!;
        content.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, ...spot(path[0]!) }));
        for (const needle of path.slice(1, -1)) {
          document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, buttons: 1, ...spot(needle) }));
        }
        // Il browser rilegge la sua selezione del trascinamento, con
        // un'àncora sua, senza il puntatore.
        if (options.late) e.select(at(e, options.late[0]) + 1, at(e, options.late[1]) + 1);
        document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0, ...spot(path[path.length - 1]!) }));
        if (options.late) e.select(at(e, options.late[0]) + 1, at(e, options.late[1]) + 1);
      } finally {
        spy.mockRestore();
      }
    };

    it("da A a I in diagonale sceglie tutto il rettangolo, anche se il browser rilegge solo l'ultima riga", () => {
      const e = engine(NINE);
      drag(e, ["aa", "ee", "hh", "ii"], { late: ["gg", "ii"] });
      expect(selectedCells(e.state)?.range).toEqual({ r0: 0, c0: 0, r1: 2, c1: 2 });
      expect(press("Delete", { keyCode: 46 })).toBe(true);
      expect(grid(e)).toEqual([["", "", ""], ["", "", ""], ["", "", ""]]);
    });

    it("da B a H in verticale sceglie la colonna, anche senza movimenti sopra le celle", () => {
      const e = engine(NINE);
      drag(e, ["bb", "hh"]);
      expect(selectedCells(e.state)?.range).toEqual({ r0: 0, c0: 1, r1: 2, c1: 1 });
      expect(press("Backspace", { keyCode: 8 })).toBe(true);
      expect(grid(e)).toEqual([["aa", "", "cc"], ["dd", "", "ff"], ["gg", "", "ii"]]);
    });
  });

  // Taglia e Invio su una selezione che esce dalla tabella: prima copiavano
  // soltanto, o non facevano niente, perché la guardia rifiuta l'unione.
  it("Taglia su una selezione che esce dalla tabella copia e svuota come Canc, in un passo", () => {
    const e = engine(NINE);
    e.select(at(e, "ee") + 1, at(e, "dopo") + 2);
    const data = new Map<string, string>();
    const event = new Event("cut", { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(event, "clipboardData", {
      value: { clearData: () => data.clear(), setData: (type: string, value: string) => void data.set(type, value) },
    });
    document.querySelector<HTMLElement>(".rich-content")!.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(data.get("text/plain")).toContain("ff");
    expect(data.get("text/plain")).toContain("do");
    expect(data.get("text/html")).toContain("gg");
    expect(grid(e)).toEqual([["aa", "bb", "cc"], ["dd", "e", ""], ["", "", ""]]);
    const blocks = parseProjection(e.getDoc()).blocks;
    expect(((blocks[blocks.length - 1] as Para).c?.[0] as TextInline).x).toBe("po");
    expect(press("z", { ctrlKey: true })).toBe(true);
    expect(grid(e)).toEqual(NINE);
  });

  it("Invio su una selezione che esce dalla tabella svuota come Canc e va a capo dove cominciava", () => {
    const e = engine(NINE);
    e.select(at(e, "ee") + 1, at(e, "dopo") + 2);
    expect(press("Enter")).toBe(true);
    // La cella dove cominciava ha due paragrafi, «e» e quello nuovo, col cursore.
    expect(grid(e)).toEqual([["aa", "bb", "cc"], ["dd", "e+", ""], ["", "", ""]]);
    const here = cellAt(e.state.selection.$head);
    expect(here && [here.box.row, here.box.column]).toEqual([1, 1]);
    expect(e.state.selection.$head.parent.textContent).toBe("");
    expect(e.state.selection.$head.index(e.state.selection.$head.depth - 1)).toBe(1);
    const blocks = parseProjection(e.getDoc()).blocks;
    expect(((blocks[blocks.length - 1] as Para).c?.[0] as TextInline).x).toBe("po");
    // Un passo solo d'annullamento.
    expect(press("z", { ctrlKey: true })).toBe(true);
    expect(grid(e)).toEqual(NINE);
  });

  it("Maiusc+Invio su una selezione che esce dalla tabella svuota e va a capo nella cella", () => {
    const e = engine(NINE);
    e.select(at(e, "ee") + 1, at(e, "dopo") + 2);
    expect(press("Enter", { shiftKey: true })).toBe(true);
    expect(grid(e)).toEqual([["aa", "bb", "cc"], ["dd", "e\n", ""], ["", "", ""]]);
  });

  it("nessuna transazione unisce due celle, e la cronologia e il disco passano", () => {
    const e = engine(NINE);
    // Una cancellazione grezza da una cella al paragrafo dopo la tabella.
    e.select(at(e, "ii") + 1, at(e, "dopo") + 2);
    const tr = e.state.tr.deleteSelection();
    e.dispatch(tr);
    expect(grid(e)).toEqual(NINE);
    // Una cella in meno in una riga, da un comando che ne togliesse una.
    const firstCell = cellBoxes(e.state.doc.nodeAt(0)!, 0)[0]!;
    e.dispatch(e.state.tr.delete(firstCell.pos, firstCell.pos + firstCell.node.nodeSize));
    expect(grid(e)[0]).toHaveLength(3);
    // Il documento riletto dal disco vale com'è, anche con righe diverse.
    const ragged: Block = { t: "table", k: "T", rows: [{ k: "R0", cells: [{ k: "K0", blocks: [para("x")] }] }, { k: "R1", cells: [{ k: "K1", blocks: [para("y")] }, { k: "K2", blocks: [para("z")] }] }] } as Block;
    e.syncDoc(JSON.stringify({ format: "fub-rich", version: 1, blocks: [ragged, para("dopo")] }));
    expect(grid(e)).toEqual([["x"], ["y", "z"]]);
    // E una tabella che era già così si scrive.
    e.select(at(e, "y") + 1);
    e.dispatch(e.state.tr.insertText("!"));
    expect(grid(e)).toEqual([["x"], ["y!", "z"]]);
  });
});

describe("la prova comune della Tabella, sul documento", () => {
  const target: ConformanceTarget = { mode: "document", caps: DOCUMENT_TABLE_CAPS, bounded: true, delegates: false };

  /// La cella del cursore.
  const here = (e: RichEngine) => {
    const found = cellAt(e.state.selection.$head)!;
    return { row: found.box.row, column: found.box.column };
  };

  /// Un tasto come lo premerebbe la persona: una freccia senza Maiusc che la
  /// tabella lascia al testo il browser la porta nella cella accanto. Qui il
  /// cursore va alla fine del testo di quella cella.
  function key(e: RichEngine, name: string, init: KeyboardEventInit): void {
    if (press(name, init)) return;
    const step = ({ ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] } as Record<string, [number, number]>)[name];
    if (!step || init.shiftKey || init.ctrlKey || init.altKey) return;
    const found = cellAt(e.state.selection.$head);
    if (!found) return;
    const next = cellBoxes(found.table, found.tablePos).find((box) => box.row === found.box.row + step[0] && box.column === found.box.column + step[1]);
    if (next) e.select(next.pos + next.node.nodeSize - 2);
  }

  /// Un evento degli appunti sul testo del documento, con gli appunti finti.
  function clipboard(kind: "cut" | "copy" | "paste", store: ConformanceClipboard): void {
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
    document.querySelector<HTMLElement>(".rich-content")!.dispatchEvent(event);
  }

  /// `refused` raccoglie i comandi che il documento non ha eseguito.
  function driver(e: RichEngine, refused: string[] = []): ConformanceDriver {
    return {
      key: (name, init) => key(e, name, init),
      command: (id) => {
        if (!e.run(id)) refused.push(id);
      },
      // Il documento non ha né la maniglia né le intestazioni: il gesto non
      // trova dove farsi, e i casi che lo usano lì mancano col perché.
      pointer: () => {},
      clipboard,
      cells: () => grid(e),
      active: () => here(e),
      range: () => {
        const chosen = selectedCells(e.state);
        if (chosen) return chosen.range;
        const cell = here(e);
        return { r0: cell.row, c0: cell.column, r1: cell.row, c1: cell.column };
      },
      cut: () => cutCells(e.state),
      ranges: () => {
        const chosen = selectedCells(e.state);
        return chosen ? chosen.others.length + 1 : 1;
      },
    };
  }

  /// Il documento della prova, col cursore alla fine del testo della prima cella.
  function start(test: ConformanceCase): RichEngine {
    const e = engine(test.rows.map((row) => [...row]));
    const first = test.rows[0]![0]!;
    e.select(at(e, first) + first.length);
    return e;
  }

  afterEach(() => {
    vi.useRealTimers();
  });
  /// L'orologio del caso, se ne ha uno.
  const clock = (test: ConformanceCase) => {
    if (!test.today) return;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(test.today));
  };

  for (const test of TABLE_CONFORMANCE) {
    if (caseApplies(test, target)) {
      it(test.name, async () => {
        clock(test);
        const seen = await playCase(test, driver(start(test)));
        const expected = expectedOf(test, target);
        expect(seenOf(seen, expected)).toEqual(expected);
      });
      continue;
    }
    const reason = caseAbsence(test, target);
    if (reason === null) continue;
    it(`${test.name}: assente (${reason})`, async () => {
      clock(test);
      const e = start(test);
      const refused: string[] = [];
      const seen = await playCase(test, driver(e, refused));
      if (test.absent?.document) {
        // Un gesto che manca apposta la Tabella non lo prende: i tasti restano
        // del testo (Invio va a capo), la forma della tabella non cambia e
        // non ci sono celle scelte né segni del taglio.
        expect(seen.cells.map((row) => row.length)).toEqual(test.rows.map((row) => row.length));
        expect(selectedCells(e.state)).toBeNull();
        expect(cutCells(e.state)).toBeNull();
      } else {
        // Manca una capacità: il documento rifiuta il comando che la chiede.
        expect(refused.length).toBeGreaterThan(0);
      }
    });
  }
});
