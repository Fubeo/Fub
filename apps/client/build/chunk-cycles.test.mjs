// I cicli statici fra chunk (`chunk-cycles.mjs`): il plugin
// `bundle-size-budgets` di `vite.config.ts` ferma la build a ogni ciclo
// nuovo; qui la ricerca su grafi finti.
import { describe, expect, it } from "vitest";
import { chunkCycles, KNOWN_CYCLES, newChunkCycles } from "./chunk-cycles.mjs";

const graph = (edges) => new Map(Object.entries(edges));

describe("i cicli fra chunk", () => {
  it("nessun ciclo in un albero di import", () => {
    expect(chunkCycles(graph({ main: ["search", "shell"], search: ["shell"], shell: [] }))).toEqual([]);
  });

  it("trova il ciclo fra le Impostazioni e search, coi nomi", () => {
    const imports = graph({
      "main-a.js": ["search-b.js"],
      "search-b.js": ["settings-panel-c.js", "shell-d.js"],
      "settings-panel-c.js": ["search-b.js"],
      "shell-d.js": [],
    });
    const nameOf = (file) => file.replace(/-[a-z]\.js$/, "");
    expect(chunkCycles(imports, nameOf)).toEqual([["search", "settings-panel"]]);
  });

  it("un ciclo lungo è un gruppo solo", () => {
    expect(chunkCycles(graph({ a: ["b"], b: ["c"], c: ["a"], d: ["a"] }))).toEqual([["a", "b", "c"]]);
  });

  it("ignora i file che non sono chunk", () => {
    expect(chunkCycles(graph({ a: ["style.css"] }))).toEqual([]);
  });

  it("lascia passare i cicli noti e ferma gli altri", () => {
    const cycles = [["drawing-commands", "styles"], ["search", "settings-panel"]];
    expect(newChunkCycles(cycles)).toEqual([["search", "settings-panel"]]);
    expect(KNOWN_CYCLES.every((group) => group.join() === [...group].sort().join())).toBe(true);
  });
});
