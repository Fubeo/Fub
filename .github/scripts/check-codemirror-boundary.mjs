#!/usr/bin/env node
// Gli oggetti CodeMirror appartengono al package testuale: nessun altro modulo
// della shell deve poterli importare direttamente.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const SOURCE_ROOT = "apps/client/src";
const TEXT_ROOT = `${SOURCE_ROOT}/editors/text/`;
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
  return /^@codemirror\/[^/]+(?:\/.*)?$/.test(specifier) ||
    /^codemirror(?:\/.*)?$/.test(specifier);
}

function codeMirrorPrefix(prefix) {
  return /^@codemirror(?:\/|$)/.test(prefix) || /^codemirror(?:\/|$)/.test(prefix);
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
  if (relative.startsWith(TEXT_ROOT)) return [];
  return matches.map((match) => ({
    line: lineNumber(text, match.start),
    specifier: match.specifier,
    text: text.split(/\r?\n/)[lineNumber(text, match.start) - 1]?.trim() ?? "",
  }));
}

function selfTest(typescript) {
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
    // const ignoredView = import(\`@codemirror/\${segment}\`);
    const unrelatedTemplate = \`third-party/\${segment}\`;
    const unrelatedImport = import(\`third-party/\${segment}\`);
    const unrelatedRequire = require(\`third-party/\${segment}\`);
    const runtimeText = \`\${runtimeValue}\`;
    const regexLiteral = /require("codemirror")/;
    const regexNested = \`prefix/\${/require("codemirror")/.test(runtimeValue)}\`;
    const regexBraceNested = \`prefix/\${/}/.test(runtimeValue)}\`;
    const division = \`prefix/\${left / right}\`;
    const otherModule = other.module.require("codemirror");
    const otherModuleTemplate = \`\${other.module.require("codemirror")}\`;
    const concatenatedRuntime = import(runtimePrefix + "@codemirror/view");
    const otherBracket = other["module"].require("codemirror");
    const otherBracketTemplate = \`\${other["module"].require("codemirror")}\`;
    const literalCallText = \`require("codemirror")\`;
    const nestedString = \`\${"require('codemirror')"}\`;
    const nestedComment = \`\${/* require("codemirror") */ runtimeValue}\`;
    const nearImport = import(\`@codemirrorish/\${segment}\`);
    const nearRequire = require(\`codemirror-js/\${segment}\`);
    type Other = import("third-party").Thing;
    const wrappedOther = (other.module.require)("codemirror");
    const assertedOther = (other.module.require as any)("codemirror");
    const unknownMember = module[member]("codemirror");
    const unknownMemberConcat = module["re" + member]("codemirror");
    const globalAlias = runtimeGlobal.require("codemirror");
    const windowAlias = window.requireAlias("codemirror");
    const aliasRequire = localRequire("codemirror");
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
    const interpolatedView = import(\`@codemirror/\${segment}\`);
    const interpolatedRequire = require(\`codemirror/\${segment}\`);
    const interpolatedModule = module.require(\`@codemirror/\${segment}\`);
    const interpolatedResolve = require.resolve(\`codemirror/\${segment}\`);
    // const ignoredRequire = require(\`codemirror/\${segment}\`);
    const runtimeOnly = \`codemirror/\${segment}\`;
    const nestedView = \`\${import("@codemirror/view")}\`;
    const nestedRequire = \`\${require("codemirror")}\`;
    const nestedModule = \`\${module.require("@codemirror/view")}\`;
    const nestedResolve = \`\${require.resolve("codemirror")}\`;
    const nestedBraces = \`\${({ load: () => require("codemirror") }).load()}\`;
    const nestedTemplate = \`\${import(\`@codemirror/\${segment}\`)}\`;
    const literalCallText = \`require("codemirror")\`;
    const nestedComment = \`\${/* require("codemirror") */ runtimeValue}\`;
    const nestedString = \`\${"require('codemirror')"}\`;
    const regexThenRequire = \`\${/}/.test(runtimeValue) ? require("codemirror") : null}\`;
    const divisionRequire = \`\${left / require("codemirror")}\`;
    const concatenatedRequire = require("codemirror" + suffix);
    const concatenatedModule = module.require("@codemirror/" + suffix);
    const bracketModule = module["require"]("codemirror");
    const bracketResolve = require["resolve"]("@codemirror/view");
    const bracketInterpolatedModule = module["require"](\`@codemirror/\${segment}\`);
    const bracketInterpolatedResolve = require["resolve"](\`codemirror/\${segment}\`);
    import editorAlias = require("codemirror");
    type CodeMirrorState = import("@codemirror/state").EditorState;
    type BareCodeMirror = import("codemirror");
    const wrappedRequire = (require)("codemirror");
    const assertedRequire = (require as any)("codemirror");
    const satisfiedRequire = (require satisfies typeof globalThis.require)("codemirror");
    const nonNullRequire = require!("codemirror");
    const optionalRequire = require?.("codemirror");
    const wrappedModule = (module.require)("codemirror");
    const assertedModule = (module.require as any)("codemirror");
    const nonNullModule = module.require!("codemirror");
    const optionalModule = module.require?.("codemirror");
    const wrappedResolve = (require.resolve)("codemirror");
    const assertedResolve = (require.resolve as any)("codemirror");
    const nonNullResolve = require.resolve!("codemirror");
    const optionalResolve = require.resolve?.("codemirror");
    const bracketConcatModule = module["re" + "quire"]("codemirror");
    const bracketConcatResolve = require["res" + "olve"]("@codemirror/view");
    const globalRequire = globalThis.require("codemirror");
    const windowRequire = window.require(\`@codemirror/\${segment}\`);
    const globalBracket = globalThis["require"]("codemirror");
    const windowBracket = window["re" + "quire"]("@codemirror/view");
  `;
  const tsx = `
    export const nested = <Widget>{module.require(\`@codemirror/\${segment}\`)}</Widget>;
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
  console.log("Autoprova di check-codemirror-boundary riuscita: caso permesso e violazione rilevati.");
}

if (process.argv.includes("--self-test")) {
  try {
    selfTest(loadTypeScript(root));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Autoprova di check-codemirror-boundary fallita: ${message}`);
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
  console.error(`check-codemirror-boundary fallito: ${message}`);
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
  console.error(`check-codemirror-boundary fallito: ${message}`);
  process.exit(1);
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
