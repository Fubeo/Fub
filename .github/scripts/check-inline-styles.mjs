#!/usr/bin/env node
// Nessuno stile in linea che la CSP rifiuterebbe (voce A2 dell'audit del
// 2026-10-30).
//
// La CSP dell'app (`crates/fub-app/tauri.conf.json`) è `style-src 'self';
// style-src-attr 'none'`: un elemento `<style>` vale soltanto con il nonce che
// Tauri scrive nelle pagine, e un attributo `style` scritto come markup non
// vale mai. Nella WebView il rifiuto è silenzioso: il pezzo resta senza stile.
// Gli stili dell'app sono quindi file, fogli costruiti (`adoptedStyleSheets`,
// vedi `apps/client/src/ui/stylesheets.ts`) o CSSOM (`element.style.x = …`,
// `style.setProperty`, `style.cssText`), che la CSP non guarda.
//
// La guardia legge le tre pagine HTML di `apps/client/` e i sorgenti di
// `apps/client/src/`, test esclusi, con il parser TypeScript (un commento
// che cita `style="` non conta). Rifiuta:
//
// - nelle pagine, un attributo `style` e ogni `<style>` che non sia il
//   portatore del nonce, vuoto: `<style data-fub-nonce></style>`;
// - `createElement("style")` e `createElementNS(…, "style")`;
// - `setAttribute("style", …)` e `setAttributeNS(…, "style", …)`;
// - una stringa o un modello con `<style` o `style="` (markup che finisce in
//   `innerHTML`, `insertAdjacentHTML`, `outerHTML`);
// - un `toDOM` di ProseMirror (`["span", { style: … }, 0]`), che ProseMirror
//   scrive con `setAttribute`.
//
// Le eccezioni sono i documenti che la CSP della pagina non governa (un
// `DOMParser`, un SVG che diventa un'immagine o un file) e il markup che passa
// dal sanitizzatore, che riscrive lo `style` ammesso in CSSOM. Sono contate per
// file in `EXCEPTIONS`, con il perché: il conto può solo scendere.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const SOURCES = "apps/client/src/";
const PAGES = ["apps/client/index.html", "apps/client/mobile.html", "apps/client/document.html"];

/// Il solo `<style>` ammesso in una pagina: vuoto, porta il nonce di Tauri.
const NONCE_CARRIER = /^<style data-fub-nonce><\/style>$/;

/// Le occorrenze di oggi, per file, e perché la CSP non le riguarda.
const EXCEPTIONS = new Map([
  // Un SVG che diventa un'immagine (`blob:`), con il suo `style`: la CSP della
  // pagina non entra in un documento immagine.
  [`${SOURCES}editors/spatial/painter/paint.ts`, { count: 2, why: "SVG di uno strato immagine" }],
  // Un SVG che va in un file OpenDocument o diventa il PNG di ripiego.
  [`${SOURCES}editors/rich/ink-shape.ts`, { count: 1, why: "SVG dell'inchiostro per un file" }],
  // L'HTML della resa passa dal sanitizzatore, che lo `style` ammesso lo
  // rimette con `element.style` (`ui/sanitize.ts`); l'export lo tiene così.
  [`${SOURCES}editors/text/profiles/markdown/render.ts`, { count: 1, why: "allineamento delle celle, via sanitizzatore" }],
  // Il documento di un `DOMParser`: l'HTML incollato diventa Markdown.
  [`${SOURCES}editors/text/profiles/markdown/paste.ts`, { count: 1, why: "documento di un DOMParser" }],
  // Il documento di un `DOMParser`: l'SVG di Mermaid diventa un'immagine.
  [`${SOURCES}ui/mermaid-drawing.ts`, { count: 2, why: "documento di un DOMParser" }],
]);

const rootArgument = process.argv.slice(2).find((argument) => !argument.startsWith("--"));
const root = path.resolve(rootArgument ?? process.cwd());

function sourceFiles(directory, found = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") sourceFiles(candidate, found);
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
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

/// Il markup di stile dentro una stringa: un tag `<style` o un attributo
/// `style=` con le virgolette (`[style=…]` di un selettore non ha virgolette
/// subito dopo, perché il valore arriva da una sostituzione o da `cssString`).
const MARKUP = /<style[\s>/]|(?:^|[\s"'])style\s*=\s*["']/i;

function literalText(typescript, node) {
  if (typescript.isStringLiteral(node) || typescript.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
}

/// Le occorrenze di un sorgente, con la riga e il motivo.
function findings(typescript, fileName, text) {
  const kind = fileName.endsWith(".tsx") ? typescript.ScriptKind.TSX : typescript.ScriptKind.TS;
  const source = typescript.createSourceFile(fileName, text, typescript.ScriptTarget.Latest, true, kind);
  if (source.parseDiagnostics?.length > 0) {
    throw new Error(`parser TypeScript non affidabile per ${fileName}`);
  }
  const found = [];
  const add = (node, what) => {
    found.push({ line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, what });
  };
  const visit = (node) => {
    if (typescript.isCallExpression(node)) {
      const callee = node.expression;
      const name = typescript.isPropertyAccessExpression(callee) ? callee.name.text
        : typescript.isIdentifier(callee) ? callee.text : "";
      const args = node.arguments.map((argument) => literalText(typescript, argument));
      if (name === "createElement" && args[0]?.toLowerCase() === "style") add(node, "createElement(\"style\")");
      if (name === "createElementNS" && args[1]?.toLowerCase() === "style") add(node, "createElementNS(…, \"style\")");
      if (name === "setAttribute" && args[0]?.toLowerCase() === "style") add(node, "setAttribute(\"style\", …)");
      if (name === "setAttributeNS" && args[1]?.toLowerCase() === "style") add(node, "setAttributeNS(…, \"style\", …)");
    } else if (typescript.isStringLiteral(node) || typescript.isNoSubstitutionTemplateLiteral(node)) {
      if (MARKUP.test(node.text)) add(node, "markup di stile in una stringa");
    } else if (typescript.isTemplateExpression(node)) {
      const parts = [node.head.text, ...node.templateSpans.map((span) => span.literal.text)];
      if (parts.some((part) => MARKUP.test(part))) add(node, "markup di stile in un modello");
    } else if (typescript.isArrayLiteralExpression(node)) {
      const [tag, attrs] = node.elements;
      if (tag && attrs && literalText(typescript, tag) !== null && typescript.isObjectLiteralExpression(attrs)) {
        const style = attrs.properties.find((property) =>
          property.name && (typescript.isIdentifier(property.name) || typescript.isStringLiteral(property.name))
          && property.name.text === "style");
        if (style) add(style, "attributo style in un toDOM di ProseMirror");
      }
    }
    typescript.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/// Le occorrenze di una pagina HTML: ogni attributo `style` e ogni `<style>`
/// che non sia il portatore del nonce. I commenti non contano.
function pageFindings(text) {
  const found = [];
  const withoutComments = text.replace(/<!--[\s\S]*?-->/g, (comment) => comment.replace(/[^\n]/g, " "));
  const lineOf = (index) => withoutComments.slice(0, index).split("\n").length;
  for (const match of withoutComments.matchAll(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi)) {
    if (!NONCE_CARRIER.test(match[0])) found.push({ line: lineOf(match.index), what: "<style> che non è il portatore del nonce" });
  }
  for (const match of withoutComments.matchAll(/<[a-z][^>]*\sstyle\s*=/gi)) {
    found.push({ line: lineOf(match.index), what: "attributo style" });
  }
  return found;
}

/// Il giudizio: `sources` e `pages` sono `{ relativo → testo }`.
function judge(typescript, sources, pages, exceptions = EXCEPTIONS) {
  const errors = [];
  for (const [relative, text] of Object.entries(pages)) {
    for (const { line, what } of pageFindings(text)) errors.push(`${relative}:${line}: ${what}`);
  }
  const counted = new Map();
  for (const [relative, text] of Object.entries(sources)) {
    const found = findings(typescript, relative, text);
    if (found.length > 0) counted.set(relative, found);
  }
  for (const [relative, found] of counted) {
    const allowed = exceptions.get(relative)?.count ?? 0;
    if (found.length > allowed) {
      errors.push(
        `${relative}: ${found.length} stili in linea che la CSP rifiuta, ${allowed} ammessi\n` +
          found.map(({ line, what }) => `  ${relative}:${line}: ${what}`).join("\n"),
      );
    }
  }
  for (const [relative, { count }] of exceptions) {
    const now = counted.get(relative)?.length ?? 0;
    if (now < count) errors.push(`${relative}: ${now} occorrenze, l'elenco ne ammette ${count}: accorcia EXCEPTIONS a ${now}`);
  }
  return errors;
}

function selfTest(typescript) {
  const file = `${SOURCES}ui/prova.ts`;
  const clean = `
    // Un commento con style="color:red" e <style> non conta.
    el.style.color = "red";
    el.style.setProperty("--file-color", value);
    el.style.cssText = "position:fixed";
    const sheet = new CSSStyleSheet();
    const rule = \`[style=\${cssString(value)}]{font-family:x}\`;
    const spec = ["strong", 0];
    const marks = { parseDOM: [{ style: "font-weight=bold" }] };
  `;
  const dirty = {
    "createElement": `const s = document.createElement("style");`,
    "createElementNS": `const s = doc.createElementNS(NS, "style");`,
    "setAttribute": `el.setAttribute("style", "color:red");`,
    "setAttributeNS": `el.setAttributeNS(null, "style", "color:red");`,
    "stringa": `el.innerHTML = '<td style="text-align:left">';`,
    "modello": "el.innerHTML = `<b style='x'>${y}</b>`;",
    "tag style": "host.insertAdjacentHTML('beforeend', `<style>${css}</style>`);",
    "toDOM": "const toDOM = () => [\"span\", { \"data-x\": 1, style: `--file-font: ${f}` }, 0];",
  };
  const pageClean = `<html><head><!-- <style>no</style> style="x" --><style data-fub-nonce></style></head><body><div class="a"></div></body></html>`;
  const pageStyle = `<html><head><style>body{}</style></head></html>`;
  const pageAttr = `<html><body><div style="color:red"></div></body></html>`;
  const cases = [
    ["CSSOM, fogli costruiti, selettori e parseDOM passano", judge(typescript, { [file]: clean }, {}, new Map()), 0],
    ...Object.entries(dirty).map(([name, text]) => [`${name} fa fallire`, judge(typescript, { [file]: text }, {}, new Map()), 1]),
    ["un'eccezione che li conta passa", judge(typescript, { [file]: dirty.setAttribute }, {}, new Map([[file, { count: 1 }]])), 0],
    ["un'eccezione tolta dal codice va tolta dall'elenco", judge(typescript, { [file]: clean }, {}, new Map([[file, { count: 1 }]])), 1],
    ["una pagina col solo portatore del nonce passa", judge(typescript, {}, { "a.html": pageClean }, new Map()), 0],
    ["una pagina con un <style> fallisce", judge(typescript, {}, { "a.html": pageStyle }, new Map()), 1],
    ["una pagina con un attributo style fallisce", judge(typescript, {}, { "a.html": pageAttr }, new Map()), 1],
  ];
  const wrong = cases.filter(([, errors, expected]) => errors.length !== expected).map(([name, errors]) => `${name} (${errors.length})`);
  if (wrong.length > 0) throw new Error(wrong.join("; "));
  console.log(`Autoprova di check-inline-styles riuscita: ${cases.length} casi.`);
}

let typescript;
try {
  typescript = loadTypeScript(root);
  if (process.argv.includes("--self-test")) {
    selfTest(typescript);
    process.exit(0);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`check-inline-styles fallito: ${message}`);
  process.exit(1);
}

const sourceRoot = path.join(root, SOURCES);
if (!fs.existsSync(sourceRoot)) {
  console.error(`cannot find ${sourceRoot}: pass the repo root as an argument.`);
  process.exit(2);
}

let errors;
let inspected = 0;
try {
  const sources = {};
  for (const file of sourceFiles(sourceRoot).sort()) {
    sources[path.relative(root, file).split(path.sep).join("/")] = fs.readFileSync(file, "utf8");
    inspected++;
  }
  const pages = {};
  for (const page of PAGES) pages[page] = fs.readFileSync(path.join(root, page), "utf8");
  errors = judge(typescript, sources, pages);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`check-inline-styles fallito: ${message}`);
  process.exit(1);
}

if (errors.length > 0) {
  for (const error of errors) console.error(error);
  console.error("");
  console.error(
    "La CSP rifiuta gli stili in linea: usa una classe, element.style (CSSOM) o un foglio costruito (ui/stylesheets.ts).",
  );
  process.exit(1);
}

console.log(`${inspected} sorgenti e ${PAGES.length} pagine: nessuno stile in linea che la CSP rifiuterebbe, oltre l'elenco di oggi.`);
