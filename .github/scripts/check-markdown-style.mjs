#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const roots = [
  "README.md",
  "AGENTS.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "CODE_OF_CONDUCT.md",
  "CHANGELOG.md",
];

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const files = [
  ...roots.map((file) => path.join(root, file)).filter(fs.existsSync),
  ...walk(path.join(root, "docs")).filter((file) => file.endsWith(".md")),
];

const errors = [];

for (const file of files) {
  const relative = path.relative(root, file);
  const text = fs.readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/);
  let fenced = false;
  let fenceChar = "";
  let h1 = 0;
  let previousHeading = 0;

  if (!text.endsWith("\n")) errors.push(`${relative}: manca la newline finale`);

  lines.forEach((line, index) => {
    const lineNo = index + 1;
    if (/[ \t]+$/.test(line)) errors.push(`${relative}:${lineNo}: spazio finale`);

    const fence = line.match(/^\s*(```+|~~~+)(.*)$/);
    if (fence) {
      if (!fenced) {
        fenced = true;
        fenceChar = fence[1][0];
        if (!fence[2].trim()) {
          errors.push(`${relative}:${lineNo}: code fence senza linguaggio`);
        }
      } else if (fence[1][0] === fenceChar) {
        fenced = false;
      }
      return;
    }
    if (fenced) return;

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      if (level === 1) h1 += 1;
      if (previousHeading && level > previousHeading + 1) {
        errors.push(`${relative}:${lineNo}: salto da H${previousHeading} a H${level}`);
      }
      previousHeading = level;
    }

    const visible = line.replace(/`[^`]*`/g, "");
    if (/<[A-Za-z][^>]*>/.test(visible)) {
      const allowedComment =
        relative === "CONTRIBUTING.md" && /^\s*<!-- ci-required:(start|end) -->\s*$/.test(line);
      if (!allowedComment) errors.push(`${relative}:${lineNo}: HTML inline non consentito`);
    }
  });

  if (fenced) errors.push(`${relative}: code fence non chiuso`);
  if (h1 !== 1) errors.push(`${relative}: atteso un H1, trovati ${h1}`);
}

if (errors.length) {
  console.error("Errori di stile Markdown:\n");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Stile Markdown valido in ${files.length} file.`);
