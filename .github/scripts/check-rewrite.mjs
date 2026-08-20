#!/usr/bin/env node
// What a rewritten text does not have the right to lose.
//
// The reason it exists: the repo is about to have its prose rewritten — and
// **none of the other guards can say whether a rewrite lost a meaning**. They
// count things and verify that links point at existing files: a badly
// rewritten page stays green, because it is fluent, the links are there, and
// the numbers it says are numbers.
//
// No script can judge meaning, and this one does not try. There is however a
// family of errors that is taken mechanically and it is the one that costs
// the most: while a sentence is shortened, **numbers, paths, identifiers,
// links and count markers** disappear. It is the defect of commit `441d376` —
// the prose said «twenty-four» and the column summed twenty-five, in nineteen
// places, for days, without any guard being able to see it, because a box
// has no mechanical criterion and the number was written in words inside a
// sentence.
//
// This count looks at a file **before** and **after** and says what was there
// and is not anymore. It does not look at what was added: adding is always
// allowed.
//
// Usage:
//   node .github/scripts/check-rewrite.mjs [<ref-git>] [file...]
//
// Without arguments: compares with `HEAD` all the `.md` modified in the tree.
// With a ref: the same, against that ref (`node ... HEAD~3`).
// With files: only those.
//
//   --confirm <list>   wanted disappearances, comma-separated. They stay
//                      printed but do not turn red, and going through the
//                      command line leaves a trace of who decided them.
//
// Exit code 1 if something disappeared without confirmation, 0 otherwise. A
// file that did not exist before is not a comparison: it is skipped, and it
// is said so.
//
// **It does not go into the circuit of the other guards.** Those run without
// arguments over the whole repo; this one takes a ref and files, and without
// anything to compare it is red on purpose — a count that has watched
// nothing is off, not green. It is run by hand on every rewrite wave, before
// committing it.
//
// No npm dependencies, like the others: `node:child_process` and `git`.
//
// **What it does not catch, and it is declared**: a fact told in words that
// disappears without taking a number or an identifier with it. A sentence
// that changes meaning while keeping its tokens. A wrong *added* number.
// Those are caught only by whoever reads — and this count serves to leave
// them less to check, not to replace them.
//
// And a precise blind zone, found by trying the count and not deduced: it
// looks at **presence**, not how many times. A token that appears twice in
// the same file and changes in one place only remains present, therefore
// green. It is the price of not turning red every time a repetition is
// removed, which is the gesture of simplification itself — but it must be
// known, because the defect of `441d376` would have been caught only because
// there **all** the nineteen copies said the same wrong number.

import { spawnSync } from "node:child_process";

// ---------------------------------------------------------------------------
// The numbers written in words
// ---------------------------------------------------------------------------

/**
 * Every number from zero to ninety-nine as English writes it.
 *
 * It serves because half the numbers of this repo are not made of digits:
 * «**eighty-seven** defects», «**one hundred forty-two** records», «the
 * families are **seven**». A list generated instead of written by hand,
 * because a hand-written list would have the same three lines of delay the
 * glossary already had.
 *
 * The list stops at ninety-nine: the prose of this repo writes counts in
 * words up to a hundred, and beyond that the digits win (the records are
 * counted as digits in the register).
 */
function numbersInWords() {
  const ones = [
    "zero", "one", "two", "three", "four",
    "five", "six", "seven", "eight", "nine",
  ];
  const teens = [
    "ten", "eleven", "twelve", "thirteen", "fourteen",
    "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
  ];
  const tens = [
    null, null, "twenty", "thirty", "forty",
    "fifty", "sixty", "seventy", "eighty", "ninety",
  ];

  const upTo99 = [];
  for (let n = 0; n < 100; n++) {
    if (n < 10) {
      upTo99.push(ones[n]);
    } else if (n < 20) {
      upTo99.push(teens[n - 10]);
    } else {
      const d = tens[Math.floor(n / 10)];
      const u = n % 10;
      if (u === 0) upTo99.push(d);
      else upTo99.push(`${d}-${ones[u]}`);
    }
  }

  const all = new Set(upTo99);
  // The unhyphenated forms, in case prose writes them that way.
  for (let n = 21; n < 100; n++) {
    if (n % 10 === 0) continue;
    all.add(upTo99[n].replace("-", " "));
  }
  return all;
}

const NUMBERS_IN_WORDS = numbersInWords();

// ---------------------------------------------------------------------------
// What is extracted from a text
// ---------------------------------------------------------------------------

/**
 * The five species of token that a rewrite does not have the right to lose,
 * each with the name that will appear in the error message.
 *
 * Presence is compared, not how many times: shortening removes repetitions,
 * and that is exactly what it must do. Red is when a token disappears
 * entirely.
 */
const SPECIES = [
  {
    name: "number",
    extract(text) {
      const out = new Set();
      // Digits: 87, 4.590, 1.048.576 — and the decimals with the comma.
      for (const m of text.matchAll(/\b\d[\d.,]*\d\b|\b\d\b/g)) {
        out.add(m[0]);
      }
      // Numbers in words, recognized only if the whole word is in the list:
      // «seventeen» is «seventeen», a name like "seven" is not split.
      for (const m of text.matchAll(/[A-Za-zÀ-ÿ]+/g)) {
        const p = m[0].toLowerCase();
        if (NUMBERS_IN_WORDS.has(p)) out.add(p);
      }
      return out;
    },
  },
  {
    name: "path",
    extract(text) {
      const out = new Set();
      const re = /[\w./-]*\w\.(?:md|rs|ts|tsx|mjs|js|json|toml|wit|yml|yaml)\b/g;
      for (const m of text.matchAll(re)) out.add(m[0]);
      return out;
    },
  },
  {
    name: "identifier",
    extract(text) {
      const out = new Set();
      for (const m of text.matchAll(/`([^`\n]+)`/g)) out.add(m[1].trim());
      return out;
    },
  },
  {
    name: "link",
    extract(text) {
      const out = new Set();
      for (const m of text.matchAll(/\]\(([^)\s]+)/g)) out.add(m[1]);
      return out;
    },
  },
  {
    name: "count marker",
    extract(text) {
      const out = new Set();
      for (const m of text.matchAll(/\[count:\s*[a-z0-9-]+\]/g)) out.add(m[0]);
      return out;
    },
  },
];

// ---------------------------------------------------------------------------
// Git
// ---------------------------------------------------------------------------

function git(args) {
  const r = spawnSync("git", args, { encoding: "utf8" });
  return { ok: r.status === 0, out: r.stdout ?? "" };
}

/** The content of a file as it was at a certain ref, or `null` if absent. */
function asOf(ref, file) {
  const r = git(["show", `${ref}:${file}`]);
  return r.ok ? r.out : null;
}

function asNow(file) {
  const r = spawnSync("cat", [file], { encoding: "utf8" });
  return r.status === 0 ? r.stdout : null;
}

// ---------------------------------------------------------------------------

function main() {
  const argv = process.argv.slice(2);
  const confirmed = new Set();
  const i = argv.indexOf("--confirm");
  if (i !== -1) {
    for (const t of (argv[i + 1] ?? "").split(",")) {
      if (t.trim()) confirmed.add(t.trim());
    }
    argv.splice(i, 2);
  }

  let ref = "HEAD";
  if (argv.length > 0 && !argv[0].includes("/") && !argv[0].endsWith(".md")) {
    ref = argv.shift();
  }

  let files = argv;
  if (files.length === 0) {
    const r = git(["diff", "--name-only", ref, "--", "*.md"]);
    files = r.out.split("\n").filter((f) => f.trim());
  }

  let compared = 0;
  const disappearances = [];

  for (const f of files) {
    const before = asOf(ref, f);
    if (before === null) {
      console.log(`new, nothing to compare: ${f}`);
      continue;
    }
    const after = asNow(f);
    if (after === null) {
      console.log(`gone from disk: ${f}`);
      continue;
    }
    compared++;

    for (const species of SPECIES) {
      const wereThere = species.extract(before);
      const areThere = species.extract(after);
      for (const t of wereThere) {
        if (!areThere.has(t) && !confirmed.has(t)) {
          disappearances.push({ file: f, species: species.name, token: t });
        }
      }
    }
  }

  // A count that has compared nothing is not green: it is off. It is how
  // `check-doc-links` already turned itself off once, saying «0 broken».
  if (compared === 0) {
    console.log(
      `no file compared against \`${ref}\`: here the count is not watching anything.\n` +
        "If it is the wrong list it is an invocation error; if the tree is clean,\n" +
        "there is nothing to verify yet.",
    );
    process.exit(1);
  }

  if (disappearances.length === 0) {
    console.log(
      `${compared} files compared against \`${ref}\`: nothing disappeared.`,
    );
    process.exit(0);
  }

  const perFile = new Map();
  for (const s of disappearances) {
    if (!perFile.has(s.file)) perFile.set(s.file, []);
    perFile.get(s.file).push(s);
  }
  for (const [f, list] of perFile) {
    console.log(`\n${f}`);
    for (const s of list) console.log(`  ${s.species} gone: ${s.token}`);
  }
  console.log(
    `\n${disappearances.length} disappearances in ${perFile.size} files, out of ${compared} compared.\n\n` +
      "Red does not necessarily mean wrong: it means **go look at that line**.\n" +
      "If the disappearance is wanted — a number no longer needed, a link that has\n" +
      "moved — re-run with `--confirm <token,token>`, so the decision stays\n" +
      "written in the command instead of in the head of whoever took it.",
  );
  process.exit(1);
}

main();
