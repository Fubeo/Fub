// I motori Craft vendorizzati: per ognuno, il repository dell'upstream e i
// percorsi che vengono da lì. Il resto della cartella `vendor/<motore>/`
// (`UPSTREAM.md`, `upstream.lock`, `patches/`, `Cargo.toml` e `Cargo.lock`)
// è di Fub.
//
// La cartella è `vendor/<motore>/`, i crate si chiamano `<motore>-<crate>` sia
// nel `Cargo.toml` di Fub sia in quello della cartella.
//
// `gate` sono le prove di `vendor.mjs <motore> gate` dopo un aggiornamento:
// [etichetta, comando, argomenti…], eseguite dalla radice del repository.

export const MOTORI = {
  wordcraft: {
    nome: "WordCraft",
    repository: "https://github.com/storytold/wordcraft",
    gestiti: [
      "crates/geom",
      "crates/doc",
      "crates/docx",
      "crates/docbin",
      "crates/formats",
      "crates/proof",
      "assets/hyphenation",
      "assets/spelling",
      "LICENSE-MIT",
      "LICENSE-APACHE",
      "NOTICE",
      "rustfmt.toml",
    ],
    gate: [
      ["la copia è l'upstream più le patch", "node", "tools/vendor-craft/vendor.mjs", "wordcraft", "check"],
      ["i test di WordCraft", "cargo", "test", "--manifest-path", "vendor/wordcraft/Cargo.toml", "--workspace", "--locked", "--no-fail-fast"],
      ["l'adattatore dei documenti", "cargo", "test", "-p", "fub-format-rich", "--no-fail-fast"],
      ["il correttore", "cargo", "test", "-p", "fub-features", "--no-fail-fast"],
      ["soltanto gli adattatori nominano il motore", "node", ".github/scripts/check-engine-boundary.mjs"],
      ["licenze e avvisi", "cargo", "deny", "check"],
    ],
  },
  gridcraft: {
    nome: "GridCraft",
    repository: "https://github.com/storytold/gridcraft",
    gestiti: [
      "crates/core",
      "crates/formula",
      "crates/functions",
      "crates/numfmt",
      "crates/model",
      "crates/calc",
      "crates/xlsx",
      "crates/chart",
      "crates/pdf",
      "crates/engine",
      "LICENSE-MIT",
      "LICENSE-APACHE",
      "NOTICE",
      "rustfmt.toml",
    ],
    // `fub-format-xlsx` porta il catalogo servito
    // (`tests/fixtures/catalogo-servito.tsv`), il mirror TypeScript, la
    // conservazione e il corpus (`tests/corpus.rs`, con `FUB_XLSX_CORPUS`
    // anche quello esterno).
    gate: [
      ["la copia è l'upstream più le patch", "node", "tools/vendor-craft/vendor.mjs", "gridcraft", "check"],
      ["i test di GridCraft", "cargo", "test", "--manifest-path", "vendor/gridcraft/Cargo.toml", "--workspace", "--locked", "--no-fail-fast"],
      ["l'adattatore, il catalogo servito, il mirror e il corpus", "cargo", "test", "-p", "fub-format-xlsx", "--no-fail-fast"],
      ["le cartelle nell'host", "cargo", "test", "-p", "fub-host", "--test", "xlsx_workbooks", "--no-fail-fast"],
      ["soltanto gli adattatori nominano il motore", "node", ".github/scripts/check-engine-boundary.mjs"],
      ["i confini delle dipendenze", "cargo", "test", "-p", "fub-abi", "--test", "dependency_invariant"],
      ["licenze e avvisi", "cargo", "deny", "check"],
    ],
  },
};
