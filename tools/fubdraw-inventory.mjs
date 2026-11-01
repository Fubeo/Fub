// L'inventario della chiusura di FubDraw (ADR 0231): i moduli del client che
// gli ingressi dell'app raggiungono, seguendo gli import statici, gli import()
// dinamici e i worker (`new URL("…", import.meta.url)`).
//
// Senza argomenti elenca i moduli raggiunti. Con `--orfani` elenca i moduli
// di una cartella (di serie `apps/client/src/editors/spatial`) che l'app non
// raggiunge più: `morto` se non li importa nemmeno un test, `solo-test` se li
// tengono vivi soltanto i test. È la lista di lavoro delle PR di rimozione:
//   node tools/fubdraw-inventory.mjs > prima.txt
//   (si tagliano gli strumenti)
//   node tools/fubdraw-inventory.mjs > dopo.txt
//   comm -23 prima.txt dopo.txt
//   node tools/fubdraw-inventory.mjs --orfani
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLIENT = join(ROOT, "apps/client");
// TypeScript sta fra le dipendenze del client, non della radice.
const ts = createRequire(join(CLIENT, "package.json"))("typescript");

/// Gli ingressi: gli script delle tre pagine di Vite.
function entries() {
  return ["index.html", "document.html", "mobile.html"].flatMap((page) =>
    [...readFileSync(join(CLIENT, page), "utf8").matchAll(/<script[^>]*src="\/([^"]+\.ts)"/g)].map((m) => join(CLIENT, m[1])),
  );
}

function resolveImport(from, spec) {
  const clean = spec.replace(/\?.*$/, "");
  const base = resolve(dirname(from), clean);
  const bare = base.replace(/\.js$/, "");
  for (const candidate of [base, `${bare}.ts`, join(bare, "index.ts")]) {
    if (existsSync(candidate) && statSync(candidate).isFile() && candidate.endsWith(".ts")) return candidate;
  }
  return null;
}

function importsOf(file) {
  const source = readFileSync(file, "utf8");
  // L'albero sintattico e non `preProcessFile`, che perde `void import(…)`.
  const specs = [];
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      specs.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && ts.isStringLiteralLike(node.arguments[0] ?? node)) {
      specs.push(node.arguments[0].text);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      specs.push(node.argument.literal.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile(file, source, ts.ScriptTarget.Latest, false));
  for (const m of source.matchAll(/new URL\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url\s*\)/g)) specs.push(m[1]);
  return specs.filter((spec) => spec.startsWith(".")).flatMap((spec) => resolveImport(file, spec) ?? []);
}

function reachable(roots) {
  const seen = new Set();
  const stack = [...roots];
  while (stack.length > 0) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    stack.push(...importsOf(file));
  }
  return seen;
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : walk(path);
    return path.endsWith(".ts") && !path.endsWith(".d.ts") ? [path] : [];
  });
}

const isTest = (file) => /\.(test|bench)\.ts$/.test(file);
const show = (file) => relative(ROOT, file);

const app = reachable(entries());
const args = process.argv.slice(2);
if (args[0] === "--orfani") {
  const dir = resolve(ROOT, args[1] ?? "apps/client/src/editors/spatial");
  const files = walk(dir);
  const tests = reachable(walk(join(CLIENT, "src")).filter(isTest));
  const lines = files
    .filter((file) => !isTest(file) && !app.has(file))
    .map((file) => `${tests.has(file) ? "solo-test" : "morto"}\t${show(file)}`)
    .sort();
  if (lines.length > 0) console.log(lines.join("\n"));
} else {
  console.log([...app].map(show).sort().join("\n"));
}
