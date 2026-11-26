// I metodi a pacchetti dei due motori (`mix-methods.ts`): si comportano come
// metodi di classe, e i membri interni `_nome` dei motori restano nei file dei
// motori.
import { describe, expect, it } from "vitest";
import { mixMethods } from "./mix-methods";

/// I sorgenti del client, prove comprese.
const SOURCES = import.meta.glob(["/src/**/*.ts", "/bench/**/*.ts"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/// I file che possono usare i membri interni: quelli dei motori, non le prove.
const ENGINE_FILE = /^\/src\/editors\/(canvas|grid)\/engine[^/]*\.ts$/;
const isEngineFile = (path: string) => ENGINE_FILE.test(path) && !path.endsWith(".test.ts");

/// I membri `_nome` dichiarati nei file dei motori: campi, metodi, accessori.
function internalNames(): Set<string> {
  const names = new Set<string>();
  for (const [path, text] of Object.entries(SOURCES)) {
    if (!isEngineFile(path)) continue;
    for (const match of text.matchAll(/^\s+(?:(?:static|readonly|get|set|async|declare)\s+)*(_[A-Za-z]\w*)\s*[(:=<?!;]/gm)) {
      names.add(match[1]!);
    }
  }
  return names;
}

describe("mixMethods", () => {
  class Box {
    size = 2;
    double(): number {
      return this.size * 2;
    }
  }
  const extra = {
    triple(this: Box): number {
      return this.size * 3;
    },
  };

  it("mette i metodi sul prototipo, legati all'istanza e non enumerabili", () => {
    class Local extends Box {}
    mixMethods(Local.prototype, extra);
    const box = new Local() as Local & typeof extra;
    box.size = 5;
    expect(box.triple()).toBe(15);
    expect(Object.keys(box)).toEqual(["size"]);
    expect(Object.getOwnPropertyDescriptor(Local.prototype, "triple")).toMatchObject({ enumerable: false, writable: true, configurable: true });
    expect((new Local() as Local & typeof extra).triple).toBe(box.triple);
  });

  it("rifiuta un nome che il prototipo ha già", () => {
    class Local extends Box {}
    mixMethods(Local.prototype, extra);
    expect(() => mixMethods(Local.prototype, extra)).toThrow(/triple/);
    expect(() => mixMethods(Box.prototype, { double() { return 0; } })).toThrow(/double/);
  });

  it("rifiuta ciò che non è un metodo", () => {
    class Local {}
    expect(() => mixMethods(Local.prototype, { size: 3 })).toThrow(/size/);
  });
});

describe("i membri interni dei motori", () => {
  it("si leggono soltanto nei file dei motori", () => {
    const names = internalNames();
    expect(names.size, "i membri interni dei motori").toBeGreaterThan(100);
    const outside: string[] = [];
    for (const [path, text] of Object.entries(SOURCES)) {
      if (isEngineFile(path)) continue;
      for (const match of text.matchAll(/\._([A-Za-z]\w*)\b/g)) {
        if (names.has(`_${match[1]}`)) outside.push(`${path}: _${match[1]}`);
      }
    }
    expect([...new Set(outside)]).toEqual([]);
  });
});
