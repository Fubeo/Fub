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
// `#[cfg(test)]` in coda a un file.

import fs from "node:fs";
import path from "node:path";

const root = process.argv[2] ?? process.cwd();

/// I crate i cui errori arrivano all'utente, e quanti letterali hanno oggi.
const THRESHOLDS = {
  "fub-app": 90,
  "fub-features": 80,
  "fub-host": 379,
  "fub-kernel": 168,
  "fub-wasm-host": 55,
};

const LITERAL =
  /PluginError::[A-Z]\w*\(\s*(?:format!|"|String::from|Text::from\(\s*(?:format!|"))/g;

function production(file) {
  const text = fs.readFileSync(file, "utf8");
  const tests = text.search(/^#\[cfg\(test\)\]\s*\n\s*mod /m);
  return tests >= 0 ? text.slice(0, tests) : text;
}

function count(crate) {
  const src = path.join(root, "crates", crate, "src");
  let found = 0;
  for (const name of fs.readdirSync(src, { recursive: true })) {
    const file = path.join(src, String(name));
    if (!file.endsWith(".rs") || !fs.statSync(file).isFile()) continue;
    const relative = path.relative(src, file).split(path.sep);
    if (relative.includes("legacy_tests") || relative.includes("tests")) continue;
    if (/^tests?\.rs$/.test(relative.at(-1))) continue;
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
