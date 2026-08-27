#!/usr/bin/env node
// Gli oggetti CodeMirror appartengono al package testuale: nessun altro modulo
// della shell deve poterli importare direttamente.

import fs from "node:fs";
import path from "node:path";

const SOURCE_ROOT = "apps/client/src";
const TEXT_ROOT = `${SOURCE_ROOT}/editors/text/`;

function sourceFiles(directory, found = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") sourceFiles(candidate, found);
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      found.push(candidate);
    }
  }
  return found;
}

function readString(text, start) {
  const quote = text[start];
  let value = "";
  for (let index = start + 1; index < text.length; index++) {
    const character = text[index];
    if (character === "\\") {
      if (index + 1 < text.length) {
        value += text[index + 1];
        index++;
      }
    } else if (character === quote) {
      return { value, end: index + 1 };
    } else {
      value += character;
    }
  }
  return { value, end: text.length };
}

function tokens(text) {
  const result = [];
  let index = 0;
  while (index < text.length) {
    const character = text[index];
    if (/\s/.test(character)) {
      index++;
      continue;
    }
    if (character === "/" && text[index + 1] === "/") {
      index += 2;
      while (index < text.length && text[index] !== "\n") index++;
      continue;
    }
    if (character === "/" && text[index + 1] === "*") {
      const end = text.indexOf("*/", index + 2);
      index = end === -1 ? text.length : end + 2;
      continue;
    }
    if (character === "'" || character === '"') {
      const string = readString(text, index);
      result.push({ kind: "string", value: string.value, start: index });
      index = string.end;
      continue;
    }
    if (character === "`") {
      const string = readString(text, index);
      if (!string.value.includes("${")) {
        result.push({ kind: "string", value: string.value, start: index });
      }
      index = string.end;
      continue;
    }
    if (/[A-Za-z_$]/.test(character)) {
      const start = index;
      index++;
      while (index < text.length && /[\w$]/.test(text[index])) index++;
      result.push({ kind: "word", value: text.slice(start, index), start });
      continue;
    }
    result.push({ kind: "punctuation", value: character, start: index });
    index++;
  }
  return result;
}

function codeMirrorSpecifier(specifier) {
  return /^@codemirror\/[^/]+(?:\/.*)?$/.test(specifier) ||
    /^codemirror(?:\/.*)?$/.test(specifier);
}

function imports(text) {
  const found = [];
  const items = tokens(text);
  const add = (token, specifier) => {
    if (codeMirrorSpecifier(specifier)) found.push({ start: token.start, specifier });
  };
  const callArgument = (opening) => {
    if (items[opening]?.value !== "(" || items[opening + 1]?.kind !== "string") return null;
    return items[opening + 1];
  };

  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    const previous = items[index - 1]?.value;
    if (item.kind !== "word") continue;

    if (item.value === "require") {
      const directCall = previous !== "." ? callArgument(index + 1) : null;
      const moduleCall = previous === "." && items[index - 2]?.value === "module"
        ? callArgument(index + 1)
        : null;
      const resolveCall = previous !== "." &&
        items[index + 1]?.value === "." &&
        items[index + 2]?.value === "resolve"
        ? callArgument(index + 3)
        : null;
      const argument = directCall ?? moduleCall ?? resolveCall;
      if (argument) add(item, argument.value);
      continue;
    }

    if (item.value !== "import" && item.value !== "export") continue;
    if (previous === ".") continue;

    if (item.value === "import" && items[index + 1]?.value === "(") {
      if (items[index + 2]?.kind === "string") add(item, items[index + 2].value);
      continue;
    }

    if (item.value === "import" && items[index + 1]?.kind === "string") {
      add(item, items[index + 1].value);
      continue;
    }

    for (let cursor = index + 1; cursor < items.length; cursor++) {
      if (items[cursor].value === ";") break;
      if (items[cursor].value === "from" && items[cursor + 1]?.kind === "string") {
        add(item, items[cursor + 1].value);
        break;
      }
    }
  }
  return found;
}

function lineNumber(text, offset) {
  return text.slice(0, offset).split("\n").length;
}

function findings(relative, text) {
  if (relative.startsWith(TEXT_ROOT)) return [];
  return imports(text).map((match) => ({
    line: lineNumber(text, match.start),
    specifier: match.specifier,
    text: text.split(/\r?\n/)[lineNumber(text, match.start) - 1]?.trim() ?? "",
  }));
}

function selfTest() {
  const allowed = `
    import { EditorState } from "@codemirror/state";
    import editor from "codemirror";
    const view = import("@codemirror/view");
    const bareView = import("codemirror");
    const templateView = import(\`codemirror\`);
    export { EditorView } from "@codemirror/view";
    const editor = require("codemirror");
    const templateEditor = require(\`@codemirror/view\`);
    const moduleEditor = module.require("codemirror");
    const templateModuleEditor = module.require(\`@codemirror/view\`);
    const resolvedEditor = require.resolve("codemirror");
    const templateResolvedEditor = require.resolve(\`@codemirror/view\`);
  `;
  const forbidden = `
    // import { fake } from "@codemirror/fake";
    import { EditorState } from "@codemirror/state";
    import editor from "codemirror";
    const view = import("@codemirror/view");
    const bareView = import("codemirror");
    const templateView = import(\`codemirror\`);
    export { EditorView } from "@codemirror/view";
    const editor = require("codemirror");
    const templateEditor = require(\`@codemirror/view\`);
    const moduleEditor = module.require("codemirror");
    const templateModuleEditor = module.require(\`@codemirror/view\`);
    const resolvedEditor = require.resolve("codemirror");
    const templateResolvedEditor = require.resolve(\`@codemirror/view\`);
  `;
  const permittedImports = imports(allowed);
  const permittedFindings = findings(`${TEXT_ROOT}self-test.ts`, allowed);
  const forbiddenFindings = findings(`${SOURCE_ROOT}/panels/self-test.ts`, forbidden);
  if (permittedImports.length !== 12 || permittedFindings.length !== 0 || forbiddenFindings.length !== 12) {
    throw new Error(
      `self-test inatteso: parser=${permittedImports.length}, permesso=${permittedFindings.length}, ` +
        `violazioni=${forbiddenFindings.length}`,
    );
  }
  console.log("Autoprova di check-codemirror-boundary riuscita: caso permesso e violazione rilevati.");
}


if (process.argv.includes("--self-test")) {
  try {
    selfTest();
  } catch (error) {
    console.error(`Autoprova di check-codemirror-boundary fallita: ${error.message}`);
    process.exit(1);
  }
  process.exit(0);
}

const root = path.resolve(process.argv[2] ?? process.cwd());
const sourceRoot = path.join(root, SOURCE_ROOT);
if (!fs.existsSync(sourceRoot)) {
  console.error(`cannot find ${sourceRoot}: pass the repo root as an argument.`);
  process.exit(2);
}

const violations = [];
let inspected = 0;
for (const file of sourceFiles(sourceRoot).sort()) {
  const relative = path.relative(root, file).split(path.sep).join("/");
  inspected++;
  for (const violation of findings(relative, fs.readFileSync(file, "utf8"))) {
    violations.push({ relative, ...violation });
  }
}

for (const violation of violations) {
  console.error(`${violation.relative}:${violation.line}: import CodeMirror fuori dal package testuale`);
  console.error(`  ${violation.text}`);
}
if (violations.length > 0) {
  console.error("");
  console.error(`${violations.length} import CodeMirror fuori da ${TEXT_ROOT}.`);
  process.exit(1);
}

console.log(`${inspected} sorgenti TypeScript: CodeMirror confinato in ${TEXT_ROOT}.`);
