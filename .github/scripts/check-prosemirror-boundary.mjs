#!/usr/bin/env node
// ProseMirror appartiene a Scrittura (`apps/client/src/scrittura/`) e
// all'editor dei documenti che la monta (`apps/client/src/editors/rich/`):
// nessun altro modulo della shell lo importa direttamente. Il testo dei
// disegni passa da Scrittura, e ProseMirror resta fuori dai pezzi che il
// disegno carica all'apertura.
//
//     node .github/scripts/check-prosemirror-boundary.mjs              # dalla radice
//     node .github/scripts/check-prosemirror-boundary.mjs --self-test  # l'autoprova
//
// Legge i sorgenti col parser TypeScript, come `check-codemirror-boundary.mjs`.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const SOURCE_ROOT = "apps/client/src";
const ALLOWED_ROOTS = [`${SOURCE_ROOT}/scrittura/`, `${SOURCE_ROOT}/editors/rich/`];
const TEXT_ROOT = ALLOWED_ROOTS[0];
const rootArgument = process.argv.slice(2).find((argument) => !argument.startsWith("--"));
const root = path.resolve(rootArgument ?? process.cwd());
const sourceRoot = path.join(root, SOURCE_ROOT);

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

function loadTypeScript(repoRoot) {
  const packagePath = path.join(repoRoot, "apps/client/package.json");
  try {
    return createRequire(packagePath)("typescript");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`impossibile caricare il parser TypeScript da ${packagePath}: ${message}`);
  }
}

function diagnosticText(typescript, diagnostic) {
  const message = typescript.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
  if (!diagnostic.file || diagnostic.start == null) return message;
  const position = typescript.getLineAndCharacterOfPosition(diagnostic.file, diagnostic.start);
  return `${diagnostic.file.fileName}:${position.line + 1}:${position.character + 1}: ${message}`;
}

function parseSource(typescript, fileName, text) {
  const scriptKind = fileName.endsWith(".tsx") ? typescript.ScriptKind.TSX : typescript.ScriptKind.TS;
  const source = typescript.createSourceFile(
    fileName,
    text,
    typescript.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  if (source.parseDiagnostics?.length > 0) {
    const details = source.parseDiagnostics.map((diagnostic) => diagnosticText(typescript, diagnostic));
    throw new Error(`parser TypeScript non affidabile per ${fileName}:\n${details.join("\n")}`);
  }
  return source;
}

function codeMirrorSpecifier(specifier) {
  return /^prosemirror-[^/]+(?:\/.*)?$/.test(specifier) || /^prosemirror(?:\/.*)?$/.test(specifier);
}

function codeMirrorPrefix(prefix) {
  return /^prosemirror(?:-|\/|$)/.test(prefix);
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
  if (typescript.isTemplateExpression(node)) {
    return { value: node.head.text, complete: false };
  }
  if (
    typescript.isBinaryExpression(node) &&
    node.operatorToken.kind === typescript.SyntaxKind.PlusToken
  ) {
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
    return typescript.isIdentifier(receiver) &&
      receiver.text === object && expression.name.text === member;
  }
  if (typescript.isElementAccessExpression(expression)) {
    const receiver = unwrapExpression(typescript, expression.expression);
    return typescript.isIdentifier(receiver) &&
      receiver.text === object && memberName(typescript, expression.argumentExpression) === member;
  }
  return false;
}

function imports(text, fileName, typescript) {
  const source = parseSource(typescript, fileName, text);
  const found = [];
  const add = (node, specifierNode) => {
    if (!specifierNode) return;
    const specifier = knownSpecifier(typescript, specifierNode);
    const matches = specifier.complete
      ? codeMirrorSpecifier(specifier.value)
      : codeMirrorPrefix(specifier.value);
    if (matches) found.push({ start: node.getStart(source), specifier: specifier.value });
  };

  const visit = (node) => {
    if (typescript.isImportDeclaration(node)) {
      add(node, node.moduleSpecifier);
    } else if (typescript.isExportDeclaration(node)) {
      add(node, node.moduleSpecifier);
    } else if (
      typescript.isImportEqualsDeclaration(node) &&
      typescript.isExternalModuleReference(node.moduleReference)
    ) {
      add(node, node.moduleReference.expression);
    } else if (
      typescript.isImportTypeNode(node) &&
      typescript.isLiteralTypeNode(node.argument)
    ) {
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

function lineNumber(text, offset) {
  return text.slice(0, offset).split("\n").length;
}

function findings(relative, text, typescript) {
  const matches = imports(text, relative, typescript);
  if (ALLOWED_ROOTS.some((allowed) => relative.startsWith(allowed))) return [];
  return matches.map((match) => ({
    line: lineNumber(text, match.start),
    specifier: match.specifier,
    text: text.split(/\r?\n/)[lineNumber(text, match.start) - 1]?.trim() ?? "",
  }));
}

function selfTest(typescript) {
  const allowed = `
    import { EditorState } from "prosemirror-state";
    import editor from "prosemirror-view";
    const view = import("prosemirror-view");
    const bareView = import("prosemirror-model");
    const templateView = import(\`prosemirror-view\`);
    export { EditorView } from "prosemirror-view";
    const editor = require("prosemirror-view");
    const templateEditor = require(\`prosemirror-view\`);
    const moduleEditor = module.require("prosemirror-view");
    const templateModuleEditor = module.require(\`prosemirror-view\`);
    const resolvedEditor = require.resolve("prosemirror-view");
    const templateResolvedEditor = require.resolve(\`prosemirror-view\`);
    // const ignoredView = import(\`prosemirror-\${segment}\`);
    const unrelatedTemplate = \`third-party/\${segment}\`;
    const unrelatedImport = import(\`third-party/\${segment}\`);
    const unrelatedRequire = require(\`third-party/\${segment}\`);
    const runtimeText = \`\${runtimeValue}\`;
    const regexLiteral = /require("prosemirror-view")/;
    const regexNested = \`prefix/\${/require("prosemirror-view")/.test(runtimeValue)}\`;
    const regexBraceNested = \`prefix/\${/}/.test(runtimeValue)}\`;
    const division = \`prefix/\${left / right}\`;
    const otherModule = other.module.require("prosemirror-view");
    const otherModuleTemplate = \`\${other.module.require("prosemirror-view")}\`;
    const concatenatedRuntime = import(runtimePrefix + "prosemirror-view");
    const otherBracket = other["module"].require("prosemirror-view");
    const otherBracketTemplate = \`\${other["module"].require("prosemirror-view")}\`;
    const literalCallText = \`require("prosemirror-view")\`;
    const nestedString = \`\${"require('prosemirror-view')"}\`;
    const nestedComment = \`\${/* require("prosemirror-view") */ runtimeValue}\`;
    const nearImport = import(\`prosemirrorish/\${segment}\`);
    const nearRequire = require(\`prosemirrorjs/\${segment}\`);
    type Other = import("third-party").Thing;
    const wrappedOther = (other.module.require)("prosemirror-view");
    const assertedOther = (other.module.require as any)("prosemirror-view");
    const unknownMember = module[member]("prosemirror-view");
    const unknownMemberConcat = module["re" + member]("prosemirror-view");
    const globalAlias = runtimeGlobal.require("prosemirror-view");
    const windowAlias = window.requireAlias("prosemirror-view");
    const aliasRequire = localRequire("prosemirror-view");
  `;
  const forbidden = `
    // import { fake } from "prosemirror-fake";
    import { EditorState } from "prosemirror-state";
    import editor from "prosemirror-view";
    const view = import("prosemirror-view");
    const bareView = import("prosemirror-model");
    const templateView = import(\`prosemirror-view\`);
    export { EditorView } from "prosemirror-view";
    const editor = require("prosemirror-view");
    const templateEditor = require(\`prosemirror-view\`);
    const moduleEditor = module.require("prosemirror-view");
    const templateModuleEditor = module.require(\`prosemirror-view\`);
    const resolvedEditor = require.resolve("prosemirror-view");
    const templateResolvedEditor = require.resolve(\`prosemirror-view\`);
    const interpolatedView = import(\`prosemirror-\${segment}\`);
    const interpolatedRequire = require(\`prosemirror-\${segment}\`);
    const interpolatedModule = module.require(\`prosemirror-\${segment}\`);
    const interpolatedResolve = require.resolve(\`prosemirror-\${segment}\`);
    // const ignoredRequire = require(\`prosemirror-\${segment}\`);
    const runtimeOnly = \`prosemirror-\${segment}\`;
    const nestedView = \`\${import("prosemirror-view")}\`;
    const nestedRequire = \`\${require("prosemirror-view")}\`;
    const nestedModule = \`\${module.require("prosemirror-view")}\`;
    const nestedResolve = \`\${require.resolve("prosemirror-view")}\`;
    const nestedBraces = \`\${({ load: () => require("prosemirror-view") }).load()}\`;
    const nestedTemplate = \`\${import(\`prosemirror-\${segment}\`)}\`;
    const literalCallText = \`require("prosemirror-view")\`;
    const nestedComment = \`\${/* require("prosemirror-view") */ runtimeValue}\`;
    const nestedString = \`\${"require('prosemirror-view')"}\`;
    const regexThenRequire = \`\${/}/.test(runtimeValue) ? require("prosemirror-view") : null}\`;
    const divisionRequire = \`\${left / require("prosemirror-view")}\`;
    const concatenatedRequire = require("prosemirror-" + suffix);
    const concatenatedModule = module.require("prosemirror-" + suffix);
    const bracketModule = module["require"]("prosemirror-view");
    const bracketResolve = require["resolve"]("prosemirror-view");
    const bracketInterpolatedModule = module["require"](\`prosemirror-\${segment}\`);
    const bracketInterpolatedResolve = require["resolve"](\`prosemirror-\${segment}\`);
    import editorAlias = require("prosemirror-view");
    type CodeMirrorState = import("prosemirror-state").EditorState;
    type BareCodeMirror = import("prosemirror-model");
    const wrappedRequire = (require)("prosemirror-view");
    const assertedRequire = (require as any)("prosemirror-view");
    const satisfiedRequire = (require satisfies typeof globalThis.require)("prosemirror-view");
    const nonNullRequire = require!("prosemirror-view");
    const optionalRequire = require?.("prosemirror-view");
    const wrappedModule = (module.require)("prosemirror-view");
    const assertedModule = (module.require as any)("prosemirror-view");
    const nonNullModule = module.require!("prosemirror-view");
    const optionalModule = module.require?.("prosemirror-view");
    const wrappedResolve = (require.resolve)("prosemirror-view");
    const assertedResolve = (require.resolve as any)("prosemirror-view");
    const nonNullResolve = require.resolve!("prosemirror-view");
    const optionalResolve = require.resolve?.("prosemirror-view");
    const bracketConcatModule = module["re" + "quire"]("prosemirror-view");
    const bracketConcatResolve = require["res" + "olve"]("prosemirror-view");
    const globalRequire = globalThis.require("prosemirror-view");
    const windowRequire = window.require(\`prosemirror-\${segment}\`);
    const globalBracket = globalThis["require"]("prosemirror-view");
    const windowBracket = window["re" + "quire"]("prosemirror-view");
  `;
  const tsx = `
    export const nested = <Widget>{module.require(\`prosemirror-\${segment}\`)}</Widget>;
  `;
  const permittedImports = imports(allowed, "self-test.ts", typescript);
  const permittedFindings = findings(`${TEXT_ROOT}self-test.ts`, allowed, typescript);
  const forbiddenFindings = findings(`${SOURCE_ROOT}/panels/self-test.ts`, forbidden, typescript);
  const tsxFindings = findings(`${SOURCE_ROOT}/panels/self-test.tsx`, tsx, typescript);
  if (
    permittedImports.length !== 12 ||
    permittedFindings.length !== 0 ||
    forbiddenFindings.length !== 52 ||
    tsxFindings.length !== 1
  ) {
    throw new Error(
      `self-test inatteso: parser=${permittedImports.length}, permesso=${permittedFindings.length}, ` +
        `violazioni=${forbiddenFindings.length}, tsx=${tsxFindings.length}`,
    );
  }
  console.log("Autoprova di check-prosemirror-boundary riuscita: caso permesso e violazione rilevati.");
}

if (process.argv.includes("--self-test")) {
  try {
    selfTest(loadTypeScript(root));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Autoprova di check-prosemirror-boundary fallita: ${message}`);
    process.exit(1);
  }
  process.exit(0);
}

if (!fs.existsSync(sourceRoot)) {
  console.error(`cannot find ${sourceRoot}: pass the repo root as an argument.`);
  process.exit(2);
}

let typescript;
try {
  typescript = loadTypeScript(root);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`check-prosemirror-boundary fallito: ${message}`);
  process.exit(1);
}

const violations = [];
let inspected = 0;
try {
  for (const file of sourceFiles(sourceRoot).sort()) {
    const relative = path.relative(root, file).split(path.sep).join("/");
    inspected++;
    for (const violation of findings(relative, fs.readFileSync(file, "utf8"), typescript)) {
      violations.push({ relative, ...violation });
    }
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`check-prosemirror-boundary fallito: ${message}`);
  process.exit(1);
}

for (const violation of violations) {
  console.error(`${violation.relative}:${violation.line}: import ProseMirror fuori da Scrittura e dai documenti`);
  console.error(`  ${violation.text}`);
}
if (violations.length > 0) {
  console.error("");
  console.error(`${violations.length} import ProseMirror fuori da ${ALLOWED_ROOTS.join(" e ")}.`);
  process.exit(1);
}

console.log(`${inspected} sorgenti TypeScript: ProseMirror confinato in ${ALLOWED_ROOTS.join(" e ")}.`);
