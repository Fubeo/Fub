// Il codice di Fub nomina i crate dei motori esterni soltanto dai loro
// adattatori (ADR 0213, 0214 e 0239):
//
// - WordCraft da `fub-format-rich` (documenti) e da
//   `fub-features/src/proof.rs` (correttore); i test di `fub-host` lo usano per
//   costruire documenti di prova;
// - GridCraft da `fub-format-xlsx` (cartelle di Excel);
// - VectorCraft da `fub-disegno` (disegni);
// - tutti e tre dalle prove di `tools/motori-prova`, programmi di misura fuori
//   dal workspace che collegano un motore a Fub da solo (K0).
//
// Il guard guarda due cose. I sorgenti, dove un `use wordcraft_…` passerebbe
// da una dipendenza già dichiarata per altro. E i `Cargo.toml` di `crates/`,
// `tools/` ed `esempi/`, dove una riga `vectorcraft-engine = …` porta il motore
// in un crate prima ancora che un sorgente lo usi. `dependency_invariant.rs`
// guarda gli stessi manifest dal grafo di Cargo, ma solo per i membri del
// workspace; qui si vedono anche le prove e gli esempi, che ne stanno fuori.
import fs from "node:fs";
import path from "node:path";

const roots = ["crates", "tools", "esempi"];

/// Una dipendenza da un crate del motore in un `Cargo.toml`, in ogni grafia:
/// `vectorcraft-doc = …`, `vectorcraft-doc.workspace = true`, la tabella
/// `[dependencies.vectorcraft-doc]` e il nome cambiato
/// `doc = { package = "vectorcraft-doc", … }`.
function dependency(engine) {
  return new RegExp(
    `^\\s*(?:\\[[^\\]]*\\.)?${engine}-[a-z0-9-]+\\s*(?:=|\\.|\\])|\\bpackage\\s*=\\s*"${engine}-`,
  );
}
const engines = [
  {
    name: "WordCraft",
    // Un percorso di Rust: `wordcraft_doc::…`, `use wordcraft_docx;`, `extern crate`.
    crate: /\bwordcraft_[a-z]+\s*(?:::|;|\s+as\b)/,
    allowed: [
      /^crates\/fub-format-rich\//,
      /^crates\/fub-features\/src\/proof\.rs$/,
      /^crates\/fub-host\/tests\//,
      /^tools\/motori-prova\//,
    ],
    dependency: dependency("wordcraft"),
    manifests: [
      /^crates\/fub-format-rich\/Cargo\.toml$/,
      /^crates\/fub-features\/Cargo\.toml$/,
      /^crates\/fub-host\/Cargo\.toml$/,
      /^tools\/motori-prova\//,
    ],
    hint: "Passa da fub-format-rich o da fub-features/src/proof.rs (vedi l'ADR 0213).",
  },
  {
    name: "GridCraft",
    crate: /\bgridcraft_[a-z]+\s*(?:::|;|\s+as\b)/,
    allowed: [/^crates\/fub-format-xlsx\//, /^tools\/motori-prova\//],
    dependency: dependency("gridcraft"),
    manifests: [/^crates\/fub-format-xlsx\/Cargo\.toml$/, /^tools\/motori-prova\//],
    hint: "Passa da fub-format-xlsx (vedi l'ADR 0214).",
  },
  {
    name: "VectorCraft",
    // `vectorcraft_engine::…`, ma anche `vectorcraft_three_d`: il nome di un
    // crate di VectorCraft può avere più parti.
    crate: /\bvectorcraft_[a-z0-9_]+\s*(?:::|;|\s+as\b)/,
    allowed: [/^crates\/fub-disegno\//, /^tools\/motori-prova\//],
    dependency: dependency("vectorcraft"),
    manifests: [/^crates\/fub-disegno\/Cargo\.toml$/, /^tools\/motori-prova\//],
    hint: "Passa da fub-disegno (vedi l'ADR 0239).",
  },
];

const bad = new Map(engines.map((engine) => [engine, []]));
for (const root of roots) {
  for (const name of fs.readdirSync(root, { recursive: true })) {
    const file = path.join(root, String(name)).split(path.sep).join("/");
    if (file.includes("/target/") || file.includes("/node_modules/")) continue;
    const source = file.endsWith(".rs");
    const manifest = file.endsWith("/Cargo.toml");
    if (!source && !manifest) continue;
    if (!fs.statSync(file).isFile()) continue;
    const lines = fs.readFileSync(file, "utf8").split("\n");
    for (const engine of engines) {
      const allowed = source ? engine.allowed : engine.manifests;
      if (allowed.some((pattern) => pattern.test(file))) continue;
      const pattern = source ? engine.crate : engine.dependency;
      lines.forEach((line, index) => {
        const code = source ? line.replace(/\/\/.*$/, "") : line.replace(/#.*$/, "");
        if (pattern.test(code)) bad.get(engine).push(`${file}:${index + 1}`);
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
console.log("confine dei motori: soltanto gli adattatori nominano WordCraft, GridCraft e VectorCraft");
