#!/usr/bin/env node
// La copia di WordCraft in `vendor/wordcraft/` è derivata: l'upstream a uno
// SHA preciso più le patch di Fub in `vendor/wordcraft/patches/`, in ordine.
// `upstream.lock` ne tiene la provenienza e le impronte di ogni file, prima e
// dopo le patch.
//
//   node tools/vendor-wordcraft/vendor.mjs update --rev <sha> [--source <percorso o URL>]
//   node tools/vendor-wordcraft/vendor.mjs check
//   node tools/vendor-wordcraft/vendor.mjs verify-upstream [--source <percorso o URL>]
//
// `update` estrae dall'upstream soltanto i percorsi gestiti, applica la pila
// di patch e sostituisce la copia soltanto se tutti i passi riescono.
// `check` (senza rete, in CI) toglie l'intera pila in ordine inverso da una
// copia temporanea e ritrova le impronte dell'upstream: una modifica a mano
// che non sta in una patch lo fa fallire. `verify-upstream` (con rete)
// riscarica la revisione e ne confronta le impronte con il lock.
//
// Niente dipendenze npm, come i guard di `.github/scripts/`: usa `git` e
// `tar` del sistema.

import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const VENDOR = path.join(ROOT, "vendor/wordcraft");
const LOCK = path.join(VENDOR, "upstream.lock");
const PATCHES = path.join(VENDOR, "patches");

/// I percorsi che vengono dall'upstream; il resto di `vendor/wordcraft/`
/// (`UPSTREAM.md`, `upstream.lock`, `patches/`) è di Fub.
const MANAGED = [
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
];
const ABSENT = "none";

class Failure extends Error {}

function fail(message) {
  throw new Failure(message);
}

function sha256(bytes) {
  return "sha256:" + crypto.createHash("sha256").update(bytes).digest("hex");
}

function git(args, options = {}) {
  return execFileSync("git", args, { maxBuffer: 1 << 30, stdio: ["pipe", "pipe", "pipe"], ...options });
}

function tempdir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `fub-vendor-${label}-`));
}

/// I file sotto i percorsi gestiti di `dir`, relativi e in ordine.
function managedFiles(dir) {
  const out = [];
  for (const managed of MANAGED) {
    const full = path.join(dir, managed);
    if (!fs.existsSync(full)) continue;
    if (fs.statSync(full).isFile()) {
      out.push(managed);
      continue;
    }
    for (const name of fs.readdirSync(full, { recursive: true })) {
      const rel = path.posix.join(managed, name.split(path.sep).join("/"));
      if (fs.statSync(path.join(dir, rel)).isFile()) out.push(rel);
    }
  }
  return out.sort();
}

function hashes(dir) {
  return new Map(managedFiles(dir).map((rel) => [rel, sha256(fs.readFileSync(path.join(dir, rel)))]));
}

function copyManaged(from, to) {
  for (const rel of managedFiles(from)) {
    fs.mkdirSync(path.dirname(path.join(to, rel)), { recursive: true });
    fs.copyFileSync(path.join(from, rel), path.join(to, rel));
  }
}

// --- upstream.lock -----------------------------------------------------------

/// Legge il TOML ristretto che `writeLock` scrive: chiavi stringa in testa e
/// tabelle `[[patch]]` e `[[file]]`.
function readLock() {
  if (!fs.existsSync(LOCK)) fail(`manca ${path.relative(ROOT, LOCK)}`);
  const lock = { patch: [], file: [] };
  let table = lock;
  for (const [n, raw] of fs.readFileSync(LOCK, "utf8").split("\n").entries()) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const array = /^\[\[(patch|file)\]\]$/.exec(line);
    if (array) {
      table = {};
      lock[array[1]].push(table);
      continue;
    }
    const pair = /^([a-z0-9]+) = "([^"\\]*)"$/.exec(line);
    if (!pair) fail(`upstream.lock:${n + 1}: riga non riconosciuta`);
    table[pair[1]] = pair[2];
  }
  for (const key of ["repository", "rev", "version"]) {
    if (!lock[key]) fail(`upstream.lock: manca ${key}`);
  }
  return lock;
}

function writeLock(lock) {
  const head = ["repository", "mirror", "rev", "tag", "date", "version"]
    .map((key) => `${key} = "${lock[key] ?? ""}"`)
    .join("\n");
  const patches = lock.patch.map((p) => `[[patch]]\npath = "${p.path}"\nsha256 = "${p.sha256}"\n`);
  const files = lock.file.map(
    (f) => `[[file]]\npath = "${f.path}"\nupstream = "${f.upstream}"\n` + (f.result ? `result = "${f.result}"\n` : ""),
  );
  const text = [
    "# La provenienza della copia di WordCraft, per `tools/vendor-wordcraft/vendor.mjs`.",
    "# Non si modifica a mano: la scrive `update`. Un tag è informativo, lo SHA no.",
    head,
    "",
    ...patches,
    ...files,
  ].join("\n");
  fs.writeFileSync(LOCK, text.endsWith("\n") ? text : text + "\n");
}

// --- patch ---------------------------------------------------------------------

function patchFiles() {
  if (!fs.existsSync(PATCHES)) return [];
  return fs
    .readdirSync(PATCHES)
    .filter((name) => name.endsWith(".patch"))
    .sort()
    .map((name) => `patches/${name}`);
}

/// Applica (o toglie, con `reverse`) la pila in `dir`, una patch alla volta,
/// con `git apply --check` prima di ciascuna.
function applyStack(dir, patches, reverse = false) {
  // Un repository vuoto fissa la radice dei percorsi delle patch in `dir`.
  git(["init", "-q"], { cwd: dir });
  const order = reverse ? [...patches].reverse() : patches;
  for (const patch of order) {
    const args = ["apply", "--whitespace=nowarn", ...(reverse ? ["-R"] : []), path.join(VENDOR, patch)];
    const checked = spawnSync("git", [args[0], "--check", ...args.slice(1)], { cwd: dir, encoding: "utf8" });
    if (checked.status !== 0) {
      fail(`${patch} non si ${reverse ? "toglie" : "applica"}:\n${checked.stderr.trim()}`);
    }
    git(args, { cwd: dir });
  }
  fs.rmSync(path.join(dir, ".git"), { recursive: true, force: true });
}

// --- sorgente dell'upstream ----------------------------------------------------

/// Un repository git da cui leggere `rev`: un clone locale, o un clone
/// parziale di un URL in una cartella temporanea.
/// I cloni temporanei, che `done` cancella all'uscita.
const clones = [];

function repository(source, rev) {
  if (fs.existsSync(source)) return source;
  const dir = tempdir("clone");
  clones.push(dir);
  git(["clone", "--quiet", "--filter=blob:none", "--no-checkout", source, dir]);
  const has = spawnSync("git", ["cat-file", "-e", `${rev}^{commit}`], { cwd: dir });
  if (has.status !== 0) git(["fetch", "--quiet", "origin", rev], { cwd: dir });
  return dir;
}

function done() {
  for (const dir of clones) fs.rmSync(dir, { recursive: true, force: true });
}

/// I percorsi gestiti di `rev`, estratti con `git archive` in una cartella
/// nuova.
function extract(repo, rev) {
  if (!/^[0-9a-f]{40}$/.test(rev)) fail(`--rev vuole uno SHA di 40 caratteri, non ${rev}`);
  const dir = tempdir("upstream");
  const tar = git(["-C", repo, "archive", "--format=tar", rev, "--", ...MANAGED]);
  const untar = spawnSync("tar", ["-x", "-C", dir], { input: tar });
  if (untar.status !== 0) fail(`tar: ${untar.stderr}`);
  const date = git(["-C", repo, "show", "-s", "--format=%cs", rev]).toString().trim();
  const manifest = git(["-C", repo, "show", `${rev}:Cargo.toml`]).toString();
  const version = /\[workspace\.package\][^[]*?\nversion = "([^"]+)"/.exec(manifest)?.[1];
  if (!version) fail("il Cargo.toml dell'upstream non dichiara la versione del workspace");
  return { dir, date, version };
}

// --- manifest --------------------------------------------------------------------

/// Le dipendenze dirette di un manifest, per sezione: `[dependencies]`,
/// `[dev-dependencies]`, `[build-dependencies]` e quelle per bersaglio.
function dependencies(text) {
  const out = new Set();
  let section = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const header = /^\[(.+)\]$/.exec(line);
    if (header) {
      const name = header[1];
      section = /(^|\.)(dev-|build-)?dependencies$/.test(name) ? name : null;
      continue;
    }
    const dep = section && /^([A-Za-z0-9_-]+)\s*=/.exec(line);
    if (dep) out.add(`${section}: ${dep[1]}`);
  }
  return out;
}

/// Le dipendenze che un manifest eredita con `workspace = true`.
function inherited(text) {
  return [...text.matchAll(/^([A-Za-z0-9_-]+)\s*=\s*\{[^}\n]*\bworkspace\s*=\s*true/gm)].map((m) => m[1]);
}

/// Le dipendenze dichiarate in `[workspace.dependencies]` di un manifest.
function workspaceDependencies(text) {
  const block = /\n\[workspace\.dependencies\]\n([\s\S]*?)(?=\n\[|$)/.exec(text)?.[1] ?? "";
  const out = new Map();
  for (const m of block.matchAll(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/gm)) {
    const version = /^"([^"]+)"/.exec(m[2])?.[1] ?? /\bversion\s*=\s*"([^"]+)"/.exec(m[2])?.[1] ?? null;
    out.set(m[1], version);
  }
  return out;
}

/// Il workspace a cui i sei crate appartengono: quello di `vendor/` se c'è,
/// altrimenti quello di Fub.
function owningWorkspace() {
  const own = path.join(VENDOR, "Cargo.toml");
  return fs.existsSync(own) ? own : path.join(ROOT, "Cargo.toml");
}

/// Ogni dipendenza ereditata è definita nel workspace che la deve dare, e le
/// dipendenze in comune fra il workspace di `vendor/` e quello di Fub hanno la
/// stessa versione.
function checkManifests(dir) {
  const problems = [];
  const owner = owningWorkspace();
  const defined = workspaceDependencies(fs.readFileSync(owner, "utf8"));
  for (const rel of managedFiles(dir).filter((f) => f.endsWith("/Cargo.toml"))) {
    for (const name of inherited(fs.readFileSync(path.join(dir, rel), "utf8"))) {
      if (!defined.has(name)) problems.push(`${rel}: ${name} eredita dal workspace, che non la definisce (${path.relative(ROOT, owner)})`);
    }
  }
  if (owner !== path.join(ROOT, "Cargo.toml")) {
    const fub = workspaceDependencies(fs.readFileSync(path.join(ROOT, "Cargo.toml"), "utf8"));
    for (const [name, version] of defined) {
      if (fub.has(name) && version && fub.get(name) && fub.get(name) !== version) {
        problems.push(`${name}: ${version} in vendor/wordcraft, ${fub.get(name)} in Fub`);
      }
    }
  }
  return problems;
}

/// Le righe che portano la versione dell'upstream: le `wordcraft-*` del
/// `Cargo.toml` di Fub e, in quello di `vendor/`, le stesse righe e la versione
/// di `[workspace.package]`. Una dipendenza a percorso senza versione è un
/// carattere jolly per `cargo deny`.
const VERSION_LINES = [
  ["Cargo.toml", /^(wordcraft-[a-z]+ = \{ path = "vendor\/wordcraft\/crates\/[a-z]+", version = ")([^"]+)(" \})$/gm],
  ["vendor/wordcraft/Cargo.toml", /^(wordcraft-[a-z]+ = \{ path = "crates\/[a-z]+", version = ")([^"]+)(" \})$/gm],
  ["vendor/wordcraft/Cargo.toml", /^(\[workspace\.package\][^[]*?\nversion = ")([^"]+)(")$/gm],
];

/// Per ogni regola, il file e le versioni che vi trova.
function versionLines() {
  return VERSION_LINES.map(([rel, line]) => {
    const file = path.join(ROOT, rel);
    const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    return { rel, versions: [...text.matchAll(line)].map((m) => m[2]) };
  });
}

function writeVersions(version) {
  for (const [rel, line] of VERSION_LINES) {
    const file = path.join(ROOT, rel);
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(line, `$1${version}$3`));
  }
}

// --- comandi --------------------------------------------------------------------

/// Ricostruisce l'upstream togliendo la pila da una copia della copia, e
/// confronta tutto con il lock. Restituisce la cartella ricostruita.
function check({ quiet = false } = {}) {
  const lock = readLock();
  const problems = [];
  const now = hashes(VENDOR);
  const listed = new Map(lock.file.map((f) => [f.path, f]));

  for (const patch of patchFiles()) {
    const entry = lock.patch.find((p) => p.path === patch);
    const actual = sha256(fs.readFileSync(path.join(VENDOR, patch)));
    if (!entry) problems.push(`${patch}: non è nel lock`);
    else if (entry.sha256 !== actual) problems.push(`${patch}: impronta diversa dal lock`);
  }
  for (const entry of lock.patch) {
    if (!fs.existsSync(path.join(VENDOR, entry.path))) problems.push(`${entry.path}: nel lock ma non c'è`);
  }
  for (const [rel, entry] of listed) {
    const wanted = entry.result ?? entry.upstream;
    if (wanted === ABSENT) {
      if (now.has(rel)) problems.push(`${rel}: una patch lo toglie, ma c'è`);
    } else if (!now.has(rel)) problems.push(`${rel}: manca`);
    else if (now.get(rel) !== wanted) problems.push(`${rel}: cambiato fuori da una patch`);
  }
  for (const rel of now.keys()) {
    if (!listed.has(rel)) problems.push(`${rel}: file in più, non nel lock`);
  }

  // L'intera pila, tolta in ordine inverso, deve ridare l'upstream.
  const dir = tempdir("check");
  copyManaged(VENDOR, dir);
  try {
    applyStack(dir, patchFiles(), true);
    const back = hashes(dir);
    for (const [rel, entry] of listed) {
      if (entry.upstream === ABSENT ? back.has(rel) : back.get(rel) !== entry.upstream) {
        problems.push(`${rel}: tolte le patch, non è il file dell'upstream`);
      }
    }
    for (const rel of back.keys()) {
      if (!listed.has(rel)) problems.push(`${rel}: tolte le patch, file in più`);
    }
  } catch (error) {
    if (!(error instanceof Failure)) throw error;
    problems.push(error.message);
  }

  for (const { rel, versions } of versionLines()) {
    for (const version of versions) {
      if (version !== lock.version) problems.push(`${rel}: wordcraft a ${version}, il lock dice ${lock.version}`);
    }
    if (versions.length === 0) problems.push(`${rel}: nessuna riga con la versione di wordcraft riconosciuta`);
  }
  problems.push(...checkManifests(VENDOR));

  if (problems.length > 0) {
    fs.rmSync(dir, { recursive: true, force: true });
    fail(`la copia di WordCraft non è l'upstream ${lock.rev.slice(0, 12)} più le patch:\n- ${problems.join("\n- ")}`);
  }
  if (!quiet) {
    console.log(`vendor/wordcraft: upstream ${lock.rev.slice(0, 12)} più ${lock.patch.length} patch, ${listed.size} file verificati.`);
  }
  return { lock, upstream: dir };
}

/// Il repository dell'upstream, quando il lock non c'è ancora.
const REPOSITORY = "https://github.com/storytold/wordcraft";

/// Che la copia abbia ancora le impronte del lock: nessun file cambiato,
/// tolto o aggiunto a mano. Le patch possono essere cambiate.
function untouched(lock) {
  const now = hashes(VENDOR);
  const problems = [];
  for (const entry of lock.file) {
    const wanted = entry.result ?? entry.upstream;
    if (wanted === ABSENT ? now.has(entry.path) : now.get(entry.path) !== wanted) problems.push(entry.path);
  }
  for (const rel of now.keys()) if (!lock.file.some((f) => f.path === rel)) problems.push(rel);
  if (problems.length > 0) {
    fail(`la copia è cambiata fuori dalle patch, update non la sovrascrive:\n- ${problems.join("\n- ")}`);
  }
}

function update(rev, source) {
  // La prima volta non c'è un lock: la copia di prima è quella fatta a mano, e
  // il diff di git dice se il risultato la riproduce.
  const old = fs.existsSync(LOCK) ? readLock() : { repository: REPOSITORY, mirror: "", rev: "", file: [] };
  if (old.rev) untouched(old);
  const repo = repository(source ?? old.repository, rev);
  // L'upstream di prima si rilegge alla sua revisione: la pila di patch può
  // essere cambiata da allora.
  const previous = { lock: old, upstream: old.rev ? extract(repo, old.rev).dir : tempdir("none") };
  const { dir, date, version } = extract(repo, rev);

  // Il risultato si costruisce a parte; la copia si sostituisce alla fine.
  const result = tempdir("result");
  copyManaged(dir, result);
  applyStack(result, patchFiles());

  const before = new Map();
  for (const rel of managedFiles(previous.upstream).filter((f) => f.endsWith("/Cargo.toml"))) {
    before.set(rel, dependencies(fs.readFileSync(path.join(previous.upstream, rel), "utf8")));
  }
  const changes = [];
  for (const rel of managedFiles(dir).filter((f) => f.endsWith("/Cargo.toml"))) {
    const after = dependencies(fs.readFileSync(path.join(dir, rel), "utf8"));
    const old = before.get(rel) ?? new Set();
    const crate = rel.split("/")[1];
    for (const dep of after) if (!old.has(dep)) changes.push(`wordcraft-${crate}: + ${dep}`);
    for (const dep of old) if (!after.has(dep)) changes.push(`wordcraft-${crate}: - ${dep}`);
  }
  const problems = checkManifests(result);
  if (problems.length > 0) fail(`le dipendenze non tornano:\n- ${problems.join("\n- ")}`);

  const upstream = hashes(dir);
  const patched = hashes(result);
  const lock = {
    repository: previous.lock.repository,
    mirror: previous.lock.mirror ?? "",
    rev,
    tag: "",
    date,
    version,
    patch: patchFiles().map((p) => ({ path: p, sha256: sha256(fs.readFileSync(path.join(VENDOR, p))) })),
    file: [...new Set([...upstream.keys(), ...patched.keys()])].sort().map((rel) => {
      const up = upstream.get(rel) ?? ABSENT;
      const out = patched.get(rel) ?? ABSENT;
      return { path: rel, upstream: up, ...(out !== up ? { result: out } : {}) };
    }),
  };

  // Tutti i passi sono riusciti: si sostituisce.
  for (const managed of MANAGED) fs.rmSync(path.join(VENDOR, managed), { recursive: true, force: true });
  copyManaged(result, VENDOR);
  writeLock(lock);
  writeVersions(version);
  for (const d of [dir, result, previous.upstream]) fs.rmSync(d, { recursive: true, force: true });

  const changed = lock.file.filter((f) => previous.lock.file.find((p) => p.path === f.path)?.upstream !== f.upstream);
  const from = previous.lock.rev ? previous.lock.rev.slice(0, 12) : "la copia senza lock";
  console.log(`vendor/wordcraft: da ${from} a ${rev.slice(0, 12)} (${date}, ${version}).`);
  console.log(`file dell'upstream cambiati: ${changed.length}; patch applicate: ${lock.patch.length}.`);
  if (changes.length > 0) {
    console.log("dipendenze da rivedere (licenza, avvisi):");
    for (const c of changes) console.log(`  ${c}`);
  }
  console.log("passi successivi: cargo test del workspace e dei motori, il corpus, cargo deny check (vedi vendor/wordcraft/UPSTREAM.md).");
}

function verifyUpstream(source) {
  const local = check({ quiet: true });
  const sources = [source ?? local.lock.repository, ...(source || !local.lock.mirror ? [] : [local.lock.mirror])];
  for (const from of sources) {
    const { dir } = extract(repository(from, local.lock.rev), local.lock.rev);
    const problems = [];
    const upstream = hashes(dir);
    for (const entry of local.lock.file) {
      if (entry.upstream === ABSENT ? upstream.has(entry.path) : upstream.get(entry.path) !== entry.upstream) {
        problems.push(`${entry.path}: l'upstream non ha l'impronta del lock`);
      }
    }
    for (const rel of upstream.keys()) {
      if (!local.lock.file.some((f) => f.path === rel)) problems.push(`${rel}: nell'upstream ma non nel lock`);
    }
    applyStack(dir, patchFiles());
    const result = hashes(dir);
    for (const entry of local.lock.file) {
      const wanted = entry.result ?? entry.upstream;
      if (wanted === ABSENT ? result.has(entry.path) : result.get(entry.path) !== wanted) {
        problems.push(`${entry.path}: con le patch non dà il risultato del lock`);
      }
    }
    fs.rmSync(dir, { recursive: true, force: true });
    if (problems.length > 0) fail(`${from}:\n- ${problems.join("\n- ")}`);
    console.log(`${from}: ${local.lock.rev.slice(0, 12)} ha le impronte del lock, e con le patch dà la copia.`);
  }
  fs.rmSync(local.upstream, { recursive: true, force: true });
}

function option(args, name) {
  const at = args.indexOf(name);
  if (at < 0) return undefined;
  if (!args[at + 1]) fail(`${name} vuole un valore`);
  return args[at + 1];
}

try {
  const [command, ...args] = process.argv.slice(2);
  if (command === "check") {
    fs.rmSync(check().upstream, { recursive: true, force: true });
  } else if (command === "update") {
    const rev = option(args, "--rev") ?? fail("update vuole --rev <sha>");
    update(rev, option(args, "--source"));
  } else if (command === "verify-upstream") {
    verifyUpstream(option(args, "--source"));
  } else {
    fail("uso: vendor.mjs update --rev <sha> [--source <percorso o URL>] | check | verify-upstream [--source <percorso o URL>]");
  }
} catch (error) {
  done();
  if (!(error instanceof Failure)) throw error;
  console.error(error.message);
  process.exit(1);
}
done();
