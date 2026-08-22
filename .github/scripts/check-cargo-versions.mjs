#!/usr/bin/env node
// A single source of truth for the version of an external dependency.
//
// The root has a `[workspace.dependencies]` section that exists for this
// purpose: versions are written there once, and crates inherit them with
// `{ workspace = true }`. But nothing prevents a `cargo add` from writing one
// by hand inside `crates/<something>/Cargo.toml`, and the first time it does
// no harm: it's a single crate, the number is correct, the build is green.
//
// The second time it hurts. The measured defect that prompted this file was
// `tempfile = "3.27.0"` declared **five** times identically — kernel, testkit,
// features, format-markdown, host — with the result that a `cargo update` of
// that dependency is five lines to change, and the first one forgotten doesn't
// become an error: it becomes a *second* version of `tempfile` in the tree,
// chosen by no one, that compiles perfectly. A duplicate isn't visible until it
// diverges, and when it diverges it's still not visible.
//
// Two nets, with different meshes:
//
//   1. **The duplicate** — no dependency may appear with a version written by
//      hand in two or more workspace crates. There is one allowed exception:
//      `comrak` lives in a single crate, and promoting it to the root would
//      mean promising that someone else will use it one day.
//   2. **The shadow** — if the root already declares a version, no crate may
//      write its own beside it, not even alone. This mesh catches the case
//      the first one misses: the line left behind after the other four have
//      been promoted, which is exactly the form the defect would *return* in.
//
// Exceptions are declared in `EXCEPTIONS`, with the reason beside them: a
// version written twice on purpose is a decision, and belongs here.
//
// Usage:
//   node .github/scripts/check-cargo-versions.mjs [root]
// Exit code 1 if there is at least one violation, 0 otherwise.
//
// No npm dependencies, like the other guards in this folder: a check that
// requires an `npm install` to run is a check that will eventually be turned
// off "temporarily".

import fs from "node:fs";
import path from "node:path";

import { crateDelWorkspace } from "./workspace-members.mjs";

// Dependencies that may repeat with a hand-written version, each with the
// reason it is not promoted to the root. Empty is the correct state: every
// entry added here is one fewer source of truth.
const EXCEPTIONS = new Map([
  // ["crate-name", "why this dependency is declared where it is"],
]);

// The sections of a `Cargo.toml` where a line is a dependency. Recognized by
// *suffix*, so `[target.'cfg(windows)'.dependencies]` and
// `[target.…​.dev-dependencies]` are included without listing them.
const DEPENDENCY_SUFFIXES = ["dependencies", "dev-dependencies", "build-dependencies"];

/**
 * The table name of a `[…]` line, or `null` if the line is not one.
 *
 * `[[example]]` is also a table line: it is not a dependency section, but
 * **closes** the previous one, and treating it as an ordinary line would make
 * examples be read as dependencies.
 */
function sectionName(line) {
  const m = line.match(/^\[\[?([^\]]+)\]\]?\s*$/);
  return m === null ? m : m[1].trim();
}

/** True if the table `name` is a dependency table of this crate. */
function isDependencySection(name) {
  if (name.startsWith("workspace.")) return false;
  return DEPENDENCY_SUFFIXES.some((s) => name === s || name.endsWith(`.${s}`));
}

/**
 * The dependencies declared in a `Cargo.toml`, and how.
 *
 * Returns a map `name -> { line, version }`, where `version` is the
 * hand-written string or `null` if the crate inherits from the root.
 * The line-based parsing is intentional: a `Cargo.toml` is written by hand
 * by us, and a full TOML reader here would be an npm dependency — which is
 * the very thing this file says it does not want. What the line reader does
 * not understand it does not guess: it **declares** it (see `doubts`), and a
 * doubt is red like a violation.
 */
function dependenciesOf(file) {
  const found = new Map();
  const doubts = [];
  let inside = false;
  const lines = fs.readFileSync(file, "utf8").split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const section = sectionName(line.trim());
    if (section !== null) {
      inside = isDependencySection(section);
      continue;
    }
    if (!inside) continue;

    let text = line.trim();
    if (text === "" || text.startsWith("#")) continue;
    const firstLine = i + 1;

    // An inline table can span multiple lines when the feature list is long
    // (`jiff`, `ureq`, `windows-sys`). Braces are closed here, otherwise
    // every feature would appear to be a dependency with the wrong name.
    let openBraces = (text.match(/\{/g) ?? []).length - (text.match(/\}/g) ?? []).length;
    while (openBraces > 0 && i + 1 < lines.length) {
      i++;
      const continuation = lines[i].trim();
      text += ` ${continuation}`;
      openBraces +=
        (continuation.match(/\{/g) ?? []).length - (continuation.match(/\}/g) ?? []).length;
    }
    if (openBraces > 0) {
      doubts.push({ file, line: firstLine, text });
      continue;
    }

    // `name = …` or `name.workspace = true` / `name.version = "…"`.
    const m = text.match(/^([A-Za-z0-9_-]+)\s*(?:\.\s*([A-Za-z0-9_-]+)\s*)?=\s*(.*)$/);
    if (m === null) {
      doubts.push({ file, line: firstLine, text });
      continue;
    }
    const [, name, key, value] = m;

    let version = null;
    if (key === "version") {
      const v = value.match(/^"([^"]*)"/);
      version = v === null ? value : v[1];
    } else if (key === undefined) {
      if (/^"([^"]*)"\s*(#.*)?$/.test(value)) {
        version = value.match(/^"([^"]*)"/)[1];
      } else if (value.startsWith("{")) {
        // Inherits if it says so, otherwise count the written `version =`.
        if (!/\bworkspace\s*=\s*true\b/.test(value)) {
          const v = value.match(/\bversion\s*=\s*"([^"]*)"/);
          if (v !== null) version = v[1];
        }
      }
    }
    // `name.workspace = true` and any other dotted key (`features`, `path`,
    // `optional`) do not declare a version: they add nothing to the count.

    const already = found.get(name);
    if (already === undefined || (already.version === null && version !== null)) {
      found.set(name, { line: firstLine, version });
    }
  }

  return { found, doubts };
}

function main() {
  const root = path.resolve(process.argv[2] ?? ".");
  const rootManifest = path.join(root, "Cargo.toml");
  if (!fs.existsSync(rootManifest)) {
    console.log(`no Cargo.toml in ${root}: the guard is not checking anything here.`);
    process.exit(1);
  }

  // The versions that the root declares for everyone.
  const shared = new Set();
  {
    let inside = false;
    for (const line of fs.readFileSync(rootManifest, "utf8").split("\n")) {
      const section = sectionName(line.trim());
      if (section !== null) {
        inside = section === "workspace.dependencies";
        continue;
      }
      if (!inside) continue;
      const m = line.trim().match(/^([A-Za-z0-9_-]+)\s*[.=]/);
      if (m !== null) shared.add(m[1]);
    }
  }

  // Which crates there are is decided by `[workspace] members`, not by the
  // `crates/` folder: the reason is in `workspace-members.mjs`, and the
  // divergences between the list and disk arrive there already written.
  const { file: files, violazioni: onTheList } = crateDelWorkspace(root);
  const literals = new Map(); // name -> [{ crate, line, version }]
  const doubts = [];
  let declarations = 0;

  for (const f of files) {
    const { found, doubts: d } = dependenciesOf(f);
    doubts.push(...d);
    for (const [name, info] of found) {
      declarations++;
      if (info.version === null) continue;
      if (!literals.has(name)) literals.set(name, []);
      literals.get(name).push({ crate: path.relative(root, f), ...info });
    }
  }

  const violations = [...onTheList];
  for (const [name, places] of [...literals].sort()) {
    if (EXCEPTIONS.has(name)) continue;
    if (places.length > 1) {
      violations.push(
        `\`${name}\` is declared with a hand-written version in ${places.length} crates:\n` +
          places.map((p) => `    ${p.crate}:${p.line}  ${name} = "${p.version}"`).join("\n") +
          `\n  It belongs in [workspace.dependencies] at the root, and in crates becomes` +
          ` \`${name} = { workspace = true }\`.`,
      );
    } else if (shared.has(name)) {
      const p = places[0];
      violations.push(
        `\`${name}\` is already in [workspace.dependencies], but ${p.crate}:${p.line} writes` +
          ` its own ("${p.version}"): two sources of truth, and the second one wins` +
          ` silently.\n  The line here should be replaced with \`${name} = { workspace = true }\`.`,
      );
    }
  }

  for (const d of doubts) {
    violations.push(
      `${path.relative(root, d.file)}:${d.line} could not be parsed: \`${d.text}\`\n` +
        `  If this is a legitimate dependency, teach this script the form: staying` +
        ` silent would be turning it off.`,
    );
  }

  for (const v of violations) console.log(`- ${v}`);
  if (violations.length > 0) console.log("");
  console.log(
    `${files.length} crates checked, ${declarations} dependencies declared,` +
      ` ${shared.size} shared versions at the root,` +
      ` ${violations.length} ${violations.length === 1 ? "violation" : "violations"}`,
  );

  // A guard that checked nothing is not green: it is off. Same discipline as
  // `check-doc-links.mjs`, and for the same reason.
  if (files.length === 0 || declarations === 0) {
    console.log(
      "\nno dependencies read: the guard is not checking anything here.\n" +
        "Either it is the wrong folder, or the recognized sections are no longer correct.",
    );
    process.exit(1);
  }

  process.exit(violations.length > 0 ? 1 : 0);
}

main();
