#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const entryFiles = [
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
  ...entryFiles.map((file) => path.join(root, file)).filter(fs.existsSync),
  ...walk(path.join(root, "docs")).filter((file) => file.endsWith(".md")),
];

function stripCode(text) {
  const lines = text.split(/\r?\n/);
  let fenced = false;
  let marker = "";
  return lines.map((line) => {
    const match = line.match(/^\s*(```+|~~~+)/);
    if (match) {
      if (!fenced) {
        fenced = true;
        marker = match[1][0];
      } else if (match[1][0] === marker) {
        fenced = false;
      }
      return "";
    }
    return fenced ? "" : line;
  }).join("\n");
}

function slug(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function anchorsFor(file) {
  if (!fs.existsSync(file) || !file.endsWith(".md")) return new Set();
  const counts = new Map();
  const anchors = new Set();
  for (const line of stripCode(fs.readFileSync(file, "utf8")).split(/\r?\n/)) {
    const match = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    if (!match) continue;
    const base = slug(match[1]);
    const index = counts.get(base) ?? 0;
    counts.set(base, index + 1);
    anchors.add(index === 0 ? base : `${base}-${index}`);
  }
  return anchors;
}

function decodeTarget(raw) {
  let target = raw.trim();
  if (target.startsWith("<") && target.endsWith(">")) {
    target = target.slice(1, -1);
  }
  const title = target.match(/^(\S+)\s+["'(].*["')]\s*$/);
  if (title) target = title[1];
  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
}

function linksIn(text) {
  const clean = stripCode(text);
  const links = [];
  const inline = /!?\[[^\]]*]\(([^)]+)\)/g;
  for (const match of clean.matchAll(inline)) links.push(match[1]);
  const definitions = /^\s*\[[^\]]+]:\s*(\S+)/gm;
  for (const match of clean.matchAll(definitions)) links.push(match[1]);
  return links;
}

const errors = [];
const anchorCache = new Map();

for (const file of files) {
  const relative = path.relative(root, file);
  const text = fs.readFileSync(file, "utf8");
  for (const raw of linksIn(text)) {
    const target = decodeTarget(raw);
    if (
      !target ||
      /^(https?:|mailto:|tel:|data:)/i.test(target)
    ) {
      continue;
    }

    const [pathname, fragment] = target.split("#", 2);
    const resolved = pathname
      ? path.resolve(path.dirname(file), pathname)
      : file;

    if (!resolved.startsWith(root + path.sep) && resolved !== root) {
      errors.push(`${relative}: il link esce dalla repository: ${target}`);
      continue;
    }

    if (!fs.existsSync(resolved)) {
      errors.push(`${relative}: target inesistente: ${target}`);
      continue;
    }

    if (fragment && fs.statSync(resolved).isFile() && resolved.endsWith(".md")) {
      let anchors = anchorCache.get(resolved);
      if (!anchors) {
        anchors = anchorsFor(resolved);
        anchorCache.set(resolved, anchors);
      }
      if (!anchors.has(fragment.toLowerCase())) {
        errors.push(`${relative}: anchor inesistente in ${target}`);
      }
    }
  }
}

if (errors.length) {
  console.error("Link documentali non validi:\n");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Link validi in ${files.length} file Markdown.`);
