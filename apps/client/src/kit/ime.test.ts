// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { composingKey } from "./ime";

describe("composingKey", () => {
  it("riconosce la composizione di Chromium e Firefox", () => {
    expect(composingKey(new KeyboardEvent("keydown", { key: "Enter", isComposing: true }))).toBe(true);
  });

  it("riconosce il tasto che WebKit dà dopo aver chiuso la composizione", () => {
    expect(composingKey(new KeyboardEvent("keydown", { key: "Enter", keyCode: 229 }))).toBe(true);
  });

  it("lascia al campo l'Invio vero", () => {
    expect(composingKey(new KeyboardEvent("keydown", { key: "Enter", keyCode: 13 }))).toBe(false);
    expect(composingKey(new KeyboardEvent("keydown", { key: "Escape" }))).toBe(false);
  });
});
