#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { markdownUnder } from "./doc-files.mjs";

const root = process.cwd();
const docsRoot = path.join(root, "docs");

function limitFor(relative) {
  if (relative === "docs/README.md" || relative === "docs/decisions/README.md") return 150;
  if (/^docs\/decisions\/\d{4}-/.test(relative)) return 180;
  if (relative.startsWith("docs/reference/")) return 550;
  return 450;
}

const errors = [];
for (const file of markdownUnder(docsRoot)) {
  const relative = path.relative(root, file).split(path.sep).join("/");
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).length;
  const limit = limitFor(relative);
  if (lines > limit) errors.push(`${relative}: ${lines} righe, limite ${limit}`);
}

if (errors.length) {
  console.error("Documenti oltre la soglia:\n");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Dimensioni documentali entro le soglie.");
