// Le frecce e Ctrl-N/Ctrl-P spostano la scelta; ogni altro accordo no.
import { describe, expect, it } from "vitest";
import { listStep } from "./list-step";

const key = (key: string, mods: Partial<KeyboardEvent> = {}) =>
  ({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods }) as KeyboardEvent;

describe("il passo in un elenco", () => {
  it("frecce, Ctrl-N e Ctrl-P", () => {
    expect(listStep(key("ArrowDown"))).toBe(1);
    expect(listStep(key("ArrowUp"))).toBe(-1);
    expect(listStep(key("n", { ctrlKey: true }))).toBe(1);
    expect(listStep(key("p", { ctrlKey: true }))).toBe(-1);
    expect(listStep(key("N", { ctrlKey: true }))).toBe(1);
  });

  it("una lettera da sola, Cmd o un modificatore in più non spostano", () => {
    expect(listStep(key("n"))).toBe(0);
    expect(listStep(key("n", { metaKey: true }))).toBe(0);
    expect(listStep(key("p", { ctrlKey: true, shiftKey: true }))).toBe(0);
    expect(listStep(key("n", { ctrlKey: true, altKey: true }))).toBe(0);
    expect(listStep(key("k", { ctrlKey: true }))).toBe(0);
  });
});
