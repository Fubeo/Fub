// I chunk del Disegno completo e i loro confini (`completo-chunks.mjs`): la
// regola di `manualChunks`, gli import vietati e i moduli fuori posto. La
// build li controlla davvero a ogni `npm run build` (il plugin
// `completo-confini` di `vite.config.ts`); qui le regole su grafi finti.
import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { completoChunk, completoChunkProblems, completoImportProblems, completoPreload, familyOf } from "./completo-chunks.mjs";

const ROOT = "/repo/apps/client/src";
const C = `${ROOT}/editors/spatial/completo`;
const FAMILIES = readdirSync(new URL("../src/editors/spatial/completo/famiglie/", import.meta.url), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

const mod = (id, importedIds = [], dynamicallyImportedIds = []) => ({ id, importedIds, dynamicallyImportedIds });

describe("la regola dei chunk", () => {
  it("l'ingresso, l'indice e una famiglia per chunk", () => {
    expect(completoChunk(`${C}/index.ts`)).toBe("drawing-completo");
    expect(completoChunk(`${C}/carica.ts`)).toBe("drawing-completo");
    expect(completoChunk(`${C}/indice.ts`)).toBe("drawing-indice");
    expect(completoChunk(`${C}/indice.generated.json`)).toBe("drawing-indice");
    expect(completoChunk(`${C}/indice.generated.json?import`)).toBe("drawing-indice");
    expect(completoChunk(`${C}/famiglie/nucleo/index.ts`)).toBe("drawing-fam-nucleo");
    expect(completoChunk(`${C}/famiglie/tre-d/testi.ts`)).toBe("drawing-fam-tre-d");
    expect(completoChunk(`${ROOT}/editors/spatial/motore/gesti.ts`)).toBeUndefined();
    expect(familyOf(`${C}/famiglie/testo/index.ts`)).toBe("testo");
    expect(familyOf(`${C}/carica.ts`)).toBeNull();
  });

  it("ci sono le 26 famiglie, e ogni nome di chunk comincia con drawing-", () => {
    expect(FAMILIES).toHaveLength(26);
    for (const family of FAMILIES) expect(completoChunk(`${C}/famiglie/${family}/index.ts`)).toMatch(/^drawing-fam-[a-z0-9-]+$/);
  });
});

describe("i confini degli import", () => {
  it("il grafo com'è oggi passa", () => {
    const families = FAMILIES.map((f) => mod(`${C}/famiglie/${f}/index.ts`, [`${C}/famiglie/${f}/testi.ts`]));
    const problems = completoImportProblems([
      mod(`${ROOT}/editors/spatial/tools/editor/chrome/workspace.ts`, [`${ROOT}/state/components.ts`], [`${C}/index.ts`]),
      mod(`${C}/index.ts`, [`${C}/carica.ts`], [`${C}/indice.ts`]),
      mod(`${C}/indice.ts`, [], [`${C}/indice.generated.json`]),
      mod(`${C}/carica.ts`, [`${ROOT}/host/contract.ts`], FAMILIES.map((f) => `${C}/famiglie/${f}/index.ts`)),
      ...families,
    ]);
    expect(problems).toEqual([]);
  });

  it("un import statico da fuori cade, anche dell'ingresso", () => {
    const problems = completoImportProblems([mod(`${ROOT}/main.ts`, [`${C}/index.ts`])]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/main\.ts importa staticamente .*completo\/index\.ts/);
  });

  it("un import() da fuori di un file che non è l'ingresso cade", () => {
    expect(completoImportProblems([mod(`${ROOT}/main.ts`, [], [`${C}/indice.ts`])])).toHaveLength(1);
    expect(completoImportProblems([mod(`${ROOT}/main.ts`, [], [`${C}/famiglie/nucleo/index.ts`])])).toHaveLength(1);
  });

  it("una famiglia che importa un'altra famiglia cade, statico o con import()", () => {
    const statico = completoImportProblems([mod(`${C}/famiglie/testo/index.ts`, [`${C}/famiglie/nucleo/testi.ts`])]);
    expect(statico).toHaveLength(1);
    expect(statico[0]).toMatch(/testo → nucleo/);
    expect(completoImportProblems([mod(`${C}/famiglie/testo/index.ts`, [], [`${C}/famiglie/nucleo/index.ts`])])).toHaveLength(1);
    // I suoi file e il resto del Completo, sì.
    expect(completoImportProblems([mod(`${C}/famiglie/testo/index.ts`, [`${C}/famiglie/testo/testi.ts`, `${C}/carica.ts`])])).toEqual([]);
  });

  it("il resto del Completo porta una famiglia solo con import()", () => {
    expect(completoImportProblems([mod(`${C}/index.ts`, [`${C}/famiglie/nucleo/index.ts`])])).toHaveLength(1);
  });
});

describe("i moduli nei loro chunk", () => {
  const chunks = () => [
    { name: "drawing-completo", modules: [`${C}/index.ts`, `${C}/carica.ts`] },
    { name: "drawing-indice", modules: [`${C}/indice.ts`, `${C}/indice.generated.json`] },
    ...FAMILIES.map((f) => ({ name: `drawing-fam-${f}`, modules: [`${C}/famiglie/${f}/index.ts`, `${C}/famiglie/${f}/testi.ts`] })),
    { name: "index", modules: [`${ROOT}/main.ts`] },
  ];

  it("al loro posto passano", () => {
    expect(completoChunkProblems(chunks(), FAMILIES)).toEqual([]);
  });

  it("un modulo in un altro chunk, o un chunk che manca, cadono", () => {
    const fuori = chunks();
    fuori[fuori.length - 1].modules.push(`${C}/carica.ts`);
    expect(completoChunkProblems(fuori, FAMILIES)).toEqual([`${C}/carica.ts è nel chunk index, non in drawing-completo`]);
    const senza = chunks().filter((chunk) => chunk.name !== "drawing-fam-nucleo");
    expect(completoChunkProblems(senza, FAMILIES)).toEqual(["manca il chunk drawing-fam-nucleo"]);
  });
});

describe("il precaricamento delle famiglie", () => {
  it("una famiglia senza dipendenze precarica sé stessa; il resto resta com'è", () => {
    expect(completoPreload("assets/drawing-fam-nucleo-Ckrf_L1F.js", [])).toEqual(["assets/drawing-fam-nucleo-Ckrf_L1F.js"]);
    expect(completoPreload("assets/drawing-fam-tre-d-Ckrf_L1F.js", [])).toEqual(["assets/drawing-fam-tre-d-Ckrf_L1F.js"]);
    const deps = ["assets/drawing-fam-testo-AbCdEf12.js", "assets/kit-controls-ZyXwVu98.js"];
    expect(completoPreload("assets/drawing-fam-testo-AbCdEf12.js", deps)).toBe(deps);
    expect(completoPreload("assets/drawing-completo-WO3KQEvi.js", [])).toEqual([]);
    expect(completoPreload("assets/editors-canvas-Bx3kQ9aZ.js", [])).toEqual([]);
  });
});
