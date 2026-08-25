#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function cells(line) {
  let current = "";
  const result = [];
  let escaped = false;
  let code = false;
  const trimmed = line.trim();
  const body = trimmed.startsWith("|") ? trimmed.slice(1) : trimmed;
  const content = body.endsWith("|") ? body.slice(0, -1) : body;

  for (const char of content) {
    if (escaped) {
      current += char;
      escaped = false;
    } else if (char === "\\") {
      current += char;
      escaped = true;
    } else if (char === "`") {
      code = !code;
      current += char;
    } else if (char === "|" && !code) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

function isSeparator(line) {
  const parts = cells(line);
  return parts.length > 0 && parts.every((part) => /^:?-{3,}:?$/.test(part));
}

function validate(text, name) {
  const errors = [];
  const lines = text.split(/\r?\n/);
  let fenced = false;

  for (let i = 0; i < lines.length - 1; i += 1) {
    if (/^\s*(```+|~~~+)/.test(lines[i])) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    if (!lines[i].includes("|") || !isSeparator(lines[i + 1])) continue;

    const expected = cells(lines[i]).length;
    let row = i + 1;
    while (row < lines.length && lines[row].trim() && lines[row].includes("|")) {
      const actual = cells(lines[row]).length;
      if (actual !== expected) {
        errors.push(`${name}:${row + 1}: ${actual} celle, attese ${expected}`);
      }
      row += 1;
    }
    i = row - 1;
  }
  return errors;
}

if (process.argv.includes("--autoprova")) {
  const valid = "| A | B |\n|---|---|\n| x | `a|b` |";
  const invalid = "| A | B |\n|---|---|\n| x |";
  if (validate(valid, "valid").length !== 0 || validate(invalid, "invalid").length !== 1) {
    console.error("Autoprova di check-tables fallita.");
    process.exit(1);
  }
  console.log("Autoprova di check-tables riuscita.");
  process.exit(0);
}

const files = [
  ...["README.md", "AGENTS.md", "CONTRIBUTING.md", "SECURITY.md", "CODE_OF_CONDUCT.md", "CHANGELOG.md"]
    .map((file) => path.join(root, file))
    .filter(fs.existsSync),
  ...walk(path.join(root, "docs")).filter((file) => file.endsWith(".md")),
];

const errors = files.flatMap((file) =>
  validate(fs.readFileSync(file, "utf8"), path.relative(root, file)),
);

if (errors.length) {
  console.error("Tabelle non valide:\n");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Tabelle valide in ${files.length} file.`);
