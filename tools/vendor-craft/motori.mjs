// I motori Craft vendorizzati: per ognuno, il repository dell'upstream e i
// percorsi che vengono da lì. Il resto della cartella `vendor/<motore>/`
// (`UPSTREAM.md`, `upstream.lock`, `patches/`, `Cargo.toml` e `Cargo.lock`)
// è di Fub.
//
// La cartella è `vendor/<motore>/`, i crate si chiamano `<motore>-<crate>` sia
// nel `Cargo.toml` di Fub sia in quello della cartella.

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
  },
};
