// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { currencyFormat, shortcutCommand, shortcutDialog, type ShortcutContext } from "./shortcuts";

const CELL: ShortcutContext = { wholeRows: false, wholeColumns: false, currency: currencyFormat("it-IT") };

function key(code: string, init: KeyboardEventInit = {}): KeyboardEvent {
  return new KeyboardEvent("keydown", { code, ...init });
}

describe("scorciatoie di Excel", () => {
  it("leggono il tasto fisico, con Ctrl o con Cmd", () => {
    expect(shortcutCommand(key("KeyB", { key: "b", ctrlKey: true }), CELL)).toEqual({ id: "home.bold", params: "{}" });
    expect(shortcutCommand(key("Digit2", { key: "2", metaKey: true }), CELL)).toEqual({ id: "home.bold", params: "{}" });
    // Su una tastiera italiana Maiusc+5 scrive «%»: conta il tasto.
    expect(shortcutCommand(key("Digit5", { key: "%", ctrlKey: true, shiftKey: true }), CELL)).toEqual({ id: "home.percent", params: "{}" });
    expect(shortcutCommand(key("KeyB", { key: "b" }), CELL)).toBeNull();
    expect(shortcutCommand(key("KeyB", { key: "b", ctrlKey: true, altKey: true }), CELL)).toBeNull();
  });

  it("danno i formati di numero di Excel e la valuta della lingua", () => {
    const format = (code: string) => JSON.parse(shortcutCommand(key(code, { ctrlKey: true, shiftKey: true }), CELL)!.params) as unknown;
    expect(format("Backquote")).toEqual({ format: "General" });
    expect(format("Digit1")).toEqual({ code: "#,##0.00" });
    expect(format("Digit3")).toEqual({ code: "d-mmm-yy" });
    expect(format("Digit4")).toEqual({ code: '#,##0.00 "€"' });
    expect(currencyFormat("en-US")).toBe('"$"#,##0.00');
    expect(shortcutCommand(key("Digit7", { ctrlKey: true, shiftKey: true }), CELL))
      .toEqual({ id: "home.borders", params: JSON.stringify({ preset: "outside" }) });
  });

  it("Alt+= è la somma automatica", () => {
    expect(shortcutCommand(key("Equal", { altKey: true }), CELL)).toEqual({ id: "formulas.autoSum", params: "{}" });
    expect(shortcutCommand(key("Equal", { altKey: true, shiftKey: true }), CELL)).toBeNull();
  });

  it("Ctrl+«+» e Ctrl+«-» inseriscono e tolgono soltanto righe o colonne intere", () => {
    const plus = key("Equal", { ctrlKey: true, shiftKey: true });
    const minus = key("Minus", { ctrlKey: true });
    expect(shortcutCommand(plus, CELL)).toBeNull();
    expect(shortcutCommand(minus, CELL)).toBeNull();
    expect(shortcutCommand(plus, { ...CELL, wholeRows: true })?.id).toBe("home.insertRows");
    expect(shortcutCommand(minus, { ...CELL, wholeRows: true })?.id).toBe("home.deleteRows");
    expect(shortcutCommand(key("NumpadAdd", { ctrlKey: true }), { ...CELL, wholeColumns: true })?.id).toBe("home.insertColumns");
    expect(shortcutCommand(key("NumpadSubtract", { ctrlKey: true }), { ...CELL, wholeColumns: true })?.id).toBe("home.deleteColumns");
    // Ctrl+Maiusc+«-» è togliere i bordi, non le righe.
    expect(shortcutCommand(key("Minus", { ctrlKey: true, shiftKey: true }), { ...CELL, wholeRows: true }))
      .toEqual({ id: "home.borders", params: JSON.stringify({ preset: "none" }) });
  });

  it("le scorciatoie delle finestre di Excel chiedono la loro finestra", () => {
    const asked = (code: string, init: KeyboardEventInit = {}) => shortcutDialog(key(code, init), CELL);
    expect(asked("Digit1", { ctrlKey: true })).toEqual({ dialog: "formatCells", params: "{}" });
    expect(asked("KeyF", { ctrlKey: true, shiftKey: true })).toEqual({ dialog: "formatCells", params: JSON.stringify({ tab: "font" }) });
    expect(asked("KeyH", { metaKey: true })).toEqual({ dialog: "find", params: JSON.stringify({ replace: true }) });
    expect(asked("F5")).toEqual({ dialog: "goTo", params: "{}" });
    expect(asked("F3", { shiftKey: true })).toEqual({ dialog: "insertFunction", params: "{}" });
    expect(asked("F2")).toBeNull();
    expect(asked("KeyB", { ctrlKey: true })).toBeNull();
    expect(asked("Digit1", { ctrlKey: true, altKey: true })).toBeNull();
  });

  it("Ctrl+«+» e Ctrl+«-» su un intervallo chiedono come spostare le celle", () => {
    expect(shortcutDialog(key("Equal", { ctrlKey: true, shiftKey: true }), CELL)).toEqual({ dialog: "insertCells", params: "{}" });
    expect(shortcutDialog(key("Minus", { ctrlKey: true }), CELL)).toEqual({ dialog: "deleteCells", params: "{}" });
    expect(shortcutDialog(key("Minus", { ctrlKey: true }), { ...CELL, wholeRows: true })).toBeNull();
  });
});
