import { describe, expect, it } from "vitest";
// Il pacchetto risolto, non un percorso scritto a mano (che si rompe se le
// dipendenze sono sollevate in un'altra cartella, #528). La copia ESM la
// risolve Vite con la condizione `import` di `exports`: è il file che l'app
// impacchetta.
import esm from "@codemirror/view?raw";

/// La copia CommonJS la risolve Node, con la condizione `require`. I test di
/// `src/` non hanno i tipi di Node: i due moduli si prendono da
/// `process.getBuiltinModule`, col tipo di quel poco che serve.
function commonJsSource(): string {
  type Builtins = {
    getBuiltinModule(id: "node:module"): { createRequire(from: string): { resolve(id: string): string } };
    getBuiltinModule(id: "node:fs"): { readFileSync(path: string, encoding: "utf8"): string };
  };
  const node = (globalThis as unknown as { process: Builtins }).process;
  const file = node.getBuiltinModule("node:module").createRequire(import.meta.url).resolve("@codemirror/view");
  if (!file.endsWith(".cjs")) throw new Error(`@codemirror/view non risolve la copia CommonJS: ${file}`);
  return node.getBuiltinModule("node:fs").readFileSync(file, "utf8");
}

// Ciò che l'editor di testo chiede a CodeMirror e che CodeMirror deve dare
// sempre uguale, fissato sulla versione installata.
//
// #399: fino alla 6.43.7 `posAtCoords` (la ricerca della posizione sotto un
// punto, `InlineCoordsScan.scan`) ripartiva da un indice casuale quando i
// rettangoli di una riga non erano in ordine, come accanto agli apici, ai
// pedici e alle marche nascoste della Live. La selezione chiede la posizione
// ai due bordi di una riga a capo: col caso, in quasi una corsa su due i due
// bordi differivano di un carattere e tre lettere si dipingevano come il resto
// della riga più la riga sotto. La 6.43.8 lo corregge a monte («identical
// `posAtCoords` queries could return different results»): la ricerca scorre
// in avanti, senza caso. Misurato nel banco col caso vero (la regola 7 di
// `bench/stage.mjs` lo semina, e lì il difetto non si vedeva): a 800 e 900 px,
// 16 selezioni di tre lettere attorno agli a capo della prima riga di
// `live=riga-attiva`, 40 volte ciascuna, davano due forme in 8 casi su 16 con
// la 6.43.6 e una sola forma in tutti i 640 disegni con la 6.43.8.
//
// Un banco col layout serve a vederlo; qui si tiene la condizione che lo
// toglie, senza un browser: nessun `Math.random` nella vista di CodeMirror che
// l'app impacchetta.
describe("CodeMirror, la vista", () => {
  it("cerca la posizione sotto un punto senza caso (#399)", () => {
    for (const [file, source] of [["index.js", esm], ["index.cjs", commonJsSource()]] as const) {
      expect(source, file).toContain("class InlineCoordsScan");
      expect(source.includes("Math.random"), `Math.random in ${file}`).toBe(false);
    }
  });
});
