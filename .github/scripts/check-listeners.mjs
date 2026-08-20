#!/usr/bin/env node
// A listener on `document` or `window` has an owner, and the owner is a
// `Lifetime`.
//
// The defect was measured, and it was **six times the same line**: the context
// menu that puts a `click` on `document` inside a `setTimeout` and closes with
// Escape before it fires; the icon selector that removes the node from under
// itself leaving the listener and the focus trap hanging; the focus trap itself;
// and the three global listens for the theme, the locale, and the keyboard.
// None of them was wrong from carelessness: they were six places where
// *remembering* the twin `removeEventListener` was the only defense, and a
// defense that must be remembered six times is a defense that is absent at the
// seventh.
//
// The fix is `frontend/src/ui/lifetime.ts`: `listen` is a method of
// `Lifetime`, so you cannot call it without holding the object that also knows
// how to stop. That half is handled by the compiler. This guard takes the
// other half — *no one bypasses the gateway* — because
// `document.addEventListener` is a DOM function and the compiler has no reason
// to reject it.
//
// It is the shape of decision 0125 (the `Gate`) applied to the third side:
// there what circulated in the reconciler was not a handler but a gate, here
// what is passed to a listener is not an `EventTarget` but a lifetime.
//
// # The blind spots, declared
//
// A guard is blind to what it has not been told to watch, and these are the
// known ways to bypass it:
//
//  1. **The alias.** `const d = document; d.addEventListener(…)` is not seen:
//     here text is read, not types. It costs one line written on purpose to
//     hide, and it is the price paid for not having an analyzer.
//  2. **`EventTarget` from outside.** A `target: EventTarget` passed in and
//     then `target.addEventListener(…)` is indistinct from an element. Same
//     reason.
//  3. **Elements.** An `addEventListener` on a node — `$("#new-note")`, a row
//     in the explorer, an `input` — is not watched, and is intentional: that
//     listener dies with the node, and the node dies when whoever created it
//     discards it. This is the species that decision 0079 has already closed
//     from the other side. The exception within the exception — an element
//     that lives as long as the page, like `document.body` — is covered,
//     because the node there never dies.
//  4. **Benches.** `*.test.ts` is excluded: a bench is built and its DOM is
//     discarded, and forcing it through the gateway would make the test depend
//     on what it tests.
//
// What this guard does **not** say, and must not say: that every
// `addEventListener` has a twin `removeEventListener`. That is the promise
// repeated, which is exactly what is being escaped from: counting occurrences
// would let through someone who writes two and calls one.
//
// Usage:
//   node .github/scripts/check-listeners.mjs [root]
// Exit code 1 if there is at least one violation, 0 otherwise.
//
// No npm dependencies, like the other guards in this folder.

import fs from "node:fs";
import path from "node:path";

// The only file that may touch `addEventListener` on global targets: it is
// the gateway. Path relative to the repo root.
const LA_PORTA = "frontend/src/ui/lifetime.ts";

// The folder scanned.
const SORGENTI = "frontend/src";

// The targets that live as long as the page: whoever puts a listener on them
// without saying for how long is putting it there forever.
const BERSAGLI = [
  "document",
  "window",
  "globalThis",
  "self",
  "document.body",
  "document.documentElement",
];

// Lines that register on a global target.
//
// `matchMedia` is separate because the target is the return value of a call,
// not a name: `window.matchMedia(q).addEventListener("change", …)` is a
// listen that lasts as long as the page, exactly like the others.
function violazioni(testo) {
  const nomi = BERSAGLI.map((b) => b.replace(".", "\\s*\\.\\s*")).join("|");
  const globale = new RegExp(String.raw`(?<![.\w])(${nomi})\s*\.\s*addEventListener\b`);
  const media = /matchMedia[\s\S]*?\.\s*addEventListener\b/;
  const fuori = [];
  const righe = testo.split("\n");
  for (let i = 0; i < righe.length; i++) {
    const riga = righe[i];
    if (globale.test(riga) || media.test(riga)) fuori.push({ n: i + 1, riga: riga.trim() });
  }
  return fuori;
}

// All `.ts` under a folder, excluding benches.
function sorgenti(dir, dentro = []) {
  for (const voce of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, voce.name);
    if (voce.isDirectory()) sorgenti(p, dentro);
    else if (voce.name.endsWith(".ts") && !voce.name.endsWith(".test.ts")) dentro.push(p);
  }
  return dentro;
}

const radice = process.argv[2] ?? ".";
const base = path.join(radice, SORGENTI);
if (!fs.existsSync(base)) {
  console.error(`cannot find ${base}: pass the repo root as an argument.`);
  process.exit(2);
}

let problemi = 0;
let visti = 0;
for (const file of sorgenti(base).sort()) {
  const rel = path.relative(radice, file).split(path.sep).join("/");
  if (rel === LA_PORTA) continue;
  visti++;
  for (const v of violazioni(fs.readFileSync(file, "utf8"))) {
    problemi++;
    console.error(`${rel}:${v.n}: global listener without a Lifetime`);
    console.error(`  ${v.riga}`);
  }
}

if (problemi > 0) {
  console.error("");
  console.error(
    `${problemi} global listeners registered outside ${LA_PORTA}. Whoever listens`,
  );
  console.error(
    "on `document` or `window` must say for how long: `lifetime.listen(document, …)`,",
  );
  console.error("with a `Lifetime` that someone owns and closes.");
  process.exit(1);
}

console.log(`${visti} sources: every global listener goes through a Lifetime.`);
