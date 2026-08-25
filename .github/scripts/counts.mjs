#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

export function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

export function countMarkdown(dir = path.join(process.cwd(), "docs")) {
  return walk(dir).filter((file) => file.endsWith(".md")).length;
}

export function countWorkspaceCrates(cargo = path.join(process.cwd(), "Cargo.toml")) {
  const text = fs.readFileSync(cargo, "utf8");
  const members = text.match(/members\s*=\s*\[([\s\S]*?)\]/);
  if (!members) return 0;
  return [...members[1].matchAll(/"crates\/[^"]+"/g)].length;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify({
    markdown: countMarkdown(),
    workspaceCrates: countWorkspaceCrates(),
  }, null, 2));
}
