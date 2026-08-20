#!/usr/bin/env node
// **The prose that speaks about the sources** (§16.8): the numbers it asserts
// and the guarantees it declares.
//
// The reason it exists is the same as `check-doc-links.mjs`, one level up.
// There the defect was a link to a file that no longer exists; here it is a
// sentence saying «the fourteen families» when the families are seventeen. A
// broken link at least shows when you click it; a wrong number is read,
// believed, and built upon — and nobody re-checks it, because the point of
// writing a count is to stop having to count.
//
// That it is a family and not an accident is told by the census of §16.8: a
// dedicated pass found false numbers of the `HostApi` (declared to have
// twenty-three methods and thirty-two **in the same file**, while the contract
// has thirty-four), two `SCHEMA_VERSION`s on disk, the capabilities of a test
// bench, the gate families written three times, the conformance bench
// functions. None of these ever broke a test.
//
// And there is a species worse than aging, which the census found twice: the
// number **false on the day it was written**. It happens whenever a count is
// written by hand in the same commit that changes what it counts — you
// measure, you write, and in between a line is added. An aged number is
// updated; one that was never derived from its source is updated and comes
// back false the round after. That is why this guard does not keep the
// values: it keeps the **commands**.
//
// The shape. A number that asserts something about the sources is written
// next to how it is derived:
//
//     the **fourteen** capability families [count: guard-families]
//
// The command lives in `counts.mjs`, once, with its reason beside it; the
// prose cites it by name as often as it wants. Same shape as the
// `rules_mirror.rs` → `rules-samples.json` of decision 0020, applied to prose
// instead of rules: **one place to write it, two to read it**.
//
// The annotation is plain text on purpose. An `<!-- … -->` would work in
// `.md` files and nowhere else, and half of it would be missing: the first
// falsity the census found lived in a comment of `guard.rs`, i.e. in the
// **same file** as the code it described. The distance between the sentence
// and the thing is not the reason a sentence ages.
//
// **And the second check, which is not a count.** The census found a species
// that beats all the others: the *declared guarantee that never existed* — a
// session header said a certain thing «would violate the invariant that
// `dependency_invariant.rs` guards», and that file never named the crate in
// question anywhere. The other species are an aged description of something
// that exists; this one is not, and there is nothing to update because there
// never was anything. Nobody notices, because **the point of writing a
// guarantee is to stop having to think about it**: a count is eventually
// re-counted by someone, a net believed to be tight is watched by nobody.
//
// The guard is the same bed read backwards — not «recount», but **a sentence
// that says *this is guarded by X* must name an X that exists** — and a test
// name is a thing that is searched mechanically. Nothing needs annotating
// here: the sentence already says «guard» and the name is already between
// backticks.
//
// Usage:
//   node .github/scripts/check-prose.mjs [folder]
//   node .github/scripts/check-prose.mjs --self-test
// Exit code 1 if a number does not match, if a register entry is cited by no
// one, if a guarantee names a test that does not exist, or if there is
// nothing to check.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { COUNTS } from "./counts.mjs";

// The annotation, and the tail of the line where the number is looked for.
const RE_ANNOTATION = /\[count:\s*([a-z0-9-]+)\s*\]/g;

// ---------------------------------------------------------------------------
// The numbers written in English
// ---------------------------------------------------------------------------
//
// Why: these documents write numbers **in words**. «The fourteen families»,
// «a third crate for eight functions», «thirty-four today». A guard that
// could only read `14` would not watch prose — it would watch the tables,
// which are the part that ages the least.

const ONES = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
];
const TEENS = [
  "ten", "eleven", "twelve", "thirteen", "fourteen",
  "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
];
const TENS = [
  null, null, "twenty", "thirty", "forty", "fifty",
  "sixty", "seventy", "eighty", "ninety",
];

/** Word → value, from zero to ninety-nine, hyphens included. */
function numberTable() {
  const table = new Map();
  ONES.forEach((n, i) => table.set(n, i));
  TEENS.forEach((n, i) => table.set(n, 10 + i));

  for (let d = 2; d <= 9; d += 1) {
    const tens = TENS[d];
    table.set(tens, d * 10);
    for (let u = 1; u <= 9; u += 1) {
      // The English compound keeps the hyphen in print (twenty-one); the
      // unhyphenated form is accepted too, in case prose writes it that way.
      table.set(`${tens}-${ONES[u]}`, d * 10 + u);
      table.set(`${tens} ${ONES[u]}`, d * 10 + u);
    }
  }

  return table;
}

const NUMBERS = numberTable();

/**
 * The last number written before the annotation, or `null` if there is none.
 *
 * «Last» and not «first» because the sentence carrying the number often
 * carries others too («3400 lines of which 1697 of comment»), and the
 * annotation sits right after the one it guards.
 */
function numberBefore(text) {
  // Away with the emphasis and the code spans: `**fourteen**` is fourteen.
  const clean = text.replace(/[*_`]/g, "");
  let last = null;

  // Digits admit the thousand separator written as a space («18 058»),
  // which is how this repo writes them.
  for (const m of clean.matchAll(/\d[\d  ]*\d|\d/g)) {
    last = { value: Number(m[0].replace(/[^\d]/g, "")), written: m[0], end: m.index + m[0].length };
  }
  for (const m of clean.matchAll(/[A-Za-z]+(?:-[A-Za-z]+)?/g)) {
    const value = NUMBERS.get(m[0].toLowerCase());
    if (value === undefined) continue;
    const end = m.index + m[0].length;
    if (last === null || end > last.end) last = { value, written: m[0], end };
  }

  return last;
}

// ---------------------------------------------------------------------------
// The files to watch
// ---------------------------------------------------------------------------

/**
 * The files git tracks where prose makes sense: the documents and the
 * sources. Through git and not the disk, because what is not tracked is not
 * prose of this repo, and a build tree must not be watched.
 */
function trackedFiles(root) {
  const result = spawnSync(
    "git",
    ["-C", root, "ls-files", "-z", "--", "*.md", "*.rs", "*.ts", "*.tsx", "*.wit", "*.toml"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (result.error || result.status !== 0) return null;
  return result.stdout.split("\0").filter(Boolean).map((r) => path.resolve(root, r));
}

// ---------------------------------------------------------------------------
// The count
// ---------------------------------------------------------------------------

/** Runs the command of an entry and derives its number. */
function count(entry, root) {
  const result = spawnSync("sh", ["-c", entry.command], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) return { error: String(result.error.message) };
  if (result.status !== 0) {
    return { error: `the command exited with ${result.status}: ${result.stderr.trim()}` };
  }
  const output = result.stdout.trim();
  if (!/^\d+$/.test(output)) {
    return { error: `the command did not print a single number, but «${output.slice(0, 80)}»` };
  }
  return { value: Number(output) };
}

// ---------------------------------------------------------------------------
// The guarantees that prose declares
// ---------------------------------------------------------------------------

// The words that declare a guarantee. Not every sentence is watched: a
// document names a hundred functions, and half of them are the ones that do
// not exist yet, which is the point of naming them. What must be true
// **now** is the line that says «this is guarded by X».
const RE_GUARANTEE = /guard|verif|the test|the tests/i;

// A test name: `snake_case` with at least one underscore. It is the shape of
// all the tests of this repo, and it is not the shape of a contract method
// cited in passing — those live in sentences that do not say «guard».
const RE_TEST_NAME = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/;

/** All the `fn`s declared in the sources, as a set of names. */
function sourceFunctions(files) {
  const names = new Set();
  for (const path of files) {
    if (!/\.(rs|ts|tsx)$/.test(path)) continue;
    let text;
    try {
      text = fs.readFileSync(path, "utf8");
    } catch {
      continue;
    }
    // A test bench name is as much an `fn` as the **file** that contains it:
    // prose says «the guard is `wit_conformance`» meaning
    // `crates/fub-abi/tests/wit_conformance.rs`, and it is right. A test
    // file is a name that exists exactly as much as a function.
    names.add(path.basename(path).replace(/\.(rs|ts|tsx)$/, ""));
    for (const m of text.matchAll(/\bfn\s+([a-z_][A-Za-z0-9_]*)/g)) names.add(m[1]);
    for (const m of text.matchAll(/\b(?:function|it|test)\s*\(?\s*["'`]?([a-z_][A-Za-z0-9_]*)/g)) {
      names.add(m[1]);
    }
  }
  return names;
}

/**
 * The test names that a prose line declares as guards and that do not exist
 * in the sources.
 *
 * The name of the file where the test would be is not checked here: it is a
 * link, and links are guarded by `check-doc-links.mjs`. This watches the
 * only thing that one cannot see — that the **name** inside the file is a
 * real `fn`.
 */
function emptyGuarantees(line, functions) {
  if (!RE_GUARANTEE.test(line)) return [];
  const missing = [];
  for (const m of line.matchAll(/`([^`]+)`/g)) {
    const name = m[1];
    if (!RE_TEST_NAME.test(name) || functions.has(name)) continue;
    missing.push(name);
  }
  return missing;
}

// ---------------------------------------------------------------------------
// The guard's own test
// ---------------------------------------------------------------------------
//
// It exists for the same reason as the test-of-the-test in `lean_ipc.rs`:
// here the fragile part is not the comparison, it is **the number reader**.
// If `numberBefore` misread «twenty-three», the guard would not scream — it
// would say there is no number, or worse read the previous one and find it
// equal by chance. A guard that turns itself off in silence is the defect
// this entry describes, done to the guard itself.
//
// Runs with `--self-test`, and in CI before the real check.

function selfTest() {
  const cases = [
    ["the fourteen families ", 14],
    ["it counts **twenty-three** ", 23],
    ["twenty-one, twenty-eight and thirty-one: the last wins ", 31],
    ["**one** open entry ", 1],
    ["twenty-one-not-a-word, so the last one here wins: one ", 1],
    ["**thirty-four** today ", 34],
    ["the contract is **18 058** lines ", 18058],
    ["3400 lines of which 1697 of comment ", 1697],
    ["`SCHEMA_VERSION` at 5 ", 5],
    ["ninety capacities ", 90],
    ["eighty-five records ", 85],
    ["no number in here ", null],
    // **Zero is not «no number»**, and the distinction is this reader's:
    // whoever calls it tells `null` (the annotation guards nothing, and that
    // is a problem) from a number worth zero (something that was counted and
    // is not there, the normal case of a count that must **go down** — the
    // shell diagnostics got there). If the two were mixed, a zero count
    // would turn red for the wrong reason.
    ["today there are **zero** ", 0],
    // The words that *look* like numbers and are not: none in English, so
    // the case is here to remind that the annotation goes after the number
    // and not at the end of the sentence.
    ["six ", 6],
  ];

  let red = 0;
  for (const [text, expected] of cases) {
    const read = numberBefore(text);
    const value = read === null ? null : read.value;
    if (value !== expected) {
      console.log(`self-test: «${text.trim()}» → ${value}, expected ${expected}`);
      red += 1;
    }
  }

  console.log(`self-test: ${cases.length} cases, ${red} red`);
  process.exit(red > 0 ? 1 : 0);
}

function main() {
  if (process.argv.includes("--self-test")) selfTest();
  const root = path.resolve(process.argv[2] ?? process.cwd());
  const files = trackedFiles(root);
  const problems = [];

  if (files === null) {
    console.log("git does not answer here: the prose of this repo cannot be told apart.");
    process.exit(1);
  }

  // First the counts, once each: the same entry is cited from several places.
  const values = new Map();
  for (const entry of COUNTS) {
    const result = count(entry, root);
    if (result.error) {
      problems.push(`register: the entry «${entry.name}» does not count anything — ${result.error}`);
      continue;
    }
    values.set(entry.name, result.value);
  }

  // Then the prose.
  const citations = new Map(COUNTS.map((v) => [v.name, 0]));
  const functions = sourceFunctions(files);
  let total = 0;
  let guarantees = 0;

  for (const file of files) {
    let text;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue; // binary or unreadable: not prose
    }

    const relative = path.relative(root, file);
    const lines = text.split("\n");

    // The guarantees are watched only in documents — inside a source, a
    // function name that does not exist does not pass the compiler — and not
    // in decision records, for the same reason the counts do not watch them:
    // a record is **dated prose**, and it says what was true that day. It is
    // not a loophole: it is the only rule under which a record can tell a
    // name that changed, or cite one to say it did not exist — which is
    // exactly what two of them do, and it is the work this guard continues.
    const record = /docs[\\/]decisions[\\/]/.test(file);
    if (/\.md$/.test(file) && !record) {
      lines.forEach((line, i) => {
        for (const name of emptyGuarantees(line, functions)) {
          guarantees += 1;
          problems.push(
            `${relative}:${i + 1}  says it is guarded by \`${name}\`, which in the sources is no \`fn\``,
          );
        }
      });
    }

    // And the counts are not watched in records either, for the same reason:
    // a record can cite an annotation to show its shape, or write the number
    // of back then. Guarding it would mean asking a dated document to stay
    // true, which is the opposite of what it is.
    if (record || !text.includes("[count:")) continue;

    lines.forEach((line, i) => {
      RE_ANNOTATION.lastIndex = 0;
      let m;
      while ((m = RE_ANNOTATION.exec(line)) !== null) {
        const name = m[1];
        total += 1;
        const where = `${relative}:${i + 1}`;

        if (!values.has(name)) {
          const registered = citations.has(name);
          problems.push(
            `${where}  [count: ${name}] — ` +
              (registered ? "the entry is in the register but did not count" : "no entry with this name in the register"),
          );
          continue;
        }
        citations.set(name, citations.get(name) + 1);

        const number = numberBefore(line.slice(0, m.index));
        if (number === null) {
          problems.push(`${where}  [count: ${name}] — no number before the annotation`);
          continue;
        }
        if (number.value !== values.get(name)) {
          problems.push(
            `${where}  says «${number.written}», but ${name} counts ${values.get(name)}`,
          );
        }
      }
    });
  }

  // And the direction nobody watches: an entry that no one cites anymore. A
  // register that stays long while the prose shortens stops being a
  // photograph and becomes a memory — and the command it carries keeps
  // running in CI for nothing.
  for (const [name, times] of citations) {
    if (times === 0) {
      problems.push(`register: the entry «${name}» is cited by no prose — remove it or cite it`);
    }
  }

  for (const p of problems) console.log(p);
  if (problems.length > 0) console.log("");
  console.log(
    `${COUNTS.length} counts in the register, ${total} citations in the prose, ` +
      `${guarantees} guarantees naming a nonexistent test, ` +
      `${problems.length} problems total`,
  );

  // Like for links: a guard that has watched nothing is not green, it is
  // off. Here that means the annotation has disappeared from the prose, and
  // the register is counting for itself.
  if (total === 0) {
    console.log("\nno annotation found: the guard is not guarding anything here.");
    process.exit(1);
  }

  process.exit(problems.length > 0 ? 1 : 0);
}

main();
