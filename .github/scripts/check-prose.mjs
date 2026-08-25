#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function findings(relative, text) {
  const issues = [];
  const legacy = [
    /docs\/(?:00-inizia-qui|01-concetti|02-componenti|03-uml|04-plugin|05-disco|06-contratto|07-ui|appendix|features|microfeatures|milestones|roadmap)\//,
    /(?:FEATURES|PIANO|leggimi-prima|todo)\.md/,
    /(?:^|[/(])graph\.md(?:$|[)#])/,
  ];
  for (const pattern of legacy) {
    if (pattern.test(text)) issues.push(`riferimento legacy: ${pattern}`);
  }
  if (!relative.startsWith("docs/project/") && relative !== "docs/development/documentation-style.md") {
    if (/(^|\W)(oggi|questo commit)(\W|$)/i.test(text) || /\bal momento\b(?!\s+(?:del|della|di)\b)/i.test(text)) {
      issues.push("cronaca temporale fuori da docs/project");
    }
    if (/^\s*-\s*\[[xX]\]/m.test(text)) {
      issues.push("checklist completata in un documento permanente");
    }
  }
  if (/\[conta:[^\]]+]/.test(text)) issues.push("marker di conteggio manuale");
  return issues;
}

if (process.argv.includes("--self-test")) {
  const bad = findings("docs/product/test.md", "Vedi ../../docs/project/roadmap.md.\n- [x] fatto oggi.");
  const good = findings("docs/project/status.md", "Oggi\n- [ ] aperto");
  if (bad.length < 2 || good.length !== 0) {
    console.error("Autoprova di check-prose fallita.");
    process.exit(1);
  }
  console.log("Autoprova di check-prose riuscita.");
  process.exit(0);
}

const files = walk(path.join(root, "docs")).filter((file) => file.endsWith(".md"));
const errors = [];
for (const file of files) {
  const relative = path.relative(root, file).split(path.sep).join("/");
  const text = fs.readFileSync(file, "utf8");
  for (const issue of findings(relative, text)) errors.push(`${relative}: ${issue}`);
}

if (errors.length) {
  console.error("Prosa documentale non canonica:\n");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Nessun riferimento legacy, cronaca o checklist permanente.");
