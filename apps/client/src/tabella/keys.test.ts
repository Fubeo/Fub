import { describe, expect, it } from "vitest";
import { addRangesKey, documentIntent, editingIntent, fillKey, sheetIntent, structureKey, wholeKey, type KeyLike } from "./keys";

const press = (key: string, mods: Partial<KeyLike> = {}): KeyLike => ({ key, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...mods });

describe("i tasti della Tabella", () => {
  it("nel foglio: frecce, bordi, Invio, Tab, carattere", () => {
    expect(sheetIntent(press("ArrowDown", { shiftKey: true }))).toEqual({ kind: "move", rows: 1, columns: 0, extend: true });
    expect(sheetIntent(press("End", { ctrlKey: true }))).toEqual({ kind: "edge", row: "last", column: "last", extend: false });
    expect(sheetIntent(press("Enter"))).toEqual({ kind: "enter", step: 1 });
    expect(sheetIntent(press("F2"))).toEqual({ kind: "edit" });
    expect(sheetIntent(press("ArrowLeft", { ctrlKey: true, shiftKey: true }))).toEqual({ kind: "jump", rows: 0, columns: -1, extend: true });
    expect(sheetIntent(press("Enter", { shiftKey: true }))).toEqual({ kind: "enter", step: -1 });
    expect(sheetIntent(press("Tab", { shiftKey: true }))).toEqual({ kind: "tab", step: -1 });
    expect(sheetIntent(press("é"))).toEqual({ kind: "type", text: "é" });
    expect(sheetIntent(press("F10", { shiftKey: true }))).toEqual({ kind: "menu" });
    expect(sheetIntent(press("b", { metaKey: true }))).toEqual({ kind: "format", which: "bold" });
  });

  it("nel foglio lascia passare gli appunti e i tasti che non sono suoi", () => {
    expect(sheetIntent(press("c", { ctrlKey: true }))).toBeNull();
    expect(sheetIntent(press("v", { ctrlKey: true }))).toBeNull();
    expect(sheetIntent(press("F10"))).toBeNull();
    expect(sheetIntent(press("x", { altKey: true }))).toBeNull();
  });

  it("riga, colonna e tabella intere, riempire, righe e colonne, più intervalli", () => {
    expect(sheetIntent(press(" ", { shiftKey: true }))).toEqual({ kind: "whole", which: "row" });
    expect(sheetIntent(press(" ", { ctrlKey: true }))).toEqual({ kind: "whole", which: "column" });
    expect(sheetIntent(press(" ", { metaKey: true, shiftKey: true }))).toEqual({ kind: "whole", which: "table" });
    expect(sheetIntent(press(" "))).toEqual({ kind: "type", text: " " });
    expect(sheetIntent(press("d", { ctrlKey: true }))).toEqual({ kind: "fill", direction: "down" });
    expect(sheetIntent(press("r", { metaKey: true }))).toEqual({ kind: "fill", direction: "right" });
    // Il tasto fisico vince sulla lettera, come in Excel.
    expect(fillKey(press("ж", { ctrlKey: true, code: "KeyD" }))).toBe("down");
    expect(fillKey(press("d", { ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(sheetIntent(press("+", { ctrlKey: true, code: "BracketRight" }))).toEqual({ kind: "structure", change: "insert" });
    expect(structureKey(press("=", { ctrlKey: true, shiftKey: true, code: "Equal" }))).toBe("insert");
    expect(structureKey(press("", { ctrlKey: true, code: "NumpadSubtract" }))).toBe("delete");
    expect(sheetIntent(press("-", { ctrlKey: true }))).toEqual({ kind: "structure", change: "delete" });
    // Ctrl+Maiusc+«-» non toglie niente: nei fogli è togliere i bordi.
    expect(structureKey(press("_", { ctrlKey: true, shiftKey: true, code: "Minus" }))).toBeNull();
    expect(sheetIntent(press("F8", { shiftKey: true }))).toEqual({ kind: "add-ranges" });
    expect(wholeKey(press(" ", { altKey: true, shiftKey: true }))).toBeNull();
    expect(addRangesKey(press("F8"))).toBe(false);
  });

  it("nella cella aperta le frecce laterali confermano soltanto dopo un carattere", () => {
    expect(editingIntent(press("ArrowLeft"), "replace")).toEqual({ kind: "commit", rows: 0, columns: -1 });
    expect(editingIntent(press("ArrowLeft"), "edit")).toBeNull();
    expect(editingIntent(press("Tab"), "edit")).toEqual({ kind: "commit-tab", step: 1 });
    expect(editingIntent(press("Escape"), "edit")).toEqual({ kind: "cancel" });
  });

  it("nel documento: Tab fra le celle, Maiusc+freccia oltre il testo sceglie celle", () => {
    const inside = { start: false, end: false };
    expect(documentIntent(press("Tab"), inside)).toEqual({ kind: "tab", step: 1 });
    expect(documentIntent(press("ArrowRight", { shiftKey: true }), inside)).toBeNull();
    expect(documentIntent(press("ArrowRight", { shiftKey: true }), { start: false, end: true }))
      .toEqual({ kind: "move", rows: 0, columns: 1, extend: true });
    expect(documentIntent(press("ArrowUp", { shiftKey: true }), { start: true, end: false }))
      .toEqual({ kind: "move", rows: -1, columns: 0, extend: true });
    expect(documentIntent(press("ArrowDown"), { start: true, end: true })).toBeNull();
  });
});
