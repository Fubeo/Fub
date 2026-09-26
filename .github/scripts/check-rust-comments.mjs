#!/usr/bin/env node
// I commenti di Rust restano attaccati a ciò che descrivono.
//
// Una riscrittura automatica che lavora a blocchi di righe può spezzare un
// `///`, lasciarne metà sopra l'item sbagliato, duplicarlo o calarlo dentro un
// corpo, e il compilatore non se ne accorge: rustdoc attacca il testo al primo
// item che segue, qualunque sia. rustc e clippy vedono alcune di queste forme
// (un doc su un'istruzione, una riga vuota fra doc e item); le altre compilano
// e ingannano chi legge. Questo guard cerca le forme che una riscrittura del
// genere lascia dietro di sé.
//
// È euristico, e sbaglia dal verso innocuo: una segnalazione si risolve
// riattaccando il testo al suo item, o riscrivendolo, non allargando le regole.
// Il lessico invece è quello di Rust — stringhe, stringhe raw, caratteri,
// lifetime e commenti a blocco annidati — perché un `///` dentro la stringa di
// un banco non è un doc.
//
// Uso: node .github/scripts/check-rust-comments.mjs [radice] [--self-test]

import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const root = args.find((arg) => !arg.startsWith("--")) ?? process.cwd();

/// Le cartelle che contengono sorgenti Rust.
const SOURCE_DIRS = ["crates", "esempi", "tools"];

const RULES = {
  doppione: "la stessa riga di commento due volte di fila",
  "doc-riga-vuota":
    "un `///` seguito da una riga vuota: il testo si attacca all'item che viene dopo, qualunque sia",
  "doc-coda-vuota": "un `///` che finisce con una riga vuota prima dell'item",
  "doc-senza-item": "un `///` che, saltati commenti e attributi, non precede un item",
  "doc-su-use":
    "un `///` sopra un `use` privato: rustdoc non lo mostra, ed è quasi sempre il doc di qualcos'altro",
  "commento-fra-doc-e-item": "un commento `//` fra un `///` e il suo item",
  "vuota-a-metà-frase":
    "una riga di commento vuota fra una riga che non chiude la frase e una che comincia in minuscolo",
  "intestazione-spezzata": "un'intestazione di sezione spezzata da una riga vuota",
  "intestazione-incollata": "la riga d'apertura di una sezione incollata a un altro commento",
  "chiusura-senza-apertura": "la riga di chiusura di una sezione senza quella d'apertura",
  "colonna-zero": "un commento a colonna zero dentro un blocco",
  "rientro-fuori-blocco": "un commento rientrato fuori da ogni blocco",
};

// ---------------------------------------------------------------------------
// Il lessico
// ---------------------------------------------------------------------------

const OPEN = new Set(["{", "[", "("]);
const CLOSE = new Set(["}", "]", ")"]);
const CHAR = /'(?:\\u\{[0-9a-fA-F]+\}|\\x[0-9a-fA-F]{2}|\\.|[^\\'\n])'/uy;
const RAW = /[bc]?r(#*)"/y;

function identChar(ch) {
  return ch !== undefined && /[\p{L}\p{N}_]/u.test(ch);
}

/// Le righe di un sorgente, ciascuna con ciò che il lessico sa di lei: se
/// comincia dentro una stringa o un commento a blocco (`literal`), se è vuota,
/// un commento di riga o codice, e a che profondità di parentesi comincia.
function lex(source) {
  const text = source.replace(/\r\n/g, "\n");
  const lines = [];
  let depth = 0;
  let state = null;
  let nest = 0;
  let hashes = "";
  let lineStart = 0;
  let startState = null;
  let startDepth = 0;

  const push = (end) => {
    const raw = text.slice(lineStart, end);
    const line = { raw, depth: startDepth, kind: "code" };
    const trimmed = raw.trimStart();
    if (startState) {
      line.kind = "literal";
    } else if (!trimmed) {
      line.kind = "blank";
    } else if (trimmed.startsWith("//")) {
      line.kind = "comment";
      line.indent = raw.length - trimmed.length;
      line.marker = "//";
      if (trimmed.startsWith("///") && !trimmed.startsWith("////")) line.marker = "///";
      else if (trimmed.startsWith("//!")) line.marker = "//!";
      const body = trimmed.slice(line.marker.length);
      line.text = body.startsWith(" ") ? body.slice(1) : body;
    }
    lines.push(line);
  };

  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "\n") {
      push(i);
      lineStart = i + 1;
      startState = state;
      startDepth = depth;
      i += 1;
      continue;
    }
    if (state === "block") {
      if (text.startsWith("*/", i)) {
        nest -= 1;
        i += 2;
        if (nest === 0) state = null;
      } else if (text.startsWith("/*", i)) {
        nest += 1;
        i += 2;
      } else {
        i += 1;
      }
      continue;
    }
    if (state === "str") {
      if (c === "\\") {
        // La continuazione `\` a fine riga lascia che l'a capo passi di qui.
        i += text[i + 1] === "\n" ? 1 : 2;
        continue;
      }
      if (c === '"') state = null;
      i += 1;
      continue;
    }
    if (state === "raw") {
      if (c === '"' && text.startsWith(hashes, i + 1)) {
        state = null;
        i += 1 + hashes.length;
      } else {
        i += 1;
      }
      continue;
    }
    if (text.startsWith("//", i)) {
      const end = text.indexOf("\n", i);
      i = end < 0 ? text.length : end;
      continue;
    }
    if (text.startsWith("/*", i)) {
      state = "block";
      nest = 1;
      i += 2;
      continue;
    }
    if (!identChar(text[i - 1])) {
      RAW.lastIndex = i;
      const raw = RAW.exec(text);
      if (raw) {
        state = "raw";
        hashes = raw[1];
        i = RAW.lastIndex;
        continue;
      }
    }
    if (c === '"') {
      state = "str";
      i += 1;
      continue;
    }
    if (c === "'") {
      // Un carattere si chiude subito; una lifetime o un'etichetta no.
      CHAR.lastIndex = i;
      i = CHAR.exec(text) ? CHAR.lastIndex : i + 1;
      continue;
    }
    if (OPEN.has(c)) depth += 1;
    else if (CLOSE.has(c)) depth -= 1;
    i += 1;
  }
  push(text.length);
  return lines;
}

// ---------------------------------------------------------------------------
// Le regole
// ---------------------------------------------------------------------------

const ITEM =
  /^(?:pub(?:\([^)]*\))?\s+)?(?:(?:unsafe|async|const|default|extern(?:\s+"[^"]*")?)\s+)*(?:(?:fn|struct|enum|union|trait|impl|type|const|static|mod|use|extern\s+crate)\b|macro_rules!)/;
// Un campo, una variante, o un frammento di `macro_rules!`.
const MEMBER = /^(?:pub(?:\([^)]*\))?\s+)?(?:r#)?[A-Za-z_][A-Za-z0-9_]*\s*(?::(?!:)|,|\(|\{|=|$)|^\$/;
const MACRO_ITEM = /^(?:[a-z_][a-z0-9_]*::)*[a-z_][a-z0-9_]*!\s*[({[]/;
const STATEMENT = /^(?:(?:let|if|match|for|while|loop|return)\b|assert|panic!|self\.|[*&.])/;
const SEPARATOR = /^[-=]{10,}$/;
const SENTENCE_END = /[.:;!?)`»*_\]>|—]$|^[-=#*]+$|^#|^```/;

const isDoc = (line) => line?.kind === "comment" && line.marker === "///";
const isPlain = (line) => line?.kind === "comment" && line.marker === "//";
const isSeparator = (line) => isPlain(line) && SEPARATOR.test(line.text.trim());
const isHeading = (line) => isPlain(line) && !isSeparator(line) && line.text.trim() !== "";

function isItem(code) {
  if (STATEMENT.test(code)) return false;
  return ITEM.test(code) || MEMBER.test(code) || MACRO_ITEM.test(code);
}

/// Le righe di commento dentro un blocco di codice recintato (```), che è
/// codice citato e non prosa.
function fenced(lines) {
  const inside = new Array(lines.length).fill(false);
  let open = false;
  for (let k = 0; k < lines.length; k++) {
    const line = lines[k];
    if (line.kind !== "comment") {
      open = false;
      continue;
    }
    const fence = line.text.trim().startsWith("```");
    inside[k] = open || fence;
    if (fence) open = !open;
  }
  return inside;
}

function check(file, source) {
  const lines = lex(source);
  const inFence = fenced(lines);
  const found = [];
  const report = (k, rule) => found.push({ file, line: k + 1, rule, text: lines[k].raw.trim() });

  for (let k = 0; k < lines.length; k++) {
    const line = lines[k];
    const next = lines[k + 1];
    if (line.kind !== "comment") continue;
    const text = line.text.trim();

    if (
      next?.kind === "comment" &&
      next.marker === line.marker &&
      next.indent === line.indent &&
      text.length >= 12 &&
      /\p{L}/u.test(text) &&
      !SEPARATOR.test(text) &&
      next.text.trim() === text
    ) {
      report(k + 1, "doppione");
    }

    if (line.raw.startsWith("//") && line.marker !== "//!" && line.depth > 0) report(k, "colonna-zero");
    if (isPlain(line) && line.indent > 0 && line.depth === 0) report(k, "rientro-fuori-blocco");

    if (isDoc(line) && !isDoc(next)) {
      if (next?.kind === "blank") report(k, "doc-riga-vuota");
      else if (text === "") report(k, "doc-coda-vuota");
      else attachment(lines, k, report);
    }

    const previous = lines[k - 1];
    if (
      text === "" &&
      !inFence[k] &&
      [previous, next].every(
        (other) =>
          other?.kind === "comment" &&
          other.marker === line.marker &&
          other.indent === line.indent &&
          other.text.trim() !== "",
      ) &&
      !/^\s{4}/.test(previous.text) &&
      !SENTENCE_END.test(previous.text.trim()) &&
      /^\p{Ll}/u.test(next.text.trim())
    ) {
      report(k, "vuota-a-metà-frase");
    }

    if (isSeparator(line)) sections(lines, k, report);
  }
  return found;
}

const isAttribute = (line) => line?.kind === "code" && /^#!?\[/.test(line.raw.trimStart());

/// Dall'ultima riga di un `///`: saltati commenti e attributi, deve venire un
/// item — e fra il doc e l'item non ci sta un commento qualunque. Ci sta quello
/// che spiega l'attributo subito sotto, e la ragione `SAFETY:` di un `unsafe`.
function attachment(lines, k, report) {
  let j = k + 1;
  let between = null;
  while (j < lines.length) {
    const line = lines[j];
    if (line.kind === "comment") {
      if (line.marker !== "///" && between === null && !line.text.startsWith("SAFETY:")) {
        let end = j;
        while (lines[end]?.kind === "comment" && lines[end].marker !== "///") end += 1;
        if (!isAttribute(lines[end])) between = j;
      }
      j += 1;
    } else if (isAttribute(line)) {
      // Un attributo su più righe finisce dove la profondità torna la sua.
      const depth = line.depth;
      j += 1;
      while (j < lines.length && lines[j].depth > depth) j += 1;
    } else {
      break;
    }
  }
  const target = lines[j];
  if (!target || target.kind !== "code") {
    report(k, "doc-senza-item");
    return;
  }
  const code = target.raw.trimStart();
  if (!isItem(code)) report(k, "doc-senza-item");
  else if (/^use\b/.test(code)) report(k, "doc-su-use");
  else if (between !== null) report(between, "commento-fra-doc-e-item");
}

/// Un'intestazione di sezione è una riga di trattini, il titolo, e un'altra
/// riga di trattini; la si guarda dalla riga di trattini.
function sections(lines, k, report) {
  const previous = lines[k - 1];
  const next = lines[k + 1];
  if (isHeading(previous) && isHeading(next)) report(k, "intestazione-incollata");

  if (isHeading(next)) {
    let j = k + 1;
    while (isHeading(lines[j])) j += 1;
    if (lines[j]?.kind === "blank") {
      while (lines[j]?.kind === "blank") j += 1;
      if (isSeparator(lines[j])) report(k, "intestazione-spezzata");
    }
  }

  if (isHeading(previous) && !(next?.kind === "comment")) {
    let j = k - 1;
    while (isHeading(lines[j]) || (isPlain(lines[j]) && !isSeparator(lines[j]))) j -= 1;
    if (!isSeparator(lines[j])) report(k, "chiusura-senza-apertura");
  }
}

// ---------------------------------------------------------------------------
// Il cammino
// ---------------------------------------------------------------------------

function sources(dir, into) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "target" || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sources(full, into);
    else if (entry.isFile() && entry.name.endsWith(".rs")) into.push(full);
  }
  return into;
}

// ---------------------------------------------------------------------------
// L'autoprova
// ---------------------------------------------------------------------------

const DEFECTS = `// Un modulo con un difetto per regola.

/// Un doc duplicato riga per riga.
/// Un doc duplicato riga per riga.
pub fn doubled() {}

/// Un doc staccato dal proprio item.

pub fn detached() {}

/// Un doc che finisce vuoto.
///
pub fn trailing() {}

/// Un doc sopra un'istruzione.
let stray = 1;

/// Un doc che è finito sopra un import.
use std::fmt;

/// Un doc con un commento in mezzo.
// Il commento finito qui per sbaglio.
pub fn interleaved() {}

/// Una frase che si interrompe
///
/// a metà, e riprende sotto.
pub fn broken() {}

// ---------------------------------------------------------------------------
// Una sezione spezzata

// ---------------------------------------------------------------------------

// un commento rimasto attaccato
// ---------------------------------------------------------------------------
// Una sezione incollata
// ---------------------------------------------------------------------------

// Un titolo senza apertura
// ---------------------------------------------------------------------------

fn body() {
// Un commento a colonna zero dentro un blocco.
    let _ = 1;
}

    // Un commento rientrato fuori da ogni blocco.
`;

const CLEAN = `//! Un modulo che il lessico deve leggere senza inciampare.

/// Una costante: \`'{'\` non apre niente.
pub const BRACE: char = '{';

/// E \`'"'\` non apre una stringa.
pub const QUOTE: char = '"';

/// Una stringa che contiene \`///\` e una riga vuota.
pub const FAKE: &str = "\\
/// un doc finto

fn nothing() {}\\n";

/// Una stringa raw, con trattini e virgolette.
pub const RAW: &str = r#"
// ---------------------------------------------------------------------------
"not a title"
"#;

/* Un commento a blocco /* annidato */ con \`//\` dentro. */

/// Un tipo con campi e varianti documentati.
#[derive(
    Debug,
    Clone,
)]
pub struct Fields<'a> {
    /// Il primo campo.
    pub name: &'a str,
    /// Il secondo: \`'}'\` è un carattere, \`b'('\` pure.
    count: u8,
}

/// Le varianti.
pub enum Kind {
    /// La prima.
    One,
    /// La seconda.
    Two(u8),
}

/// Un \`unsafe impl\` porta la sua ragione.
// SAFETY: il tipo non ha stato condiviso.
unsafe impl Send for Kind {}

/// Un attributo con la sua spiegazione.
// La spiegazione sta sopra l'attributo che spiega.
#[derive(Debug)]
pub struct Explained;

/// Un esempio recintato, che non è prosa:
///
/// \`\`\`text
/// una riga
///
/// e un'altra
/// \`\`\`
///
/// E una citazione rientrata:
///
///     il componente è caduto
///
/// cioè la parola che conta.
pub fn quoted<'b>(value: &'b str) -> &'b str {
    // Un commento di corpo, rientrato come il corpo.
    'outer: loop {
        break 'outer;
    }
    value
}

// ---------------------------------------------------------------------------
// Una sezione intera
// ---------------------------------------------------------------------------

/// Un item dopo la sezione.
pub fn after() {}
`;

function selfTest() {
  const expected = Object.keys(RULES).sort();
  const seen = [...new Set(check("difetti.rs", DEFECTS).map((finding) => finding.rule))].sort();
  const clean = check("pulito.rs", CLEAN);
  const failures = [];
  if (seen.join(",") !== expected.join(",")) {
    failures.push(`regole viste ${seen.join(", ")}; attese ${expected.join(", ")}`);
  }
  for (const finding of clean) failures.push(`falso positivo: ${finding.line} [${finding.rule}] ${finding.text}`);
  if (failures.length) {
    console.error("Autoprova di check-rust-comments fallita:\n");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log(`Autoprova di check-rust-comments riuscita: ${expected.length} regole.`);
}

if (args.includes("--self-test")) {
  selfTest();
  process.exit(0);
}

const found = [];
let files = 0;
for (const dir of SOURCE_DIRS) {
  const base = path.join(root, dir);
  if (!fs.existsSync(base)) continue;
  for (const file of sources(base, []).sort()) {
    files += 1;
    const name = path.relative(root, file).split(path.sep).join("/");
    found.push(...check(name, fs.readFileSync(file, "utf8")));
  }
}

if (found.length) {
  console.error("Commenti di Rust staccati da ciò che descrivono:\n");
  for (const { file, line, rule, text } of found) {
    console.error(`- ${file}:${line} [${rule}] ${RULES[rule]}\n    ${text}`);
  }
  process.exit(1);
}
console.log(`commenti di Rust: ${files} sorgenti, nessun commento staccato dal proprio item`);
