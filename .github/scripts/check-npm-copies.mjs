#!/usr/bin/env node
// In the shell dependency tree a package has **one** copy.
//
// The defect that prompted this guard was written as: *"`basicSetup` from
// `codemirror` next to imports from `@codemirror/*`: two copies of the state
// one update apart"*. Measured, and the measurement changed the fix: the copies
// of `@codemirror/state` today are **one**. `npm ls @codemirror/state` returns
// `6.7.1` and eleven `deduped` entries, and the lock has **no**
// `node_modules/x/node_modules/y` — npm flattened everything, because the
// direct dependency asks for `^6.5.0` and `codemirror` asks for `^6.0.0`, i.e.
// two ranges a single version satisfies.
//
// So the defect is not "there are two": it is "there could become two, and the
// day it happens no one notices". They are two different defects and they are
// fixed differently — the first by removing an import, the second with a guard
// — and this is the second.
//
// It is worth it because the break is **silent**. `@codemirror/state` carries
// `Facet` and `StateField` instances whose identity is the object itself: two
// copies of the module are two sets of identities, and an extension built with
// one is not seen by the configuration built with the other. It is not a type
// error (the shapes are identical) and not an exception: it is an editor where
// the live preview or the theme simply does nothing, and the cause is a
// `node_modules` tree.
//
// The rule written here is wider than the case that created it — *no package,
// ever, in two copies* — and it is wider on purpose: the same silent break
// exists in every library that holds state or module identity, and a guard that
// named `@codemirror/state` would have been written for yesterday's defect.
// Today the tree is already clean, so the guard costs nothing and becomes red
// the day an `npm install` separates something.
//
// # The blind spot, declared
//
// It checks the **lock**, not `node_modules/`: it tells what will be installed,
// not what is on disk for whoever runs it. That is the right direction — it is
// the lock that ends up in the commit — but it does not catch a tree installed
// by hand that has diverged from the lock. And it says nothing about
// **versions**: two different packages that carry the same code (`lodash` and
// `lodash-es`) are two packages, and this guard sees them as such.
//
// What to do when it turns red: **do not** widen the list. Either align the
// ranges in `package.json` so npm can re-flatten, or — if the two versions are
// truly incompatible — declare the second copy in `DUPLICATE_PACKAGES` with the
// reason it breaks nothing beside it. Every entry there is a tree where a
// module exists twice.
//
// Usage:
//   node .github/scripts/check-npm-copies.mjs [path to package-lock.json]
// Exit code 1 if there is at least one package in two copies, 0 otherwise.
//
// No npm dependencies, like the other guards in this folder.

import fs from "node:fs";

// Packages that may exist in the tree in more than one copy, each with the
// reason. Empty is the correct state.
const DUPLICATE_PACKAGES = new Map([
  // ["name", "why two copies here break nothing"],
  [
    "fsevents",
    "is the **optional** dependency that exists only on macOS (`os: darwin`), " +
      "and on Linux and Windows npm does not install it at all: the second copy " +
      "is what playwright brings along. It holds no state or identity — every " +
      "copy is a thin wrapper around its own `.node` binary, and whichever " +
      "folder a watcher looks at receives its own events from its own watcher. " +
      "It is the opposite of the case this guard exists for: `@codemirror/state` " +
      "in two copies means two sets of identities for `Facet`, and extensions " +
      "built with one do not see the configuration of the other.",
  ],
]);

const lock = process.argv[2] ?? "frontend/package-lock.json";
if (!fs.existsSync(lock)) {
  console.error(`cannot find ${lock}: pass it as an argument.`);
  process.exit(2);
}

const dati = JSON.parse(fs.readFileSync(lock, "utf8"));
if (typeof dati.packages !== "object") {
  console.error(`${lock} has no "packages" section: a v2 or v3 lockfile is required.`);
  process.exit(2);
}

// The name of a package from its path in the tree: the last segment after the
// last `node_modules/`. The root (empty key) is not an installed package and
// is excluded.
function nomeDi(percorso) {
  const i = percorso.lastIndexOf("node_modules/");
  return i < 0 ? null : percorso.slice(i + "node_modules/".length);
}

const copie = new Map();
for (const [percorso, voce] of Object.entries(dati.packages)) {
  const nome = nomeDi(percorso);
  if (nome === null) continue;
  // A `link` is not a copy: it is a pointer to a workspace that already exists
  // in the tree with its real path.
  if (voce.link === true) continue;
  const dove = copie.get(nome);
  if (dove) dove.push({ percorso, versione: voce.version });
  else copie.set(nome, [{ percorso, versione: voce.version }]);
}

let problemi = 0;
for (const [nome, dove] of [...copie].sort()) {
  if (dove.length < 2) continue;
  const reason = DUPLICATE_PACKAGES.get(nome);
  if (reason) {
    console.log(`${nome}: ${dove.length} copies, declared — ${reason}`);
    continue;
  }
  problemi++;
  console.error(`${nome}: ${dove.length} copies in the tree`);
  for (const d of dove) console.error(`  ${d.versione ?? "?"} in ${d.percorso}`);
}

if (problemi > 0) {
  console.error("");
  console.error(
    `${problemi} packages in more than one copy. Two copies of a module that holds`,
  );
  console.error(
    "state or identity are two worlds that cannot see each other, and the break is silent:",
  );
  console.error(
    "align the ranges in package.json, or declare the second copy in",
  );
  console.error(`DUPLICATE_PACKAGES with the reason it breaks nothing.`);
  process.exit(1);
}

console.log(`${copie.size} packages in ${lock}: none in two copies.`);
