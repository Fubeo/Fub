// **Quali file Markdown sono documentazione**, per le guardie che li leggono.
//
// `check-doc-links`, `check-doc-orphans`, `check-doc-size`, `check-prose`,
// `check-markdown-style` e `check-tables` scorrevano `docs/` ciascuno con la sua
// copia della stessa funzione, che entrava in ogni cartella. Ma `docs/` è anche
// un vault aperto con Fub, e Fub scrive in `docs/.fub/` (ignorata da git) i suoi
// dati: un `.md` che un vault locale lascia lì dentro veniva letto come un
// documento, e la guardia falliva, o passava, per un file che nella
// repository non c'è (audit del 20/11, P-35).
//
// Qui una funzione sola, che salta ogni cartella nascosta: nessun documento
// vive in una cartella col punto, e `.fub/` è la radice dei dati di un vault
// (decisione 0048). L'autoprova (`--self-test`) la gira anche
// `check-prose.mjs --self-test`, che CI e `scripts/check.sh` già eseguono.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** I file `.md` sotto `dir`, senza entrare nelle cartelle nascoste. */
export function markdownUnder(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name.startsWith(".") ? [] : markdownUnder(full);
    return entry.isFile() && entry.name.endsWith(".md") ? [full] : [];
  });
}

/** Autoprova: lancia se `markdownUnder` legge un file che non è documentazione. */
export function selfTestDocFiles() {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "fub-doc-files-"));
  try {
    const files = {
      "a.md": "# a",
      "sotto/b.md": "# b",
      "sotto/note.txt": "non è Markdown",
      ".fub/data/c.md": "# lasciato da un vault locale",
      "sotto/.nascosta/d.md": "# nemmeno qui",
    };
    for (const [name, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(scratch, name)), { recursive: true });
      fs.writeFileSync(path.join(scratch, name), text);
    }
    const found = markdownUnder(scratch)
      .map((file) => path.relative(scratch, file).split(path.sep).join("/"))
      .sort();
    const expected = ["a.md", "sotto/b.md"];
    if (JSON.stringify(found) !== JSON.stringify(expected)) {
      throw new Error(`markdownUnder: atteso ${JSON.stringify(expected)}, trovato ${JSON.stringify(found)}`);
    }
    if (markdownUnder(path.join(scratch, "manca")).length !== 0) {
      throw new Error("markdownUnder: una cartella che non c'è deve dare un elenco vuoto");
    }
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv.includes("--self-test")) {
    console.error("uso: node .github/scripts/doc-files.mjs --self-test");
    process.exit(2);
  }
  try {
    selfTestDocFiles();
  } catch (error) {
    console.error(`Autoprova di doc-files fallita: ${error.message}`);
    process.exit(1);
  }
  console.log("Autoprova di doc-files riuscita.");
}
