// I moduli che il server del banco trasforma all'accensione (`server.warmup`).
//
// Gli editor dei formati (la lavagna, il disegno, il documento di Word, il
// foglio, la base, il lettore PDF, il visualizzatore delle foto) arrivano con
// un `import()` alla prima apertura. A server freddo quel primo `import()`
// trasforma uno per uno decine di moduli, e la lavagna anche il suo modulo
// WebAssembly: su una macchina carica la prima scena di quel formato passava
// la sua intera attesa ad aspettarli (#395). Trasformati all'accensione, la
// scena aspetta soltanto l'editor.
//
// L'elenco non si scrive a mano: si legge dal codice, così un editor nuovo
// caricato con un `import()` entra da solo. Sono i bersagli relativi di ogni
// `import("…")` dei file di `src/editors/` (le prove escluse); i tipi
// (`typeof import(…)`) e i pacchetti (`pdfjs-dist`, che Vite prepara già
// fra le dipendenze) restano fuori.

import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";

const DYNAMIC = /(?<!typeof\s)\bimport\(\s*"(\.{1,2}\/[^"]+)"\s*\)/g;
const EXTENSIONS = [".ts", ".tsx", ".js", ".mjs"];

/** I file `.ts` di una cartella, ricorsivamente, prove escluse. */
function sources(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sources(full));
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) found.push(full);
  }
  return found;
}

/** Il file a cui porta un import relativo, o `null` se non c'è. */
function resolveTarget(from, spec) {
  const base = path.resolve(path.dirname(from), spec);
  if (existsSync(base) && statSync(base).isFile()) return base;
  for (const ext of EXTENSIONS) if (existsSync(base + ext)) return base + ext;
  for (const ext of EXTENSIONS) if (existsSync(path.join(base, `index${ext}`))) return path.join(base, `index${ext}`);
  return null;
}

/**
 * I bersagli degli `import()` degli editor, come percorsi `./src/…` relativi
 * a `root` (la cartella del client), ordinati e senza doppioni.
 *
 * @param {string} root
 * @returns {string[]}
 */
export function lazyEditorModules(root) {
  const found = new Set();
  for (const file of sources(path.join(root, "src", "editors"))) {
    const text = readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => !/^\s*\/\//.test(line))
      .join("\n");
    for (const match of text.matchAll(DYNAMIC)) {
      const target = resolveTarget(file, match[1]);
      if (target === null) throw new Error(`${path.relative(root, file)}: import("${match[1]}") non porta a un file`);
      found.add(`./${path.relative(root, target).split(path.sep).join("/")}`);
    }
  }
  return [...found].sort();
}
