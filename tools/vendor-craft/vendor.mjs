#!/usr/bin/env node
// La copia di un motore Craft in `vendor/<motore>/` è derivata: l'upstream a
// uno SHA preciso più le patch di Fub in `vendor/<motore>/patches/`, in
// ordine. `upstream.lock` ne tiene la provenienza e le impronte di ogni file,
// prima e dopo le patch. I motori e i loro percorsi sono in `motori.mjs`.
//
//   node tools/vendor-craft/vendor.mjs <motore> update --rev <sha> [--tag <tag>] [--source <percorso o URL>]
//   node tools/vendor-craft/vendor.mjs [<motore>] check
//   node tools/vendor-craft/vendor.mjs <motore> verify-upstream [--source <percorso o URL>]
//   node tools/vendor-craft/vendor.mjs <motore> report --rev <sha> [--source <percorso o URL>]
//   node tools/vendor-craft/vendor.mjs <motore> gate
//
// `check` senza motore li controlla tutti.
//
// `report` è l'aggiornamento a vuoto: non tocca la copia, e dice che cosa
// `update --rev <sha>` troverebbe. Per ogni patch: se si applica sulla pila,
// se da sola, se l'upstream l'ha già assorbita (si toglie al contrario dai
// file nuovi), e quali dei file che tocca l'upstream ha cambiato. Poi le
// dipendenze aggiunte e tolte, le versioni del workspace e la `rust-version`.
// `gate` esegue, dopo un `update`, le prove che `motori.mjs` elenca per il
// motore (i test del motore e dell'adattatore, il catalogo servito, il
// corpus, i mirror, `cargo deny`) e le riassume in una tabella; non si ferma
// alla prima che fallisce.
//
// `update` estrae dall'upstream soltanto i percorsi gestiti, applica la pila
// di patch e sostituisce la copia soltanto se tutti i passi riescono.
// `check` (senza rete, in CI) toglie l'intera pila in ordine inverso da una
// copia temporanea e ritrova le impronte dell'upstream: una modifica a mano
// che non sta in una patch lo fa fallire. `verify-upstream` (con rete)
// riscarica la revisione e ne confronta le impronte con il lock. Il `--tag`
// di `update` si scrive nel lock soltanto se nell'upstream punta proprio a
// `--rev`, e `verify-upstream` lo ricontrolla: un tag si può spostare, lo SHA
// no.
//
// Niente dipendenze npm, come i guard di `.github/scripts/`: usa `git` e
// `tar` del sistema.

import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { MOTORI } from "./motori.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ABSENT = "none";

// Il motore su cui si lavora, fissato da `scegli` prima di ogni comando.
/// L'id del motore (`wordcraft`), il suo nome (`WordCraft`) e il repository.
let ID;
let NOME;
let REPOSITORY;
let VENDOR;
let LOCK;
let PATCHES;
/// I percorsi che vengono dall'upstream; il resto di `vendor/<motore>/`
/// (`UPSTREAM.md`, `upstream.lock`, `patches/`) è di Fub.
let MANAGED;

function scegli(id) {
  const motore = MOTORI[id];
  if (!motore) fail(`motore sconosciuto: ${id} (motori: ${Object.keys(MOTORI).join(", ")})`);
  ID = id;
  NOME = motore.nome;
  REPOSITORY = motore.repository;
  VENDOR = path.join(ROOT, "vendor", id);
  LOCK = path.join(VENDOR, "upstream.lock");
  PATCHES = path.join(VENDOR, "patches");
  MANAGED = motore.gestiti;
}

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
    `# La provenienza della copia di ${NOME}, per \`tools/vendor-craft/vendor.mjs\`.`,
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

/// Il workspace a cui i crate del motore appartengono: quello di `vendor/` se c'è,
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
        problems.push(`${name}: ${version} in vendor/${ID}, ${fub.get(name)} in Fub`);
      }
    }
  }
  return problems;
}

/// Le righe che portano la versione dell'upstream: le `<motore>-*` del
/// `Cargo.toml` di Fub e, in quello di `vendor/<motore>/`, le stesse righe e la
/// versione di `[workspace.package]`. Una dipendenza a percorso senza versione
/// è un carattere jolly per `cargo deny`.
function versionRules() {
  return [
    ["Cargo.toml", new RegExp(`^(${ID}-[a-z]+ = \\{ path = "vendor\\/${ID}\\/crates\\/[a-z]+", version = ")([^"]+)(" \\})$`, "gm")],
    [`vendor/${ID}/Cargo.toml`, new RegExp(`^(${ID}-[a-z]+ = \\{ path = "crates\\/[a-z]+", version = ")([^"]+)(" \\})$`, "gm")],
    [`vendor/${ID}/Cargo.toml`, /^(\[workspace\.package\][^[]*?\nversion = ")([^"]+)(")$/gm],
  ];
}

/// Per ogni regola, il file e le versioni che vi trova.
function versionLines() {
  return versionRules().map(([rel, line]) => {
    const file = path.join(ROOT, rel);
    const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    return { rel, versions: [...text.matchAll(line)].map((m) => m[2]) };
  });
}

function writeVersions(version) {
  for (const [rel, line] of versionRules()) {
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
      if (version !== lock.version) problems.push(`${rel}: ${ID} a ${version}, il lock dice ${lock.version}`);
    }
    if (versions.length === 0) problems.push(`${rel}: nessuna riga con la versione di ${ID} riconosciuta`);
  }
  problems.push(...checkManifests(VENDOR));

  if (problems.length > 0) {
    fs.rmSync(dir, { recursive: true, force: true });
    fail(`la copia di ${NOME} non è l'upstream ${lock.rev.slice(0, 12)} più le patch:\n- ${problems.join("\n- ")}`);
  }
  if (!quiet) {
    console.log(`vendor/${ID}: upstream ${lock.rev.slice(0, 12)} più ${lock.patch.length} patch, ${listed.size} file verificati.`);
  }
  return { lock, upstream: dir };
}

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

function update(rev, source, tag) {
  // La prima volta non c'è un lock: la copia di prima è quella fatta a mano, e
  // il diff di git dice se il risultato la riproduce.
  // Senza lock, il repository dell'upstream è quello di `motori.mjs`.
  const old = fs.existsSync(LOCK) ? readLock() : { repository: REPOSITORY, mirror: "", rev: "", file: [] };
  if (old.rev) untouched(old);
  const repo = repository(source ?? old.repository, rev);
  const moved = tag ? tagged(repo, tag, rev) : null;
  if (moved) fail(moved);
  // L'upstream di prima si rilegge alla sua revisione: la pila di patch può
  // essere cambiata da allora.
  const previous = { lock: old, upstream: old.rev ? extract(repo, old.rev).dir : tempdir("none") };
  const { dir, date, version } = extract(repo, rev);

  // Il risultato si costruisce a parte; la copia si sostituisce alla fine.
  const result = tempdir("result");
  copyManaged(dir, result);
  applyStack(result, patchFiles());

  const changes = dependencyChanges(previous.upstream, dir);
  const problems = checkManifests(result);
  if (problems.length > 0) fail(`le dipendenze non tornano:\n- ${problems.join("\n- ")}`);

  const upstream = hashes(dir);
  const patched = hashes(result);
  const lock = {
    repository: previous.lock.repository,
    mirror: previous.lock.mirror ?? "",
    rev,
    tag: tag ?? "",
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
  console.log(`vendor/${ID}: da ${from} a ${rev.slice(0, 12)} (${date}, ${version}).`);
  console.log(`file dell'upstream cambiati: ${changed.length}; patch applicate: ${lock.patch.length}.`);
  if (changes.length > 0) {
    console.log("dipendenze da rivedere (licenza, avvisi):");
    for (const c of changes) console.log(`  ${c}`);
  }
  console.log(`passi successivi: cargo test del workspace e dei motori, il corpus, cargo deny check (vedi vendor/${ID}/UPSTREAM.md).`);
}

/// Le dipendenze dirette che i crate gestiti aggiungono o tolgono fra due
/// estrazioni dell'upstream.
function dependencyChanges(beforeDir, afterDir) {
  const before = new Map();
  for (const rel of managedFiles(beforeDir).filter((f) => f.endsWith("/Cargo.toml"))) {
    before.set(rel, dependencies(fs.readFileSync(path.join(beforeDir, rel), "utf8")));
  }
  const changes = [];
  for (const rel of managedFiles(afterDir).filter((f) => f.endsWith("/Cargo.toml"))) {
    const after = dependencies(fs.readFileSync(path.join(afterDir, rel), "utf8"));
    const old = before.get(rel) ?? new Set();
    const crate = rel.split("/")[1];
    for (const dep of after) if (!old.has(dep)) changes.push(`${ID}-${crate}: + ${dep}`);
    for (const dep of old) if (!after.has(dep)) changes.push(`${ID}-${crate}: - ${dep}`);
  }
  return changes;
}

/// I file che una patch tocca, dalle sue intestazioni `diff --git`.
function touchedBy(patch) {
  const text = fs.readFileSync(path.join(VENDOR, patch), "utf8");
  const out = new Set();
  for (const m of text.matchAll(/^diff --git a\/(\S+) b\/(\S+)$/gm)) {
    out.add(m[1]);
    out.add(m[2]);
  }
  return [...out].sort();
}

/// `git apply --check` di `patch` in `dir`, al contrario con `reverse`.
function applies(dir, patch, reverse = false) {
  const args = ["apply", "--check", "--whitespace=nowarn", ...(reverse ? ["-R"] : []), path.join(VENDOR, patch)];
  const run = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  return { ok: run.status === 0, why: run.stderr.trim().split("\n")[0] ?? "" };
}

/// La `rust-version` e le dipendenze del workspace del Cargo.toml radice
/// dell'upstream a `rev`.
function upstreamWorkspace(repo, rev) {
  const manifest = git(["-C", repo, "show", `${rev}:Cargo.toml`]).toString();
  return {
    rust: /\nrust-version = "([^"]+)"/.exec(manifest)?.[1] ?? "?",
    dependencies: workspaceDependencies(manifest),
  };
}

function report(rev, source) {
  const lock = readLock();
  const repo = repository(source ?? lock.repository, rev);
  const previous = extract(repo, lock.rev);
  const next = extract(repo, rev);
  const before = hashes(previous.dir);
  const after = hashes(next.dir);
  const changedUpstream = new Set(
    [...new Set([...before.keys(), ...after.keys()])].filter((rel) => before.get(rel) !== after.get(rel)),
  );
  console.log(`vendor/${ID}: da ${lock.rev.slice(0, 12)} (${lock.version}) a ${rev.slice(0, 12)} (${next.date}, ${next.version}), a vuoto.`);
  console.log(`file gestiti che l'upstream cambia: ${changedUpstream.size}.`);

  // Ogni patch da sola sui file nuovi, e la pila nell'ordine: una patch che
  // non si applica si salta, e le successive si provano lo stesso.
  git(["init", "-q"], { cwd: next.dir });
  const stack = tempdir("pila");
  copyManaged(next.dir, stack);
  git(["init", "-q"], { cwd: stack });
  const rows = [];
  let failing = 0;
  let absorbedCount = 0;
  for (const patch of patchFiles()) {
    const alone = applies(next.dir, patch);
    const absorbed = !alone.ok && applies(next.dir, patch, true).ok;
    const inStack = applies(stack, patch);
    if (inStack.ok) git(["apply", "--whitespace=nowarn", path.join(VENDOR, patch)], { cwd: stack });
    const touched = touchedBy(patch).filter((rel) => changedUpstream.has(rel));
    let state;
    if (inStack.ok) state = "si applica";
    else if (absorbed) state = "assorbita dall'upstream: si può togliere";
    else if (alone.ok) state = "si applica da sola, non sulla pila";
    else state = `non si applica: ${inStack.why}`;
    if (!inStack.ok && absorbed) absorbedCount += 1;
    else if (!inStack.ok) failing += 1;
    rows.push({ patch, state, touched });
  }
  for (const { patch, state, touched } of rows) {
    console.log(`  ${patch}: ${state}`);
    if (touched.length > 0) console.log(`    file che l'upstream ha cambiato: ${touched.join(", ")}`);
  }
  fs.rmSync(path.join(stack, ".git"), { recursive: true, force: true });
  const problems = failing + absorbedCount === 0 ? checkManifests(stack) : [];
  for (const p of problems) console.log(`  manifest: ${p}`);

  const changes = dependencyChanges(previous.dir, next.dir);
  console.log(changes.length > 0 ? "dipendenze da rivedere (licenza, avvisi):" : "dipendenze dirette: invariate.");
  for (const c of changes) console.log(`  ${c}`);
  const was = upstreamWorkspace(repo, lock.rev);
  const now = upstreamWorkspace(repo, rev);
  if (was.rust !== now.rust) console.log(`rust-version dell'upstream: ${was.rust} → ${now.rust} (Fub resta su quella di rust-toolchain.toml).`);
  for (const name of new Set([...was.dependencies.keys(), ...now.dependencies.keys()])) {
    const [a, b] = [was.dependencies.get(name), now.dependencies.get(name)];
    if (a !== b) console.log(`  workspace: ${name} ${a ?? "-"} → ${b ?? "-"}`);
  }
  for (const d of [previous.dir, next.dir, stack]) fs.rmSync(d, { recursive: true, force: true });
  const ready = failing + absorbedCount === 0 && problems.length === 0;
  if (ready) console.log(`la pila si applica: \`update --rev ${rev}\`, poi \`${ID} gate\`.`);
  if (absorbedCount > 0) console.log(`${absorbedCount} patch da togliere (e da togliere da UPSTREAM.md) prima di \`update\`.`);
  if (failing > 0) console.log(`${failing} patch da rifare sui file nuovi prima di \`update\` (vedi vendor/${ID}/UPSTREAM.md).`);
  return ready;
}

/// Le prove di `motori.mjs` per il motore, una dopo l'altra.
function gate() {
  const steps = MOTORI[ID].gate ?? [];
  if (steps.length === 0) fail(`motori.mjs non elenca le prove di ${ID}`);
  const results = [];
  for (const [label, command, ...args] of steps) {
    console.log(`\n== ${label}: ${command} ${args.join(" ")}`);
    const started = Date.now();
    const run = spawnSync(command, args, { cwd: ROOT, stdio: "inherit" });
    results.push({ label, ok: run.status === 0, seconds: Math.round((Date.now() - started) / 1000) });
  }
  console.log(`\nprove di ${NOME}:`);
  for (const { label, ok, seconds } of results) console.log(`  ${ok ? "ok    " : "FALLITA"} ${label} (${seconds} s)`);
  return results.every((r) => r.ok);
}

/// Il tag `tag` dell'upstream punta a `rev`.
function tagged(repo, tag, rev) {
  const at = spawnSync("git", ["rev-parse", "--verify", "--quiet", `refs/tags/${tag}^{commit}`], { cwd: repo, encoding: "utf8" });
  if (at.status !== 0) return `il tag ${tag} non c'è nell'upstream`;
  if (at.stdout.trim() !== rev) return `il tag ${tag} punta a ${at.stdout.trim().slice(0, 12)}, non a ${rev.slice(0, 12)}`;
  return null;
}

function verifyUpstream(source) {
  const local = check({ quiet: true });
  const sources = [source ?? local.lock.repository, ...(source || !local.lock.mirror ? [] : [local.lock.mirror])];
  for (const from of sources) {
    const repo = repository(from, local.lock.rev);
    const { dir } = extract(repo, local.lock.rev);
    const problems = [];
    const moved = local.lock.tag ? tagged(repo, local.lock.tag, local.lock.rev) : null;
    if (moved) problems.push(moved);
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

const USO =
  "uso: vendor.mjs <motore> update --rev <sha> [--tag <tag>] [--source <percorso o URL>] | [<motore>] check | <motore> verify-upstream [--source <percorso o URL>] | <motore> report --rev <sha> [--source <percorso o URL>] | <motore> gate";

try {
  const argv = process.argv.slice(2);
  if (argv[0] === "check" && argv.length === 1) {
    // Tutti i motori, uno dopo l'altro: il primo che non torna ferma.
    for (const id of Object.keys(MOTORI)) {
      scegli(id);
      fs.rmSync(check().upstream, { recursive: true, force: true });
    }
    done();
    process.exit(0);
  }
  const [id, command, ...args] = argv;
  if (!id) fail(USO);
  scegli(id);
  if (command === "check") {
    fs.rmSync(check().upstream, { recursive: true, force: true });
  } else if (command === "update") {
    const rev = option(args, "--rev") ?? fail("update vuole --rev <sha>");
    update(rev, option(args, "--source"), option(args, "--tag"));
  } else if (command === "verify-upstream") {
    verifyUpstream(option(args, "--source"));
  } else if (command === "report") {
    const rev = option(args, "--rev") ?? fail("report vuole --rev <sha>");
    if (!report(rev, option(args, "--source"))) process.exitCode = 1;
  } else if (command === "gate") {
    if (!gate()) process.exitCode = 1;
  } else {
    fail(USO);
  }
} catch (error) {
  done();
  if (!(error instanceof Failure)) throw error;
  console.error(error.message);
  process.exit(1);
}
done();
