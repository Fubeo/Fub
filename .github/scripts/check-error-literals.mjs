#!/usr/bin/env node
// Gli errori letterali non crescono.
//
// Un `PluginError` porta un `Text` perché chi lo mostra lo possa dire nella
// lingua di chi guarda: una chiave del catalogo (`Text::key`, `Text::message`)
// la risolve il percorso del comando o della view, o `Host::localized_error`
// per un comando IPC. Un letterale invece arriva così com'è, in italiano a chi
// legge in inglese e viceversa. Sono centinaia, e convertirli è un lavoro per
// area; ciò che questo guard impedisce è che il conto salga mentre si fa.
//
// È un cricchetto: un crate sopra la soglia fallisce, e anche uno sotto, perché
// la soglia va abbassata nello stesso cambio che converte. Si contano i
// sorgenti di produzione: niente `tests/`, `legacy_tests/`, né il modulo
// `#[cfg(test)]` in coda a un file, né il file che un `#[cfg(test)] mod x;`
// porta a parte (`x.rs` accanto a `lib.rs`/`mod.rs`, o in `padre/x.rs`):
// quel file è tutto test, come il modulo in coda di cui prende il posto.

import fs from "node:fs";
import path from "node:path";

const root = process.argv[2] ?? process.cwd();

/// I crate i cui errori arrivano all'utente, e quanti letterali hanno oggi.
const THRESHOLDS = {
  "fub-app": 85,
  "fub-features": 77,
  "fub-host": 374,
  "fub-kernel": 162,
  "fub-wasm-host": 39,
};

const LITERAL =
  /PluginError::[A-Z]\w*\(\s*(?:format!|"|String::from|Text::from\(\s*(?:format!|"))/g;

function production(file) {
  const text = fs.readFileSync(file, "utf8");
  const tests = text.search(/^#\[cfg\(test\)\]\s*\n\s*mod \w+\s*\{/m);
  return tests >= 0 ? text.slice(0, tests) : text;
}

/// I file che un `#[cfg(test)] mod x;` dichiara: sono moduli di prova interi.
function testFiles(files) {
  const out = new Set();
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    const base = path.basename(file, ".rs");
    const dir = ["lib", "main", "mod"].includes(base)
      ? path.dirname(file)
      : path.join(path.dirname(file), base);
    for (const m of text.matchAll(/^#\[cfg\(test\)\]\s*\n\s*mod (\w+);/gm)) {
      out.add(path.join(dir, `${m[1]}.rs`));
    }
  }
  return out;
}

function count(crate) {
  const src = path.join(root, "crates", crate, "src");
  const files = fs
    .readdirSync(src, { recursive: true })
    .map((name) => path.join(src, String(name)))
    .filter((file) => file.endsWith(".rs") && fs.statSync(file).isFile());
  const tests = testFiles(files);
  let found = 0;
  for (const file of files) {
    const relative = path.relative(src, file).split(path.sep);
    if (relative.includes("legacy_tests") || relative.includes("tests")) continue;
    if (/^tests?\.rs$/.test(relative.at(-1)) || tests.has(file)) continue;
    found += (production(file).match(LITERAL) ?? []).length;
  }
  return found;
}

const errors = [];
for (const [crate, threshold] of Object.entries(THRESHOLDS)) {
  const found = count(crate);
  if (found > threshold) {
    errors.push(
      `${crate}: ${found} errori letterali, la soglia è ${threshold}. ` +
        "Un errore per l'utente usa una chiave del catalogo (Text::key/Text::message).",
    );
  } else if (found < threshold) {
    errors.push(
      `${crate}: ${found} errori letterali, sotto la soglia di ${threshold}: ` +
        `abbassala a ${found} in .github/scripts/check-error-literals.mjs.`,
    );
  }
}

if (errors.length) {
  console.error("Errori letterali fuori soglia:\n");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log("errori letterali: nessun crate sopra la propria soglia");
