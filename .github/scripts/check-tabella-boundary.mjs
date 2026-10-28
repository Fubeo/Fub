#!/usr/bin/env node
// La Tabella (`apps/client/src/tabella/`) è un pezzo di interfaccia che non sa
// in quale editor vive: se importasse un editor ne diventerebbe una parte.
// Importa quindi soltanto le primitive (`kit/`), il moto (`moto/`), le parole
// (`i18n/`), il formato degli appunti condiviso (`editors/core/tsv.ts`) e il
// proprietario di ascoltatori e osservatori (`ui/lifetime.ts`, che la regola
// degli owner chiede a ogni pezzo), oltre ai suoi stessi moduli. Niente `editors/*` (salvo `tsv.ts`), niente
// ProseMirror, niente CodeMirror, niente `@tauri-apps`, e nessun pacchetto npm
// (i suoi test prendono in più `vitest`): un elenco che permette, invece di uno
// che vieta, è l'unico che non si apre da solo il giorno in cui arriva una
// dipendenza nuova.
//
// Come `check-codemirror-boundary.mjs`, legge i sorgenti col parser
// TypeScript: import statici, `export … from`, `import type`, `import()`
// dinamici, `require` e `import x = require(…)`. Uno specificatore non
// costante (un template con una parte calcolata) non si può verificare, e
// conta come violazione.
//
//     node .github/scripts/check-tabella-boundary.mjs              # dalla radice
//     node .github/scripts/check-tabella-boundary.mjs <radice>     # un'altra radice
//     node .github/scripts/check-tabella-boundary.mjs --self-test  # l'autoprova
//
// La cartella può non esistere ancora: allora non c'è niente da violare.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const SOURCE_ROOT = "apps/client/src";
const TABELLA_ROOT = `${SOURCE_ROOT}/tabella`;
/// Dove la Tabella può arrivare, relativo a `SOURCE_ROOT`: una cartella
/// (con tutto ciò che contiene) o un modulo preciso.
const ALLOWED_DIRECTORIES = ["tabella", "kit", "moto", "i18n"];
const ALLOWED_MODULES = ["editors/core/tsv", "ui/lifetime"];
/// I test della Tabella prendono in più il loro banco, e nient'altro.
const TEST_FILE = /\.test\.(?:ts|tsx|mts|cts)$/;
const TEST_PACKAGES = ["vitest"];

const rootArgument = process.argv.slice(2).find((argument) => !argument.startsWith("--"));
const root = path.resolve(rootArgument ?? process.cwd());

function sourceFiles(directory, found = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") sourceFiles(candidate, found);
    } else if (/\.(?:ts|tsx|mts|cts)$/.test(entry.name)) {
      found.push(candidate);
    }
  }
  return found;
}

function loadTypeScript(repoRoot) {
  // Il parser sta nel pacchetto del client; se la radice passata è una copia
  // senza `node_modules`, lo si cerca accanto a questo script.
  const candidates = [
    path.join(repoRoot, "apps/client/package.json"),
    path.join(path.dirname(new URL(import.meta.url).pathname), "../../apps/client/package.json"),
  ];
  let last;
  for (const packagePath of candidates) {
    try {
      return createRequire(packagePath)("typescript");
    } catch (error) {
      last = error;
    }
  }
  const message = last instanceof Error ? last.message : String(last);
  throw new Error(`impossibile caricare il parser TypeScript da ${candidates[0]}: ${message}`);
}

function diagnosticText(typescript, diagnostic) {
  const message = typescript.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
  if (!diagnostic.file || diagnostic.start == null) return message;
  const position = typescript.getLineAndCharacterOfPosition(diagnostic.file, diagnostic.start);
  return `${diagnostic.file.fileName}:${position.line + 1}:${position.character + 1}: ${message}`;
}

function parseSource(typescript, fileName, text) {
  const scriptKind = fileName.endsWith(".tsx") ? typescript.ScriptKind.TSX : typescript.ScriptKind.TS;
  const source = typescript.createSourceFile(fileName, text, typescript.ScriptTarget.Latest, true, scriptKind);
  if (source.parseDiagnostics?.length > 0) {
    const details = source.parseDiagnostics.map((diagnostic) => diagnosticText(typescript, diagnostic));
    throw new Error(`parser TypeScript non affidabile per ${fileName}:\n${details.join("\n")}`);
  }
  return source;
}

function unwrapExpression(typescript, node) {
  while (
    typescript.isParenthesizedExpression(node) ||
    typescript.isAsExpression(node) ||
    typescript.isTypeAssertionExpression(node) ||
    typescript.isNonNullExpression(node) ||
    typescript.isSatisfiesExpression?.(node)
  ) {
    node = node.expression;
  }
  return node;
}

function knownSpecifier(typescript, node) {
  node = unwrapExpression(typescript, node);
  if (typescript.isStringLiteral(node) || typescript.isNoSubstitutionTemplateLiteral(node)) {
    return { value: node.text, complete: true };
  }
  if (typescript.isTemplateExpression(node)) return { value: node.head.text, complete: false };
  if (typescript.isBinaryExpression(node) && node.operatorToken.kind === typescript.SyntaxKind.PlusToken) {
    const left = knownSpecifier(typescript, node.left);
    if (!left.complete) return left;
    const right = knownSpecifier(typescript, node.right);
    return { value: left.value + right.value, complete: right.complete };
  }
  return { value: "", complete: false };
}

function memberName(typescript, node) {
  if (!node) return null;
  const specifier = knownSpecifier(typescript, node);
  return specifier.complete ? specifier.value : null;
}

function exactMember(typescript, expression, object, member) {
  expression = unwrapExpression(typescript, expression);
  if (typescript.isPropertyAccessExpression(expression)) {
    const receiver = unwrapExpression(typescript, expression.expression);
    return typescript.isIdentifier(receiver) && receiver.text === object && expression.name.text === member;
  }
  if (typescript.isElementAccessExpression(expression)) {
    const receiver = unwrapExpression(typescript, expression.expression);
    return typescript.isIdentifier(receiver) &&
      receiver.text === object && memberName(typescript, expression.argumentExpression) === member;
  }
  return false;
}

/// Ogni specificatore di modulo del file, con la sua posizione.
function imports(text, fileName, typescript) {
  const source = parseSource(typescript, fileName, text);
  const found = [];
  const add = (node, specifierNode) => {
    if (!specifierNode) return;
    const specifier = knownSpecifier(typescript, specifierNode);
    found.push({ start: node.getStart(source), ...specifier });
  };
  const visit = (node) => {
    if (typescript.isImportDeclaration(node) || typescript.isExportDeclaration(node)) {
      add(node, node.moduleSpecifier);
    } else if (
      typescript.isImportEqualsDeclaration(node) &&
      typescript.isExternalModuleReference(node.moduleReference)
    ) {
      add(node, node.moduleReference.expression);
    } else if (typescript.isImportTypeNode(node) && typescript.isLiteralTypeNode(node.argument)) {
      add(node, node.argument.literal);
    } else if (typescript.isCallExpression(node)) {
      const expression = unwrapExpression(typescript, node.expression);
      if (
        expression.kind === typescript.SyntaxKind.ImportKeyword ||
        (typescript.isIdentifier(expression) && expression.text === "require") ||
        exactMember(typescript, expression, "module", "require") ||
        exactMember(typescript, expression, "require", "resolve") ||
        exactMember(typescript, expression, "globalThis", "require") ||
        exactMember(typescript, expression, "window", "require")
      ) {
        add(node, node.arguments[0]);
      }
    }
    typescript.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/// Perché uno specificatore, importato da `relative` (path dalla radice),
/// esce dal confine; `null` se resta dentro.
function reason(relative, specifier) {
  if (!specifier.complete) return "specificatore non costante: non si può verificare";
  const value = specifier.value;
  if (!value.startsWith(".")) {
    if (TEST_FILE.test(relative) && TEST_PACKAGES.includes(value)) return null;
    if (/^@codemirror\/|^codemirror(?:\/|$)/.test(value)) return "CodeMirror";
    if (/^prosemirror-|^@prosemirror\//.test(value)) return "ProseMirror";
    if (/^@tauri-apps\//.test(value)) return "API di Tauri";
    return "pacchetto npm";
  }
  // Un path relativo, risolto rispetto al file e riportato a `SOURCE_ROOT`.
  const target = path.posix.normalize(path.posix.join(path.posix.dirname(relative), value));
  if (!target.startsWith(`${SOURCE_ROOT}/`)) return "fuori da apps/client/src";
  const inside = target.slice(SOURCE_ROOT.length + 1).replace(/\.(?:ts|tsx|js|mjs)$/, "").replace(/\?.*$/, "");
  if (ALLOWED_DIRECTORIES.some((dir) => inside === dir || inside.startsWith(`${dir}/`))) return null;
  if (ALLOWED_MODULES.includes(inside)) return null;
  if (inside.startsWith("editors/") || inside === "editors") return "un editor: degli editor solo editors/core/tsv.ts è permesso";
  return `${inside}: non è kit/, moto/, i18n/ né editors/core/tsv.ts`;
}

function lineNumber(text, offset) {
  return text.slice(0, offset).split("\n").length;
}

function findings(relative, text, typescript) {
  if (!relative.startsWith(`${TABELLA_ROOT}/`)) return [];
  const lines = text.split(/\r?\n/);
  const out = [];
  for (const match of imports(text, relative, typescript)) {
    const why = reason(relative, match);
    if (why === null) continue;
    const line = lineNumber(text, match.start);
    out.push({ line, specifier: match.value, why, text: lines[line - 1]?.trim() ?? "" });
  }
  return out;
}

function selfTest(typescript) {
  const file = `${TABELLA_ROOT}/self-test.ts`;
  const nested = `${TABELLA_ROOT}/parti/self-test.ts`;
  const allowed = `
    import { button } from "../kit/button";
    import * as kit from "../kit";
    import { spring } from "../moto/index";
    import { t } from "../i18n";
    import { lingua } from "../i18n/catalog.ts";
    import { parseTsv } from "../editors/core/tsv";
    import { toTsv } from "../editors/core/tsv.ts";
    import { openLifetime } from "../ui/lifetime";
    import { mossa } from "./navigation";
    export { mossa as altra } from "./navigation";
    import type { Cella } from "./model";
    const lazy = import("../kit/popover");
    // import { EditorView } from "@codemirror/view";
    const text = "import x from '@tauri-apps/api'";
  `;
  const allowedNested = `
    import { t } from "../../i18n";
    import { mossa } from "../navigation";
  `;
  const forbidden = `
    import { EditorView } from "@codemirror/view";
    import editor from "codemirror";
    import { EditorState } from "prosemirror-state";
    import { invoke } from "@tauri-apps/api/core";
    import { GridEngine } from "../editors/grid/engine";
    import { TextEngine } from "../editors/text/engine";
    import { registry } from "../editors/core/registry";
    import type { Host } from "../host/contract";
    import { state } from "../state/document-session";
    import { showContextMenu } from "../ui/menu";
    export { GridEngine } from "../editors/grid/engine";
    const lazyView = import("@codemirror/view");
    const lazyEditor = import(\`../editors/\${name}\`);
    const required = require("prosemirror-model");
    const moduleRequired = module.require("../editors/rich/engine");
    import alias = require("@tauri-apps/api");
    type Contratto = import("../host/contract").Host;
    import lodash from "lodash";
    import { fuori } from "../../../../fuori";
  `;
  const testFile = `
    import { describe, expect, it } from "vitest";
    import { mossa } from "./navigation";
  `;
  const forbiddenNested = `
    import { GridEngine } from "../../editors/grid/engine";
  `;
  const permitted = findings(file, allowed, typescript);
  const permittedNested = findings(nested, allowedNested, typescript);
  const outside = findings(`${SOURCE_ROOT}/editors/grid/self-test.ts`, forbidden, typescript);
  const violations = findings(file, forbidden, typescript);
  const nestedViolations = findings(nested, forbiddenNested, typescript);
  const testPermitted = findings(`${TABELLA_ROOT}/navigation.test.ts`, testFile, typescript);
  const testOutsideTests = findings(file, testFile, typescript);
  if (
    permitted.length !== 0 ||
    permittedNested.length !== 0 ||
    testPermitted.length !== 0 ||
    testOutsideTests.length !== 1 ||
    outside.length !== 0 ||
    violations.length !== 19 ||
    nestedViolations.length !== 1
  ) {
    throw new Error(
      `self-test inatteso: permessi=${permitted.length + permittedNested.length} ` +
        `(${[...permitted, ...permittedNested].map((v) => v.specifier).join(", ")}), ` +
        `fuori dalla Tabella=${outside.length}, violazioni=${violations.length}/19, annidate=${nestedViolations.length}/1, ` +
        `vitest in un test=${testPermitted.length}/0, vitest fuori dai test=${testOutsideTests.length}/1`,
    );
  }
  console.log("Autoprova di check-tabella-boundary riuscita: casi permessi e violazioni rilevati.");
}

let typescript;
try {
  typescript = loadTypeScript(root);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`check-tabella-boundary fallito: ${message}`);
  process.exit(1);
}

if (process.argv.includes("--self-test")) {
  try {
    selfTest(typescript);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Autoprova di check-tabella-boundary fallita: ${message}`);
    process.exit(1);
  }
  process.exit(0);
}

if (!fs.existsSync(path.join(root, SOURCE_ROOT))) {
  console.error(`non trovo ${path.join(root, SOURCE_ROOT)}: passa la radice del repo come argomento.`);
  process.exit(2);
}

const tabella = path.join(root, TABELLA_ROOT);
if (!fs.existsSync(tabella)) {
  console.log(`${TABELLA_ROOT} non c'è ancora: niente da controllare.`);
  process.exit(0);
}

const violations = [];
let inspected = 0;
try {
  for (const file of sourceFiles(tabella).sort()) {
    const relative = path.relative(root, file).split(path.sep).join("/");
    inspected++;
    for (const violation of findings(relative, fs.readFileSync(file, "utf8"), typescript)) {
      violations.push({ relative, ...violation });
    }
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`check-tabella-boundary fallito: ${message}`);
  process.exit(1);
}

for (const violation of violations) {
  console.error(`${violation.relative}:${violation.line}: «${violation.specifier}» esce dal confine della Tabella (${violation.why})`);
  console.error(`  ${violation.text}`);
}
if (violations.length > 0) {
  console.error("");
  console.error(`${violations.length} import fuori dal confine di ${TABELLA_ROOT}/: soltanto kit/, moto/, i18n/ ed editors/core/tsv.ts.`);
  process.exit(1);
}

console.log(`${inspected} sorgenti TypeScript in ${TABELLA_ROOT}/: importano soltanto kit/, moto/, i18n/, editors/core/tsv.ts e ui/lifetime.ts.`);
