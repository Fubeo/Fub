#!/usr/bin/env node
// I link relativi dei documenti puntano a file e titoli che esistono nella
// repository. Le cartelle nascoste non sono documenti (`markdownUnder`), e
// `.fub/` (i dati di un vault locale, ignorati da git) non è nemmeno un
// target: un file lì dentro c'è solo su una macchina (P-35, #509). Fanno
// eccezione i `.fub` che git traccia, i vault di prova delle fixture.
// `--self-test` gira i casi su una cartella temporanea.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { markdownUnder, selfTestDocFiles } from "./doc-files.mjs";

const entryFiles = [
  "README.md",
  "CLAUDE.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "CODE_OF_CONDUCT.md",
  "CHANGELOG.md",
];

function documentsOf(root) {
  return [
    ...entryFiles.map((file) => path.join(root, file)).filter(fs.existsSync),
    ...markdownUnder(path.join(root, "docs")),
  ];
}

function stripCode(text) {
  const lines = text.split(/\r?\n/);
  let fenced = false;
  let marker = "";
  return lines.map((line) => {
    const match = line.match(/^\s*(```+|~~~+)/);
    if (match) {
      if (!fenced) {
        fenced = true;
        marker = match[1][0];
      } else if (match[1][0] === marker) {
        fenced = false;
      }
      return "";
    }
    return fenced ? "" : line;
  }).join("\n");
}

function slug(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function anchorsFor(file) {
  if (!fs.existsSync(file) || !file.endsWith(".md")) return new Set();
  const counts = new Map();
  const anchors = new Set();
  for (const line of stripCode(fs.readFileSync(file, "utf8")).split(/\r?\n/)) {
    const match = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    if (!match) continue;
    const base = slug(match[1]);
    const index = counts.get(base) ?? 0;
    counts.set(base, index + 1);
    anchors.add(index === 0 ? base : `${base}-${index}`);
  }
  return anchors;
}

function decodeTarget(raw) {
  let target = raw.trim();
  if (target.startsWith("<") && target.endsWith(">")) {
    target = target.slice(1, -1);
  }
  const title = target.match(/^(\S+)\s+["'(].*["')]\s*$/);
  if (title) target = title[1];
  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
}

function linksIn(text) {
  const clean = stripCode(text);
  const links = [];
  const inline = /!?\[[^\]]*]\(([^)]+)\)/g;
  for (const match of clean.matchAll(inline)) links.push(match[1]);
  const definitions = /^\s*\[[^\]]+]:\s*(\S+)/gm;
  for (const match of clean.matchAll(definitions)) links.push(match[1]);
  return links;
}

/// I file `.fub` che git traccia (i vault di prova delle fixture), letti una
/// volta sola all'avvio. Senza git (un archivio scaricato) l'insieme è vuoto
/// e ogni link in `.fub` è un errore: meglio un rosso da spiegare che un
/// link che esiste solo su una macchina.
function trackedVaultData(root) {
  try {
    const listed = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 64 << 20 });
    return new Set(listed.split("\0").filter((file) => file.split("/").includes(".fub")));
  } catch {
    return new Set();
  }
}

/// Vero se `resolved`, dentro `root`, passa per una cartella `.fub` che git
/// non traccia: la radice dei dati di un vault locale (decisione 0048),
/// ignorata da git. Un vault di prova tracciato (`tests/fixtures/…/.fub/`) è
/// nella repository, e un link a un suo file o alla sua cartella resta
/// valido. Le altre cartelle col punto (`.github/`, `.claude/`) restano
/// target.
function insideVaultData(root, resolved, tracked) {
  const relative = path.relative(root, resolved).split(path.sep);
  if (!relative.includes(".fub")) return false;
  const file = relative.join("/");
  for (const known of tracked) if (known === file || known.startsWith(`${file}/`)) return false;
  return true;
}

/** Gli errori dei link di `files`, con i percorsi relativi a `root`. */
function linkErrors(root, files, tracked) {
  const errors = [];
  const anchorCache = new Map();

  for (const file of files) {
    const relative = path.relative(root, file).split(path.sep).join("/");
    const text = fs.readFileSync(file, "utf8");
    for (const raw of linksIn(text)) {
      const target = decodeTarget(raw);
      if (
        !target ||
        /^(https?:|mailto:|tel:|data:)/i.test(target)
      ) {
        continue;
      }

      const [pathname, fragment] = target.split("#", 2);
      const resolved = pathname
        ? path.resolve(path.dirname(file), pathname)
        : file;

      if (!resolved.startsWith(root + path.sep) && resolved !== root) {
        errors.push(`${relative}: il link esce dalla repository: ${target}`);
        continue;
      }

      // Un target nei dati di un vault esiste solo dove un vault locale l'ha
      // scritto: in CI e nelle altre copie il link è rotto.
      if (insideVaultData(root, resolved, tracked)) {
        errors.push(`${relative}: il link punta nei dati di un vault (.fub), che non sono nella repository: ${target}`);
        continue;
      }

      if (!fs.existsSync(resolved)) {
        errors.push(`${relative}: target inesistente: ${target}`);
        continue;
      }

      if (fragment && fs.statSync(resolved).isFile() && resolved.endsWith(".md")) {
        let anchors = anchorCache.get(resolved);
        if (!anchors) {
          anchors = anchorsFor(resolved);
          anchorCache.set(resolved, anchors);
        }
        if (!anchors.has(fragment.toLowerCase())) {
          errors.push(`${relative}: anchor inesistente in ${target}`);
        }
      }
    }
  }
  return errors;
}

/** Autoprova: una piccola repository con un vault locale dentro `docs/`. */
function selfTest() {
  selfTestDocFiles();
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "fub-doc-links-"));
  try {
    const tree = {
      "README.md": "# Fub\n\n[guida](docs/guida.md#come-si-fa)\n",
      "docs/guida.md": "# Guida\n\n## Come si fa\n\n[qui](#come-si-fa) [manca](assente.md) [titolo](#nessuno)\n",
      // Il file esiste, ma solo in questo vault locale.
      "docs/vault.md": "# Vault\n\n[dati](.fub/data/indice.md) [ci](../.github/ci.yml) " +
        "[prova](../tests/drill/.fub/journal.jsonl) [cartella](../tests/drill/.fub)\n",
      ".github/ci.yml": "jobs: {}\n",
      // Un vault di prova tracciato da git: i suoi dati sono un target vero.
      "tests/drill/.fub/journal.jsonl": "{}\n",
      // Lasciato da un vault locale: non è un documento, il suo link rotto
      // non conta.
      "docs/.fub/data/indice.md": "# Indice\n\n[rotto](niente.md)\n",
    };
    for (const [name, text] of Object.entries(tree)) {
      fs.mkdirSync(path.dirname(path.join(scratch, name)), { recursive: true });
      fs.writeFileSync(path.join(scratch, name), text);
    }
    const tracked = new Set(["tests/drill/.fub/journal.jsonl"]);
    const errors = linkErrors(scratch, documentsOf(scratch), tracked).sort();
    const expected = [
      "docs/guida.md: anchor inesistente in #nessuno",
      "docs/guida.md: target inesistente: assente.md",
      "docs/vault.md: il link punta nei dati di un vault (.fub), che non sono nella repository: .fub/data/indice.md",
    ];
    if (JSON.stringify(errors) !== JSON.stringify(expected)) {
      throw new Error(`attesi ${JSON.stringify(expected)}, trovati ${JSON.stringify(errors)}`);
    }
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

// L'autoprova gira a ogni lancio, come in `check-races` e `check-listeners`:
// la CI e `scripts/check.sh` lanciano la guardia senza argomenti.
try {
  selfTest();
} catch (error) {
  console.error(`Autoprova di check-doc-links fallita: ${error.message}`);
  process.exit(1);
}
if (process.argv.includes("--self-test")) {
  console.log("Autoprova di check-doc-links riuscita.");
  process.exit(0);
}

const root = process.cwd();
const files = documentsOf(root);
const errors = linkErrors(root, files, trackedVaultData(root));

if (errors.length) {
  console.error("Link documentali non validi:\n");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Link validi in ${files.length} file Markdown.`);
