#!/usr/bin/env node
// Controlla la forma della documentazione viva. Gli ADR sono registri storici
// e vengono verificati dai loro indici, non dalle regole editoriali correnti.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const LEGACY = [
  "docs/00-inizia-qui/", "docs/01-concetti/", "docs/02-componenti/",
  "docs/03-uml/", "docs/04-plugin/", "docs/05-disco/",
  "docs/06-contratto/", "docs/07-ui/", "docs/appendix/",
  "docs/features/", "docs/microfeatures/", "docs/milestones/",
  "docs/personas/", "docs/roadmap/", "docs/PIANO.md",
  "docs/FEATURES.md", "docs/leggimi-prima.md", "docs/todo.md",
  "docs/versionamento.md", "docs/CONTRIBUTING.md", "docs/SECURITY.md",
  "docs/CODE_OF_CONDUCT.md", "docs/CHANGELOG.md", "graph.md",
];

const CANONICAL = [
  "docs/getting-started/", "docs/concepts/", "docs/architecture/",
  "docs/guides/", "docs/reference/",
];

const MERMAID_TYPES = new Set([
  "flowchart", "sequenceDiagram", "stateDiagram-v2", "classDiagram",
  "erDiagram", "pie",
]);

function trackedMarkdown(root) {
  const r = spawnSync("git", ["-C", root, "ls-files", "-z", "--", "*.md"], {
    encoding: "utf8",
  });
  if (r.error || r.status !== 0) return null;
  return r.stdout.split("\0").filter(Boolean).sort();
}

function selfTest() {
  const sample = "# Titolo\n\n> **Stato:** implementato\n\n```mermaid\nflowchart LR\n A --> B\n```\n";
  const failures = [];
  if ((sample.match(/^# /gm) ?? []).length !== 1) failures.push("H1");
  const blocks = [...sample.matchAll(/```mermaid\s*\n([^\n]+)/g)];
  if (blocks.length !== 1 || !MERMAID_TYPES.has(blocks[0][1].trim().split(/\s+/)[0])) {
    failures.push("Mermaid");
  }
  console.log(`self-test: ${failures.length === 0 ? "ok" : failures.join(", ")}`);
  process.exit(failures.length === 0 ? 0 : 1);
}

if (process.argv.includes("--self-test")) selfTest();

const root = path.resolve(process.argv[2] ?? process.cwd());
const files = trackedMarkdown(root);
if (files === null || files.length === 0) {
  console.error("prose: impossibile leggere i Markdown tracciati");
  process.exit(1);
}

const problems = [];

for (const legacy of LEGACY) {
  const full = path.join(root, legacy);
  if (fs.existsSync(full)) problems.push(`${legacy}: percorso legacy ancora presente`);
}

for (const rel of files) {
  if (rel.startsWith("docs/decisions/") && !rel.endsWith("/README.md") &&
      !rel.endsWith("/index-by-date.md") && !rel.endsWith("/index-by-topic.md") &&
      !rel.endsWith("/template.md")) continue;

  const full = path.join(root, rel);
  const text = fs.readFileSync(full, "utf8");
  const lines = text.split("\n");

  const h1 = lines.filter((line) => /^# /.test(line)).length;
  if (h1 !== 1) problems.push(`${rel}: atteso un solo H1, trovati ${h1}`);

  if (lines.length > 250 && !rel.startsWith("docs/decisions/")) {
    problems.push(`${rel}: ${lines.length} righe, limite 250 per una pagina viva`);
  }

  if (CANONICAL.some((prefix) => rel.startsWith(prefix))) {
    const head = lines.slice(0, 8).join("\n");
    if (!/> \*\*Stato:\*\*/.test(head)) {
      problems.push(`${rel}: manca lo stato entro le prime otto righe`);
    }
  }

  const proposalAllowed = rel.startsWith("docs/rfcs/") || rel === "docs/README.md" ||
    rel === "docs/project/roadmap.md" || rel === "docs/project/status.md";
  if (!proposalAllowed && /\b(?:proposto|pianificato)\b/i.test(text)) {
    problems.push(`${rel}: stato futuro fuori da RFC, roadmap o status`);
  }

  if (!rel.startsWith("docs/rfcs/") && /\b(?:TODO|TBD|FIXME)\b/.test(text)) {
    problems.push(`${rel}: placeholder fuori da una RFC`);
  }

  if (!rel.startsWith("docs/rfcs/") && /\b(?:perfetto|definitivo|rivoluzionario)\b/i.test(text)) {
    problems.push(`${rel}: aggettivo non verificabile`);
  }

  const nonBlank = lines.filter((line) => line.trim() !== "");
  const links = [...text.matchAll(/\[[^\]]+\]\([^)]+\)/g)].length;
  if (nonBlank.length <= 6 && links > 0 && !rel.endsWith("template.md")) {
    problems.push(`${rel}: possibile documento di solo redirect`);
  }

  for (const match of text.matchAll(/```mermaid\s*\n([^\n]+)([\s\S]*?)```/g)) {
    const first = match[1].trim().split(/\s+/)[0];
    if (!MERMAID_TYPES.has(first)) {
      problems.push(`${rel}: tipo Mermaid non ammesso: ${first}`);
    }
    const body = match[0];
    if (/classDef|#[0-9a-f]{3,8}\b|<br\s*\/?\s*>/i.test(body)) {
      problems.push(`${rel}: Mermaid contiene stile rigido o HTML`);
    }
    const nodes = (body.match(/\[[^\]]+\]|\([^\)]+\)|participant\s+/g) ?? []).length;
    if (nodes > 30) problems.push(`${rel}: diagramma Mermaid troppo esteso (${nodes} elementi stimati)`);
  }

  const opened = (text.match(/```/g) ?? []).length;
  if (opened % 2 !== 0) problems.push(`${rel}: blocco recintato non chiuso`);
}

if (problems.length === 0) {
  console.log(`prose: ${files.length} Markdown tracciati, struttura valida`);
  process.exit(0);
}

for (const problem of problems) console.error(problem);
console.error(`prose: ${problems.length} problemi`);
process.exit(1);
