#!/usr/bin/env node
// Inside a race you do not wait in secret.
//
// The defect was measured, and it was the same sentence written in many places:
// *my answer has expired and I do not notice*. The fix is
// `frontend/src/ui/race.ts`: `awaited` is the only way the body of a race
// obtains the result of a wait, and if in the meantime a newer one has started
// the body ends there instead of reaching a write.
//
// That half is handled by the compiler: to have `awaited` you must already be
// inside a `last(…)`, and there is no way to fabricate it elsewhere. This
// guard takes the other half — *no one bypasses the gateway from inside* —
// and there are two ways, both seen while writing decision 0134:
//
//  1. **A bare `await`.** Waiting without going through `awaited` is the line
//     the entire form exists to prevent: from there on the body continues with
//     a result that no one has dated.
//  2. **A `} catch` inside the body.** It is the *unintentional* way, and it
//     is the one that matters: a `catch` written for real errors also swallows
//     the expiry signal, and from there the body resumes and writes. It is not
//     theoretical — all four hand-written implementations that 0134 replaced
//     had a `try` around the call, because all four had to say something when
//     the call failed. The right idiom is the error becoming a value
//     **before** the gate: `await awaited(p.catch(…))`.
//
// # The blind spots, declared
//
// A guard is blind to what it has not been told to watch, and these are the
// known ways to bypass it. The first is the big one, and must be written in
// full because it is more serious than all the others combined:
//
//  1. **Who opens no race.** This guard watches *inside* `last` calls, so it
//     has nothing to say about a function that waits and then writes without
//     ever naming a race — which is exactly the original defect. Saying so
//     would mean knowing which `await`s are followed by a write, i.e. reading
//     types, and here text is read. The census of 0134 counted **thirty-nine**
//     in `frontend/src/`, and this pass closes part of them: the list is in
//     the decision record, and until it is empty it is the list of what this
//     guard does not see.
//  2. **`.then(…)` instead of `await`.** A continuation attached with `.then`
//     is not an `await` and is not watched: it is the only way to wait inside
//     a race without this guard noticing, and it was verified by constructing
//     one on purpose. It remains uncovered because covering it would mean
//     following the value, and here text is read.
//  3. **Benches.** `*.test.ts` is excluded: `race.test.ts` must be able to
//     construct the cases that here are violations.
//
// And two things that are **not** blind spots, written because the first draft
// of this comment said they were, and testing them proved otherwise:
//
//  - **The alias** (`const a = awaited; await a(p)`) does not escape: the
//    criterion is not "an alias exists" but "the name appears in the awaited
//    expression", so an alias becomes a **violation**, not a hole. It is
//    stricter than how it was described, and rightly so: `awaited` has no
//    reason to change name.
//  - **The word inside a comment** inside a race body counts as a wait and
//    makes the count red. It is a false positive, it errs toward red, and it
//    is removed by rewriting the comment — which costs less than teaching this
//    file where comments end.
//
// What this guard does **not** say, and must not say: that every `await` of
// `frontend/src/` is inside a race. It is not true and must not become true —
// most waits have nothing to date, and forcing them all would make the
// gateway a noise to bypass instead of a rule.
//
// Usage:
//   node .github/scripts/check-races.mjs [root]
// Exit code 1 if there is at least one violation, 0 otherwise.
//
// No npm dependencies, like the other guards in this folder.

import fs from "node:fs";
import path from "node:path";

// The only file that may write `await` without `awaited` inside a `last`: it
// is the gateway itself. Path relative to the repo root.
const LA_PORTA = "frontend/src/ui/race.ts";

const radice = process.argv[2] ?? process.cwd();

// All `.ts` of `frontend/src/` that are not benches.
function sorgenti(dir, out = []) {
  for (const voce of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, voce.name);
    if (voce.isDirectory()) {
      if (voce.name !== "node_modules") sorgenti(p, out);
    } else if (voce.name.endsWith(".ts") && !voce.name.endsWith(".test.ts")) {
      out.push(p);
    }
  }
  return out;
}

// From `opening` (the index of the `{` that opens the body) to the index of
// the `}` that closes it. Counts braces only: a `{` inside a string or
// comment would get it wrong, and it is a fifth blind spot that in practice
// does not occur because race bodies are short.
function fineDelCorpo(testo, apertura) {
  let livello = 0;
  for (let i = apertura; i < testo.length; i++) {
    if (testo[i] === "{") livello++;
    else if (testo[i] === "}") {
      livello--;
      if (livello === 0) return i;
    }
  }
  return testo.length;
}

// The expression that an `await` waits for: from after the word to the close
// of its first parenthesized group, or to end of line if none is opened.
function espressioneAttesa(corpo, dopoAwait) {
  const resto = corpo.slice(dopoAwait + "await".length);
  const apre = resto.indexOf("(");
  const fineRiga = resto.indexOf("\n");
  if (apre === -1 || (fineRiga !== -1 && fineRiga < apre)) {
    return resto.slice(0, fineRiga === -1 ? resto.length : fineRiga);
  }
  let livello = 0;
  for (let i = apre; i < resto.length; i++) {
    if (resto[i] === "(") livello++;
    else if (resto[i] === ")") {
      livello--;
      if (livello === 0) return resto.slice(0, i + 1);
    }
  }
  return resto;
}

const violazioni = [];

for (const file of sorgenti(path.join(radice, "frontend", "src"))) {
  const relativo = path.relative(radice, file).split(path.sep).join("/");
  if (relativo === LA_PORTA) continue;
  const testo = fs.readFileSync(file, "utf8");

  // `.last(async (NAME) => {` — the parameter name is read, so a body that
  // calls it differently is still covered.
  const apre = /\.ultimo\(\s*async\s*\(\s*([A-Za-z_$][\w$]*)\s*\)\s*=>\s*\{/g;
  let m;
  while ((m = apre.exec(testo)) !== null) {
    const nome = m[1];
    const inizio = m.index + m[0].length - 1;
    const fine = fineDelCorpo(testo, inizio);
    const corpo = testo.slice(inizio, fine);
    const rigaDi = (offset) => testo.slice(0, inizio + offset).split("\n").length;

    for (const a of corpo.matchAll(/\bawait\b/g)) {
      // The wait is fine in two ways, and the second is what makes the form
      // inheritable: it either goes through `awaited`, or it **delivers
      // `awaited`** to whoever waits on its behalf (which is what
      // `updatePreview` does with embed hydration, where most preview waits
      // live). The criterion is the same for both: the name appears inside
      // the awaited expression.
      if (new RegExp(`\\b${nome}\\b`).test(espressioneAttesa(corpo, a.index))) continue;
      violazioni.push(
        `${relativo}:${rigaDi(a.index)}: an \`await\` that does not name \`${nome}\` ` +
          `inside a race: the result is not dated by anyone.`,
      );
    }
    for (const c of corpo.matchAll(/\}\s*catch\b/g)) {
      violazioni.push(
        `${relativo}:${rigaDi(c.index)}: a \`catch\` inside a race swallows the ` +
          `expiry too. The error becomes a value before the gate: ` +
          `\`await ${nome}(promise.catch(…))\`.`,
      );
    }
  }
}

for (const v of violazioni) console.error(v);
console.log(
  violazioni.length === 0
    ? "check-races: no one bypasses the gateway."
    : `check-races: ${violazioni.length} violations.`,
);
process.exit(violazioni.length === 0 ? 0 : 1);
