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

  it("basta anche una parte del tasto, senza il codice", () => {
    expect(composingKey({ isComposing: false })).toBe(false);
    expect(composingKey({ isComposing: true })).toBe(true);
  });
});

// I sorgenti del client, per la guardia qui sotto.
const sources = import.meta.glob("../**/*.ts", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

/// Le righe che leggono `isComposing` da solo senza un `InputEvent` vicino: un
/// gestore di tasti che WebKit lascerebbe passare. Un uso su `input` o
/// `beforeinput` dice il suo evento sulla riga o nelle tre prima.
function bareComposingReads(): string[] {
  const found: string[] = [];
  for (const [path, text] of Object.entries(sources)) {
    // Le prove e i loro aiuti (`kit/testing.ts`) fanno i tasti, non li leggono.
    if (path.endsWith(".test.ts") || path === "./ime.ts" || path === "./testing.ts") continue;
    const lines = text.split("\n").map((line) => line.replace(/\/\/.*$/, ""));
    lines.forEach((line, at) => {
      if (!/\bisComposing\b/.test(line)) return;
      const around = lines.slice(Math.max(0, at - 3), at + 1).join("\n");
      if (/\bInputEvent\b|"(?:before)?input"/.test(around)) return;
      found.push(`${path}:${at + 1}`);
    });
  }
  return found;
}

describe("la guardia dei tasti", () => {
  it("nessun gestore di tasti legge `isComposing` da solo: usa `composingKey`", () => {
    expect(Object.keys(sources).length).toBeGreaterThan(100);
    expect(bareComposingReads()).toEqual([]);
  });
});
