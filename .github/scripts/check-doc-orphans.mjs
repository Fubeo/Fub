#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const docsRoot = path.join(root, "docs");

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function localMarkdownLinks(file) {
  const text = fs.readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/);
  let fenced = false;
  const links = [];
  for (const line of lines) {
    if (/^\s*(```+|~~~+)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    for (const match of line.matchAll(/!?\[[^\]]*]\(([^)]+)\)/g)) {
      const raw = match[1].trim().split(/\s+["'(]/, 1)[0];
      if (/^(https?:|mailto:|tel:|data:|#)/i.test(raw)) continue;
      const pathname = raw.split("#", 1)[0];
      if (!pathname) continue;
      let decoded = pathname;
      try { decoded = decodeURIComponent(pathname); } catch {}
      const target = path.resolve(path.dirname(file), decoded);
      if (target.endsWith(".md") && fs.existsSync(target)) links.push(target);
    }
  }
  return links;
}

const docs = walk(docsRoot).filter((file) => file.endsWith(".md"));
const roots = [path.join(root, "README.md"), path.join(docsRoot, "README.md")];
const visited = new Set();
const queue = roots.filter(fs.existsSync);

while (queue.length) {
  const file = queue.shift();
  if (visited.has(file)) continue;
  visited.add(file);
  for (const target of localMarkdownLinks(file)) {
    if (!visited.has(target)) queue.push(target);
  }
}

const excluded = new Set([path.join(docsRoot, "decisions", "template.md")]);
const orphans = docs.filter((file) => !visited.has(file) && !excluded.has(file));

const decisionsDir = path.join(docsRoot, "decisions");
const adrFiles = fs.readdirSync(decisionsDir)
  .filter((name) => /^\d{4}-.*\.md$/.test(name))
  .sort();
const indexed = new Set(
  localMarkdownLinks(path.join(decisionsDir, "README.md"))
    .map((file) => path.basename(file)),
);
const missingAdr = adrFiles.filter((file) => !indexed.has(file));

if (orphans.length || missingAdr.length) {
  if (orphans.length) {
    console.error("Pagine non raggiungibili da README.md o docs/README.md:");
    for (const file of orphans) {
      console.error(`- ${path.relative(root, file)}`);
    }
  }
  if (missingAdr.length) {
    console.error("ADR non presenti nell'indice:");
    for (const file of missingAdr) console.error(`- docs/decisions/${file}`);
  }
  process.exit(1);
}

console.log(`${docs.length} pagine canoniche raggiungibili; ${adrFiles.length} ADR indicizzati.`);
