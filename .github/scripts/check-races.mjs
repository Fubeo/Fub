#!/usr/bin/env node
// Dentro una `Queue.ultimo` non si aspetta di nascosto: ogni `await` deve
// passare dal cancello ricevuto dal corpo, e un `catch` interno non deve poter
// ingoiare il segnale di scadenza.

import fs from "node:fs";
import path from "node:path";

const GATE = "apps/client/src/ui/race.ts";
const root = process.argv[2] ?? process.cwd();

function sourceFiles(directory, found = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") sourceFiles(candidate, found);
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      found.push(candidate);
    }
  }
  return found;
}

function bodyEnd(text, opening) {
  let depth = 0;
  for (let index = opening; index < text.length; index++) {
    if (text[index] === "{") depth++;
    else if (text[index] === "}") {
      depth--;
      if (depth === 0) return index;
    }
  }
  return text.length;
}

function awaitedExpression(body, awaitIndex) {
  const rest = body.slice(awaitIndex + "await".length);
  const opening = rest.indexOf("(");
  const newline = rest.indexOf("\n");
  if (opening === -1 || (newline !== -1 && newline < opening)) {
    return rest.slice(0, newline === -1 ? rest.length : newline);
  }
  let depth = 0;
  for (let index = opening; index < rest.length; index++) {
    if (rest[index] === "(") depth++;
    else if (rest[index] === ")") {
      depth--;
      if (depth === 0) return rest.slice(0, index + 1);
    }
  }
  return rest;
}

const violations = [];
const sourceRoot = path.join(root, "apps", "client", "src");
if (!fs.existsSync(sourceRoot)) {
  console.error(`cannot find ${sourceRoot}: pass the repo root as an argument.`);
  process.exit(2);
}

for (const file of sourceFiles(sourceRoot)) {
  const relative = path.relative(root, file).split(path.sep).join("/");
  if (relative === GATE) continue;
  const text = fs.readFileSync(file, "utf8");
  const openingPattern = /\.ultimo\(\s*async\s*\(\s*([A-Za-z_$][\w$]*)\s*\)\s*=>\s*\{/g;
  let match;
  while ((match = openingPattern.exec(text)) !== null) {
    const gate = match[1];
    const opening = match.index + match[0].length - 1;
    const closing = bodyEnd(text, opening);
    const body = text.slice(opening, closing);
    const lineOf = (offset) => text.slice(0, opening + offset).split("\n").length;

    for (const awaited of body.matchAll(/\bawait\b/g)) {
      const expression = awaitedExpression(body, awaited.index);
      if (new RegExp(`\\b${gate}\\b`).test(expression)) continue;
      violations.push(
        `${relative}:${lineOf(awaited.index)}: an \`await\` inside a race does not name \`${gate}\`.`,
      );
    }
    for (const caught of body.matchAll(/\}\s*catch\b/g)) {
      violations.push(
        `${relative}:${lineOf(caught.index)}: a \`catch\` inside a race can swallow expiry; ` +
          `use \`await ${gate}(promise.catch(…))\`.`,
      );
    }
  }
}

for (const violation of violations) console.error(violation);
console.log(
  violations.length === 0
    ? "check-races: no one bypasses the gateway."
    : `check-races: ${violations.length} violations.`,
);
process.exit(violations.length === 0 ? 0 : 1);
