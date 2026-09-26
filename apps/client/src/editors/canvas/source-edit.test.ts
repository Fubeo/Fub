import { describe, expect, it } from "vitest";
import { canvasNodeAt } from "./source-edit";

describe("canvasNodeAt", () => {
  it("trova la carta il cui oggetto sorgente contiene l'offset", () => {
    const source = '{"edges":[],"nodes":[{"id":"a"},\n  {"id":"b","text":"x"}],"extra":1}';
    const first = source.indexOf('{"id":"a"}');
    const second = source.indexOf('{"id":"b"');
    expect(canvasNodeAt(source, first)).toBe(0);
    expect(canvasNodeAt(source, first + '{"id":"a"}'.length - 1)).toBe(0);
    // La virgola e lo spazio fra due carte non sono di nessuna.
    expect(canvasNodeAt(source, first + '{"id":"a"}'.length)).toBeNull();
    expect(canvasNodeAt(source, second + 5)).toBe(1);
    expect(canvasNodeAt(source, source.indexOf('"extra"'))).toBeNull();
  });

  it("non inventa una carta in una sorgente senza nodi o illeggibile", () => {
    expect(canvasNodeAt('{"edges":[]}', 3)).toBeNull();
    expect(canvasNodeAt('{"nodes":[', 9)).toBeNull();
  });
});
