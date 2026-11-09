// I motori Craft vendorizzati: per ognuno, il repository dell'upstream e i
// percorsi che vengono da lì. Il resto della cartella `vendor/<motore>/`
// (`UPSTREAM.md`, `upstream.lock`, `patches/`, `Cargo.toml` e `Cargo.lock`)
// è di Fub.
//
// La cartella è `vendor/<motore>/`, i crate si chiamano `<motore>-<crate>` sia
// nel `Cargo.toml` di Fub sia in quello della cartella.
//
// `mirror` è la copia di Fub dell'upstream (`Fubeo/<motore>`): `update` lo
// scrive nel primo `upstream.lock`, e `verify-upstream` prova la revisione anche
// lì. Deve dire ciò che il lock dice già (`vendor.mjs self-test`).
//
// `gate` sono le prove di `vendor.mjs <motore> gate` dopo un aggiornamento:
// [etichetta, comando, argomenti…], eseguite dalla radice del repository.
//
// `osservati` sono file dell'upstream che Fub non copia ma rispecchia a mano
// nella shell: [percorso, che cosa li rispecchia]. `report` dice quando
// cambiano, perché chi aggiorna li rilegga.

export const MOTORI = {
  wordcraft: {
    nome: "WordCraft",
    repository: "https://github.com/storytold/wordcraft",
    mirror: "https://github.com/Fubeo/wordcraft",
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
    osservati: [
      ["crates/engine/src/ribbon.rs", "la striscia dei documenti, editors/rich/strip.ts"],
      ["crates/ui-egui/src/ribbon.rs", "la striscia dei documenti, editors/rich/strip.ts"],
      ["crates/ui-egui/src/mini_toolbar.rs", "la mini-barra dei documenti"],
    ],
  },
  gridcraft: {
    nome: "GridCraft",
    repository: "https://github.com/storytold/gridcraft",
    mirror: "https://github.com/Fubeo/gridcraft",
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
    osservati: [
      ["crates/ui-egui/src/ribbon.rs", "la barra dei fogli, editors/grid/ribbon/tabs.ts"],
      ["crates/ui-egui/src/dialogs.rs", "le finestre dei fogli, editors/grid/dialogs/"],
    ],
  },
  // Il motore del disegno. Fuori: l'interfaccia (`ui-egui`), il server MCP
  // (`mcp`), le app e `xtask` (tranne due file che i test includono); e il PDF
  // con l'EPS (`pdf`, `eps`), che vogliono `craft-pdf` di craft-libs: la patch
  // 0002 li toglie dal grafo di `engine`.
  vectorcraft: {
    nome: "VectorCraft",
    repository: "https://github.com/storytold/vectorcraft",
    mirror: "https://github.com/Fubeo/vectorcraft",
    gestiti: [
      "crates/geom",
      "crates/color",
      "crates/doc",
      "crates/pathops",
      "crates/brush",
      "crates/trace",
      "crates/text",
      "crates/effects",
      "crates/plugins",
      "crates/three-d",
      "crates/render",
      "crates/svg",
      "crates/format",
      "crates/cad",
      "crates/metafile",
      "crates/affinity",
      "crates/scriptcheck",
      "crates/tools",
      "crates/engine",
      "crates/testkit",
      // I due file di `xtask` che i test di `affinity` ed `engine` includono
      // (la SHA-256 del corpus e il suo elenco); `xtask` non si copia né gira.
      "xtask/src/sha256.rs",
      "xtask/affinity-corpus.sha256",
      "assets/fonts",
      "LICENSE-MIT",
      "LICENSE-APACHE",
      "NOTICE",
      "ASSETS.md",
      // Lo stile dell'upstream: `cargo fmt --all` di Fub segue le dipendenze a
      // percorso e formatta i crate copiati con il `rustfmt.toml` più vicino.
      "rustfmt.toml",
    ],
    gate: [
      ["la copia è l'upstream più le patch", "node", "tools/vendor-craft/vendor.mjs", "vectorcraft", "check"],
      ["i test di VectorCraft", "cargo", "test", "--manifest-path", "vendor/vectorcraft/Cargo.toml", "--workspace", "--locked", "--no-fail-fast"],
      ["l'adattatore del disegno", "cargo", "test", "-p", "fub-disegno", "--no-fail-fast"],
      ["soltanto gli adattatori nominano il motore", "node", ".github/scripts/check-engine-boundary.mjs"],
      ["licenze e avvisi", "cargo", "deny", "check"],
    ],
  },
  // Due librerie di craft-libs che VectorCraft usa, ognuna alla sua revisione
  // e nella sua cartella: `vendor/vectorcraft/Cargo.toml` le prende per
  // percorso.
  "craft-docpath": {
    nome: "craft-docpath",
    repository: "https://github.com/storytold/craft-libs",
    mirror: "https://github.com/Fubeo/craft-libs",
    gestiti: ["crates/docpath", "LICENSE-MIT", "LICENSE-APACHE", "NOTICE", "rustfmt.toml"],
    gate: [["la copia è l'upstream più le patch", "node", "tools/vendor-craft/vendor.mjs", "craft-docpath", "check"]],
  },
  "craft-vectorcraft-format": {
    nome: "craft-vectorcraft-format",
    repository: "https://github.com/storytold/craft-libs",
    mirror: "https://github.com/Fubeo/craft-libs",
    gestiti: ["crates/vectorcraft-format", "LICENSE-MIT", "LICENSE-APACHE", "NOTICE", "rustfmt.toml"],
    gate: [["la copia è l'upstream più le patch", "node", "tools/vendor-craft/vendor.mjs", "craft-vectorcraft-format", "check"]],
  },
};
