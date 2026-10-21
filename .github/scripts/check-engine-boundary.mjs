// Il codice di Fub nomina i crate dei motori esterni soltanto dai loro
// adattatori (ADR 0213 e 0214):
//
// - WordCraft da `fub-format-rich` (documenti) e da
//   `fub-features/src/proof.rs` (correttore); i test di `fub-host` lo usano per
//   costruire documenti di prova;
// - GridCraft da `fub-format-xlsx` (cartelle di Excel).
//
// `dependency_invariant.rs` vede i `Cargo.toml`; questo guard vede i sorgenti,
// dove un `use wordcraft_…` passerebbe da una dipendenza già dichiarata per
// altro.
import fs from "node:fs";
import path from "node:path";

const roots = ["crates", "tools", "esempi"];
const engines = [
  {
    name: "WordCraft",
    // Un percorso di Rust: `wordcraft_doc::…`, `use wordcraft_docx;`, `extern crate`.
    crate: /\bwordcraft_[a-z]+\s*(?:::|;|\s+as\b)/,
    allowed: [
      /^crates\/fub-format-rich\//,
      /^crates\/fub-features\/src\/proof\.rs$/,
      /^crates\/fub-host\/tests\//,
    ],
    hint: "Passa da fub-format-rich o da fub-features/src/proof.rs (vedi l'ADR 0213).",
  },
  {
    name: "GridCraft",
    crate: /\bgridcraft_[a-z]+\s*(?:::|;|\s+as\b)/,
    allowed: [/^crates\/fub-format-xlsx\//],
    hint: "Passa da fub-format-xlsx (vedi l'ADR 0214).",
  },
];

const bad = new Map(engines.map((engine) => [engine, []]));
for (const root of roots) {
  for (const name of fs.readdirSync(root, { recursive: true })) {
    const file = path.join(root, String(name)).split(path.sep).join("/");
    if (!file.endsWith(".rs") || file.includes("/target/")) continue;
    if (!fs.statSync(file).isFile()) continue;
    const lines = fs.readFileSync(file, "utf8").split("\n");
    for (const engine of engines) {
      if (engine.allowed.some((pattern) => pattern.test(file))) continue;
      lines.forEach((line, index) => {
        const code = line.replace(/\/\/.*$/, "");
        if (engine.crate.test(code)) bad.get(engine).push(`${file}:${index + 1}`);
      });
    }
  }
}

let failed = false;
for (const [engine, places] of bad) {
  if (!places.length) continue;
  failed = true;
  console.error(`${engine.name} nominato fuori dagli adattatori: ${places.join(", ")}\n${engine.hint}`);
}
if (failed) process.exit(1);
console.log("confine dei motori: soltanto gli adattatori nominano WordCraft e GridCraft");
