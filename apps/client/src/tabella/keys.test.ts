import { describe, expect, it } from "vitest";
import { documentIntent, editingIntent, sheetIntent, type KeyLike } from "./keys";

const press = (key: string, mods: Partial<KeyLike> = {}): KeyLike => ({ key, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...mods });

describe("i tasti della Tabella", () => {
  it("nel foglio: frecce, bordi, Invio, Tab, carattere", () => {
    expect(sheetIntent(press("ArrowDown", { shiftKey: true }))).toEqual({ kind: "move", rows: 1, columns: 0, extend: true });
    expect(sheetIntent(press("End", { ctrlKey: true }))).toEqual({ kind: "edge", row: "last", column: "last", extend: false });
    expect(sheetIntent(press("Enter"))).toEqual({ kind: "edit" });
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
