#!/usr/bin/env node
// Un editor non scrive un ruolo del tema sull'elemento.
//
// Uno stile in linea come `style.color = "var(--accent)"` sta sul contenuto e
// vince su ogni regola della pelle: l'aspetto del contenuto (`look-file`,
// `look-adattato`) non lo può più ricollegare, e un tema non lo può vestire.
// I ruoli del tema si leggono dalla pelle; sull'elemento vanno i valori del
// file, come variabili di dato (`--file-color`), che la classe dell'aspetto
// decide se usare.
//
// La guardia legge i ruoli dal contratto del tema (`required_roles` e
// `optional_roles` di `apps/client/theme/author/contract.json`) e cerca un
// `var(--ruolo` in ogni stringa e in ogni modello dei sorgenti di
// `apps/client/src/editors/`, test esclusi. Le stringhe si trovano con il
// parser TypeScript, così un commento che cita un ruolo non conta.
// `getPropertyValue("--accent")` resta ammesso: è il modo del canvas, che il
// colore lo legge e non lo scrive.
//
// Parte con le righe di oggi, in `EXCEPTIONS`, contate per file: il conto può
// solo scendere. Una riga nuova lo fa salire e la guardia fallisce; una riga
// tolta dal codice va tolta anche dall'elenco, o fallisce lo stesso.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const EDITORS = "apps/client/src/editors/";
const CONTRACT = "apps/client/theme/author/contract.json";

/// Il tema di CodeMirror è fatto di stili scritti da CodeMirror sull'elemento,
/// e i suoi colori sono ruoli: non è un'eccezione da contare, è un altro modo
/// di vestire l'editor di testo. Resta fuori finché non passa alla pelle.
const SEPARATE = new Map([
  [`${EDITORS}text/theme.ts`, "il tema di CodeMirror (EditorView.theme) è un caso a parte: issue #242"],
]);

/// Le occorrenze di oggi, per file. Possono solo scendere.
const EXCEPTIONS = new Map([
  // La Lavagna dipinge le sue carte con stili in linea.
  [`${EDITORS}canvas/engine.ts`, 8],
  [`${EDITORS}grid/engine.ts`, 2],
  // La stampa compone una pagina sua, fuori dalla pelle.
  [`${EDITORS}media/print-view.ts`, 2],
  [`${EDITORS}spatial/tools/accessibility-panel.ts`, 1],
  // I profili Markdown passano ruoli a `EditorView.theme`: issue #242.
  [`${EDITORS}text/profiles/markdown/livepreview.ts`, 20],
  [`${EDITORS}text/profiles/markdown/profile.ts`, 9],
  [`${EDITORS}text/profiles/markdown/proof.ts`, 2],
  [`${EDITORS}text/profiles/markdown/properties.ts`, 5],
  [`${EDITORS}text/profiles/markdown/table-widget.ts`, 9],
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

/// I ruoli del contratto: gli obbligatori e i facoltativi.
function contractRoles(repoRoot) {
  const contract = JSON.parse(fs.readFileSync(path.join(repoRoot, CONTRACT), "utf8"));
  const roles = [...(contract.required_roles ?? []), ...(contract.optional_roles ?? [])];
  if (roles.length === 0) throw new Error(`${CONTRACT} non dichiara ruoli`);
  return new Set(roles);
}

/// Le stringhe e i pezzi di modello di un sorgente, con la riga.
function strings(typescript, fileName, text) {
  const kind = fileName.endsWith(".tsx") ? typescript.ScriptKind.TSX : typescript.ScriptKind.TS;
  const source = typescript.createSourceFile(fileName, text, typescript.ScriptTarget.Latest, true, kind);
  if (source.parseDiagnostics?.length > 0) {
    throw new Error(`parser TypeScript non affidabile per ${fileName}`);
  }
  const found = [];
  const add = (node, value) => {
    found.push({ line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, value });
  };
  const visit = (node) => {
    if (typescript.isStringLiteral(node) || typescript.isNoSubstitutionTemplateLiteral(node)) {
      add(node, node.text);
    } else if (typescript.isTemplateExpression(node)) {
      add(node.head, node.head.text);
      for (const span of node.templateSpans) add(span.literal, span.literal.text);
    }
    typescript.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/// I ruoli del tema scritti in una stringa: `var(--ruolo` con il ruolo del
/// contratto, non una variabile di dato.
function findings(typescript, roles, fileName, text) {
  const result = [];
  for (const { line, value } of strings(typescript, fileName, text)) {
    for (const match of value.matchAll(/var\(\s*--([\w-]+)/g)) {
      if (roles.has(match[1])) result.push({ line, role: match[1] });
    }
  }
  return result;
}

/// Il giudizio su un insieme di sorgenti: `{ relative → testo }`.
function judge(typescript, roles, sources, exceptions = EXCEPTIONS, separate = SEPARATE) {
  const errors = [];
  const counted = new Map();
  for (const [relative, text] of Object.entries(sources)) {
    if (!relative.startsWith(EDITORS) || separate.has(relative)) continue;
    const found = findings(typescript, roles, relative, text);
    if (found.length > 0) counted.set(relative, found);
  }
  for (const [relative, found] of counted) {
    const allowed = exceptions.get(relative) ?? 0;
    if (found.length > allowed) {
      errors.push(
        `${relative}: ${found.length} ruoli del tema in uno stile scritto sull'elemento, ${allowed} ammessi\n` +
          found.map(({ line, role }) => `  ${relative}:${line}: var(--${role})`).join("\n"),
      );
    }
  }
  for (const [relative, allowed] of exceptions) {
    const now = counted.get(relative)?.length ?? 0;
    if (now < allowed) {
      errors.push(`${relative}: ${now} ruoli in linea, l'elenco ne ammette ${allowed}: accorcia EXCEPTIONS a ${now}`);
    }
  }
  for (const relative of separate.keys()) {
    if (!(relative in sources)) errors.push(`${relative}: il caso a parte non c'è più, toglilo da SEPARATE`);
  }
  return errors;
}

function selfTest(typescript) {
  const roles = new Set(["accent", "doc-fg"]);
  const file = `${EDITORS}rich/prova.ts`;
  const clean = `
    // Un commento che cita var(--accent) non conta.
    el.style.setProperty("--file-color", value);
    el.style.color = "var(--file-color)";
    const ink = getComputedStyle(el).getPropertyValue("--accent");
  `;
  const dirty = `el.style.color = "var(--accent)"; el.style.border = \`1px solid var(--doc-fg, \${x})\`;`;
  const cases = [
    ["una variabile di dato e getPropertyValue passano", judge(typescript, roles, { [file]: clean }, new Map(), new Map()), 0],
    ["un ruolo nuovo in una stringa e in un modello fa fallire", judge(typescript, roles, { [file]: dirty }, new Map(), new Map()), 1],
    ["un'eccezione che li conta passa", judge(typescript, roles, { [file]: dirty }, new Map([[file, 2]]), new Map()), 0],
    ["un'eccezione tolta dal codice va tolta dall'elenco", judge(typescript, roles, { [file]: clean }, new Map([[file, 2]]), new Map()), 1],
    ["fuori dagli editor non si guarda", judge(typescript, roles, { "apps/client/src/ui/prova.ts": dirty }, new Map(), new Map()), 0],
    ["un caso a parte sparito si toglie", judge(typescript, roles, { [file]: clean }, new Map(), new Map([[`${EDITORS}via.ts`, "x"]])), 1],
  ];
  const wrong = cases.filter(([, errors, expected]) => errors.length !== expected).map(([name]) => name);
  if (wrong.length > 0) throw new Error(wrong.join("; "));
  console.log(`Autoprova di check-inline-theme riuscita: ${cases.length} casi.`);
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
  console.error(`check-inline-theme fallito: ${message}`);
  process.exit(1);
}

const editors = path.join(root, EDITORS);
if (!fs.existsSync(editors)) {
  console.error(`cannot find ${editors}: pass the repo root as an argument.`);
  process.exit(2);
}

let errors;
let inspected = 0;
try {
  const roles = contractRoles(root);
  const sources = {};
  for (const file of sourceFiles(editors).sort()) {
    sources[path.relative(root, file).split(path.sep).join("/")] = fs.readFileSync(file, "utf8");
    inspected++;
  }
  errors = judge(typescript, roles, sources);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`check-inline-theme fallito: ${message}`);
  process.exit(1);
}

if (errors.length > 0) {
  for (const error of errors) console.error(error);
  console.error("");
  console.error(
    "Un ruolo del tema va nella pelle, non sull'elemento: sull'elemento vanno i valori del file (--file-*).",
  );
  process.exit(1);
}

console.log(`${inspected} sorgenti degli editor: nessun ruolo del tema in linea oltre l'elenco di oggi.`);
