// Il codice di Fub nomina i crate di WordCraft soltanto dai due adattatori:
// `fub-format-rich` (documenti) e `fub-features/src/proof.rs` (correttore).
// `dependency_invariant.rs` vede i `Cargo.toml`; questo guard vede i sorgenti,
// dove un `use wordcraft_…` passerebbe da una dipendenza già dichiarata per
// altro. I test di `fub-host` lo usano per costruire documenti di prova.
import fs from "node:fs";
import path from "node:path";

const roots = ["crates", "tools", "esempi"];
const allowed = [
  /^crates\/fub-format-rich\//,
  /^crates\/fub-features\/src\/proof\.rs$/,
  /^crates\/fub-host\/tests\//,
];
// Un percorso di Rust: `wordcraft_doc::…`, `use wordcraft_docx;`, `extern crate`.
const path_of_crate = /\bwordcraft_[a-z]+\s*(?:::|;|\s+as\b)/;

const bad = [];
for (const root of roots) {
  for (const name of fs.readdirSync(root, { recursive: true })) {
    const file = path.join(root, String(name)).split(path.sep).join("/");
    if (!file.endsWith(".rs") || file.includes("/target/")) continue;
    if (allowed.some((pattern) => pattern.test(file))) continue;
    if (!fs.statSync(file).isFile()) continue;
    const lines = fs.readFileSync(file, "utf8").split("\n");
    lines.forEach((line, index) => {
      const code = line.replace(/\/\/.*$/, "");
      if (path_of_crate.test(code)) bad.push(`${file}:${index + 1}`);
    });
  }
}

if (bad.length) {
  console.error(
    `WordCraft nominato fuori dagli adattatori: ${bad.join(", ")}\n` +
      "Passa da fub-format-rich o da fub-features/src/proof.rs (vedi l'ADR 0213).",
  );
  process.exit(1);
}
console.log("confine WordCraft: soltanto gli adattatori nominano il motore");
